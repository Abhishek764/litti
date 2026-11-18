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
import { readChanges } from '../changes/git.js';
import type { ActionKind } from '../types.js';

export interface GateDecision {
  decision: 'allow' | 'deny';
  reason: string;
  approvalUrl?: string;
  actionId?: string;
}

interface Rule { re: RegExp; action: ActionKind; why: string }

/** What counts as risky. Order matters: the first match names the action. */
const RULES: Rule[] = [
  { re: /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i, action: 'delete', why: 'destructive SQL' },
  { re: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|\bRemove-Item\b.*-Recurse/i, action: 'delete', why: 'recursive delete' },
  { re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+.*(--force|-f\b)|branch\s+-D)/i, action: 'delete', why: 'history-rewriting git command' },
  { re: /\b(terraform|tofu)\s+(apply|destroy)|\bpulumi\s+(up|destroy)|\bkubectl\s+(apply|delete|replace|rollout)|\bhelm\s+(install|upgrade|uninstall|rollback)/i, action: 'deploy', why: 'infrastructure change' },
  { re: /\b(vercel|netlify|fly|flyctl|railway|wrangler|firebase|serverless|sls|eb|cdk)\b[^|;&]*\b(deploy|publish|up)\b|\bgcloud\s+.*\bdeploy\b|\baws\s+\S+\s+(delete|terminate|deploy)/i, action: 'deploy', why: 'deploy' },
  { re: /\b(npm|pnpm|yarn|bun|cargo|twine|gem|dotnet\s+nuget)\s+(publish|push)\b|\bdocker\s+push\b/i, action: 'deploy', why: 'package publish' },
  { re: /\b(prisma\s+migrate\s+(deploy|reset)|knex\s+migrate|sequelize\s+db:migrate|alembic\s+upgrade|rails\s+db:migrate|manage\.py\s+migrate|flyway\s+migrate|liquibase\s+update|drizzle-kit\s+(push|migrate))/i, action: 'migrate', why: 'database migration' },
  { re: /\bgit\s+push\b/i, action: 'deploy', why: 'git push' },
  { re: /\bgit\s+commit\b/i, action: 'edit', why: 'git commit' },
  { re: /\bgh\s+pr\s+merge\b|\bgit\s+merge\b/i, action: 'edit', why: 'merge' },
];

/** Classify a shell command. Extra patterns: LITTI_GATE_PATTERNS (regex, `;;`-separated). */
export function classify(command: string, env = process.env): { risky: boolean; action: ActionKind; why: string } {
  const cmd = command.trim();
  const commitOff = env.LITTI_GATE_COMMIT === 'false';
  for (const r of RULES) {
    if (commitOff && r.why === 'git commit') continue;
    if (r.re.test(cmd)) return { risky: true, action: r.action, why: r.why };
  }
  for (const p of (env.LITTI_GATE_PATTERNS || '').split(';;').map(s => s.trim()).filter(Boolean)) {
    try { if (new RegExp(p, 'i').test(cmd)) return { risky: true, action: 'deploy', why: `matches LITTI_GATE_PATTERNS (${p})` }; } catch { /* bad pattern: ignore */ }
  }
  return { risky: false, action: 'read', why: '' };
}

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

/** The diff a risky command would ship: the command itself as a pseudo-file, plus the working tree. */
export async function gateDiff(command: string, cwd: string): Promise<{ diff: string; paths: string[]; branch: string }> {
  const cmdBlock = `diff --git a/.litti/command b/.litti/command\n--- a/.litti/command\n+++ b/.litti/command\n@@ -0,0 +1 @@\n+${command.replace(/\r?\n/g, ' ')}`;
  try {
    const c = await readChanges(cwd);
    return { diff: c.files.length ? `${cmdBlock}\n${c.diff}` : cmdBlock, paths: c.files.map(f => f.path), branch: c.branch };
  } catch {
    return { diff: cmdBlock, paths: [], branch: '' };
  }
}

export interface GateOptions {
  url?: string;
  apiKey?: string;
  agent?: string;
  failOpen?: boolean;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

/** Decide whether an agent may run a shell command now. */
export async function gate(command: string, cwd: string, opts: GateOptions = {}): Promise<GateDecision> {
  const c = classify(command);
  if (!c.risky) return { decision: 'allow', reason: '' };

  const url = (opts.url ?? process.env.LITTI_URL ?? `http://127.0.0.1:${process.env.APPROVAL_SERVER_PORT || 3847}`).replace(/\/$/, '');
  const agent = opts.agent ?? process.env.LITTI_AGENT_NAME ?? 'agent';
  const failOpen = opts.failOpen ?? process.env.LITTI_HOOK_FAIL_OPEN === 'true';
  const { diff, paths, branch } = await gateDiff(command, cwd);
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
        diff, touchedPaths: paths, reversible: c.action === 'edit',
        rollbackPlan: c.action === 'edit' ? 'git reset --soft HEAD~1' : '',
      }),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok && !data?.decision) throw new Error(data?.message || `HTTP ${res.status}`);
  } catch (err) {
    if (failOpen) return { decision: 'allow', reason: `Litti unreachable (${(err as Error).message}); allowed because LITTI_HOOK_FAIL_OPEN=true.` };
    return {
      decision: 'deny',
      reason: `🔒 Litti blocked "${command.slice(0, 120)}" (${c.why}): the Litti server at ${url} is unreachable, so this can't be reviewed. Ask the human to start Litti (npm start), then try again. Do not work around this block.`,
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
