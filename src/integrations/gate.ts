/**
 * Agent gate: the shared core behind the Claude Code, Codex and OpenCode plugins.
 *
 * Every shell command an agent is about to run passes through `gate()`:
 *  - Harmless commands (tests, builds, reads, local edits) are allowed instantly, no network.
 *  - Risky ones (commit, push, deploy, publish, migrations, destructive deletes, infra apply)
 *    are sent to Litti together with the working-tree diff they would ship.
 *      · Tier 0 → allowed.
 *      · Not yet reviewed → DENIED at once with the review link. The agent stops and
 *        tells the human; after approval it re-runs the same command and is allowed once.
 *      · Diff changed since approval → new review (the approval is bound to the exact diff).
 *  - Litti unreachable → DENIED (fail closed), unless LITTI_HOOK_FAIL_OPEN=true.
 *
 * We never block until a timeout: a hook that times out fails open in most agents.
 */
import { resolve } from 'node:path';
import { readChanges, readOutgoing, splitDiff, type ChangeScope } from '../changes/git.js';
import { gitSubcommandIndex, progName } from './classify.js';

export interface GateDecision {
  decision: 'allow' | 'deny';
  reason: string;
  approvalUrl?: string;
  actionId?: string;
}

export { classify } from './classify.js';
import { classify } from './classify.js';

/**
 * Pull the shell command out of a hook payload. Claude Code and Codex send
 * {tool_name, tool_input:{command}}; Codex may send the command as an argv array;
 * OpenCode passes {tool, args:{command}}.
 */
export function extractCommand(payload: any): string | null {
  const tool = String(payload?.tool_name ?? payload?.tool ?? '').toLowerCase();
  const input = payload?.tool_input ?? payload?.args ?? payload?.input ?? {};
  if (!['bash', 'shell', 'local_shell', 'exec', 'exec_command', 'run_shell_command', 'powershell', 'container.exec'].includes(tool)) return null;
  const c = input.command ?? input.cmd ?? input.script;
  if (Array.isArray(c)) {
    // ["bash","-lc","git push"] → the script; otherwise join argv.
    const i = c.findIndex((a: unknown) => a === '-c' || a === '-lc');
    return i >= 0 && typeof c[i + 1] === 'string' ? c[i + 1] : c.map(String).join(' ');
  }
  return typeof c === 'string' ? c : null;
}

const NEUTRAL = new Set(['cd', 'pushd', 'popd', 'set-location', 'sl', 'echo', 'true', ':', 'set', 'export', 'printf', 'write-host', 'write-output']);

export interface ReviewPlan {
  /** Repository the command acts on (after `cd X &&` and `git -C X`). */
  repo: string;
  /** Working-tree changes to review, or null when only commits ship (`git push` alone). */
  scope: ChangeScope | null;
  /** Review the commits a push would send. */
  push: boolean;
  /** The command is a git command, so it needs a readable repository. */
  needsRepo: boolean;
}

/** git commit: -a/--all or pathspecs commit tracked work-tree changes; otherwise only the index. */
function commitScope(args: string[]): ChangeScope {
  const withValue = ['-m', '--message', '-F', '--file', '-C', '-c', '--reuse-message', '--reedit-message', '-t', '--template', '--author', '--date', '--fixup', '--squash', '--cleanup', '--trailer', '-S'];
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w === '--') return i + 1 < args.length ? 'tracked' : 'staged';
    if (w === '--all' || w === '--include' || w === '-i' || w === '--only' || w === '-o') return 'tracked';
    if (w.startsWith('--')) { if (withValue.includes(w)) i++; continue; }
    if (w.startsWith('-')) {
      for (const ch of w.slice(1)) {
        if (ch === 'a') return 'tracked';
        if ('mFcCt'.includes(ch)) { if (w.endsWith(ch)) i++; break; }
      }
      continue;
    }
    return 'tracked'; // a pathspec
  }
  return 'staged';
}

/** Work out what a risky command would ship, and from which repository. */
export function reviewPlan(commands: string[][], cwd: string): ReviewPlan {
  let dir = cwd;
  let repo = '';
  const real: string[][] = [];
  let push = false;
  let commit: ChangeScope | null = null;
  let needsRepo = false;
  for (const argv of commands) {
    const p = progName(argv[0]);
    if (['cd', 'pushd', 'set-location', 'sl'].includes(p) && argv[1] && !argv[1].startsWith('-')) { dir = resolve(dir, argv[1]); continue; }
    if (NEUTRAL.has(p)) continue;
    real.push(argv);
    if (p !== 'git') continue;
    needsRepo = true;
    const i = gitSubcommandIndex(argv);
    const c = argv.slice(1, i).indexOf('-C');
    const at = c >= 0 && argv[c + 2] ? resolve(dir, argv[c + 2]) : dir;
    const sub = argv[i];
    if (sub === 'push') { push = true; repo ||= at; }
    if (sub === 'commit') { commit = commitScope(argv.slice(i + 1)); repo ||= at; }
  }
  repo ||= dir;
  const onlyGit = (sub: string) => real.length > 0 && real.every(a => progName(a[0]) === 'git' && a[gitSubcommandIndex(a)] === sub);
  // A lone push ships commits only; a lone commit ships the index (or tracked files with -a);
  // anything else (git add && git commit, npm publish, rm -rf …) is reviewed against the whole tree.
  const scope: ChangeScope | null = onlyGit('push') ? null : real.length === 1 && commit ? commit : 'all';
  return { repo, scope, push, needsRepo };
}

const block = (path: string, lines: string[]) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}`;

/**
 * The diff a risky command would ship, bound into the review: the command itself as a pseudo-file,
 * the commits a push sends (SHAs listed, so a new commit means a new review) and their diff, and the
 * working-tree changes the command takes. Anything unreadable or incomplete is an error: the gate
 * then denies instead of letting a reviewer approve a command they can't see the effect of.
 */
export async function gateDiff(command: string, cwd: string, commands = classify(command).commands):
  Promise<{ diff: string; paths: string[]; branch: string; repo: string } | { error: string; repo: string }> {
  const parts = [block('.litti/command', [command.replace(/\r?\n/g, ' ')])];
  const plan = reviewPlan(commands, cwd);
  const paths: string[] = [];
  let branch = '';
  try {
    if (plan.push) {
      const out = await readOutgoing(plan.repo);
      if (out.truncated) return { repo: plan.repo, error: `the push sends ${out.commits.length} commits or more than 512 KB of changes, too much to review in one go. Push smaller pieces.` };
      parts.push(block('.litti/commits', out.commits.length
        ? [`push sends ${out.commits.length} commit(s) ${out.upstream ? `ahead of ${out.upstream}` : 'that no remote has yet'}:`, ...out.commits]
        : [`nothing ahead of ${out.upstream || 'the remotes'}`]));
      if (out.diff) { parts.push(out.diff.replace(/\n$/, '')); paths.push(...splitDiff(out.diff).map(f => f.path)); }
    }
    if (plan.scope) {
      const c = await readChanges(plan.repo, plan.scope);
      if (c.truncated) return { repo: plan.repo, error: 'the change is too large to review in one go (over 512 KB, over 200 new files, or a file git can\'t read). Split it into smaller commits.' };
      branch = c.branch;
      if (c.files.length) { parts.push(c.diff); paths.push(...c.files.map(f => f.path)); }
    }
  } catch (err) {
    const notRepo = /Not a git repository/.test((err as Error).message);
    // Outside git (vercel --prod in a plain folder) the command itself is all there is to review.
    if (notRepo && !plan.needsRepo) return { diff: parts[0], paths: [], branch: '', repo: plan.repo };
    return { repo: plan.repo, error: notRepo ? `${plan.repo} is not a git repository Litti can read.` : 'Litti could not read the changes (git failed or the diff is too large).' };
  }
  return { diff: parts.join('\n'), paths: [...new Set(paths)], branch, repo: plan.repo };
}

export interface GateOptions {
  url?: string;
  apiKey?: string;
  agent?: string;
  failOpen?: boolean;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * Things an agent must never do, whatever the tier: mint a personal review link (that is how a
 * human approves) or read the admin key / Litti's config file that holds it. Denied without
 * asking the server, so it also holds when Litti is down.
 */
const AGENT_FORBIDDEN = /\blitti(?:\.cmd)?\b[^|;&\n]*?\breview\b|review-link|LITTI_ADMIN_KEY|\.litti[\\/]+config\.env/i;

/** Decide whether an agent may run a shell command now. */
export async function gate(command: string, cwd: string, opts: GateOptions = {}): Promise<GateDecision> {
  if (AGENT_FORBIDDEN.test(command)) {
    return {
      decision: 'deny',
      reason: '🔒 Litti: agents may not create review links or read Litti\'s admin key. Reviews are done by a person. Ask the user to review the pending action instead.',
    };
  }
  const c = classify(command);
  if (!c.risky) return { decision: 'allow', reason: '' };

  const url = (opts.url ?? process.env.LITTI_URL ?? `http://127.0.0.1:${process.env.APPROVAL_SERVER_PORT || 3847}`).replace(/\/$/, '');
  const agent = opts.agent ?? process.env.LITTI_AGENT_NAME ?? 'agent';
  const failOpen = opts.failOpen ?? process.env.LITTI_HOOK_FAIL_OPEN === 'true';
  const shipped = await gateDiff(command, cwd, c.commands);
  if ('error' in shipped) {
    return {
      decision: 'deny',
      reason: `🔒 Litti blocked "${command.slice(0, 120)}" (${c.why}): ${shipped.error} Nothing was sent for review. Do not work around this block; tell the user.`,
    };
  }
  const { diff, paths, branch } = shipped;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-litti-agent': '1' };
  const key = opts.apiKey ?? process.env.LITTI_API_KEY;
  if (key) headers['x-litti-key'] = key;

  let data: any;
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${url}/api/gate`, {
      method: 'POST', headers, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        agent, action: c.action, command,
        description: `${agent} wants to run: ${command.replace(/\s+/g, ' ').slice(0, 200)}${branch ? ` (on ${branch})` : ''}`,
        diff, repo: shipped.repo, touchedPaths: paths, reversible: c.action === 'edit',
        rollbackPlan: c.action === 'edit' ? 'git reset --soft HEAD~1' : '',
      }),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok && !data?.decision) throw new Error(data?.message || `HTTP ${res.status}`);
  } catch (err) {
    if (failOpen) return { decision: 'allow', reason: `Litti unreachable (${(err as Error).message}); allowed because LITTI_HOOK_FAIL_OPEN=true.` };
    return {
      decision: 'deny',
      reason: `🔒 Litti blocked "${command.slice(0, 120)}" (${c.why}): the Litti server at ${url} is unreachable, so this can't be reviewed. Ask the human to start Litti (run \`litti\`), then try again. Do not work around this block.`,
    };
  }

  if (data.decision === 'allow') return { decision: 'allow', reason: data.message ?? '', actionId: data.id };
  return {
    decision: 'deny',
    approvalUrl: data.approvalUrl,
    actionId: data.id,
    reason: data.message
      ?? `🔒 Litti: "${command.slice(0, 120)}" (${c.why}) needs human review first. Review: ${data.approvalUrl ?? 'open the Litti inbox'}`,
  };
}
