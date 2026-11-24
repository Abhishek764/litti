/**
 * Risky-command classifier for the agent gate.
 *
 * A command line is tokenised like a shell would (quotes, `&&`/`||`/`;`/`|` chains, subshells,
 * `$(…)` and backticks), wrappers are peeled off (env assignments, sudo, env, npx, `sh -c "…"`,
 * `bash -lc`, eval, `pwsh -Command`, `cmd /c`), and each simple command is matched on its program
 * and arguments. Text inside quotes is only ever an argument, so `grep "git push" docs/` and
 * `echo "DROP TABLE"` stay free. Backslashes are tried both as bash escapes (`g\it push`) and as
 * Windows path separators (`C:\tools\git.exe push`); either reading being risky is enough.
 */
import type { ActionKind } from '../types.js';

export interface Classification {
  risky: boolean;
  action: ActionKind;
  why: string;
  /** The simple commands found (argv after wrappers were removed). Used to pick the diff to review. */
  commands: string[][];
}

interface Hit { action: ActionKind; why: string }

const SEVERITY: Record<string, number> = { delete: 4, deploy: 3, migrate: 2, edit: 1 };
const MAX_DEPTH = 6;

// ───────────────────────── tokeniser ─────────────────────────

/** Index of the `)` matching the `(` at `open`, or the end of the string. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) return s.length; i = j; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return s.length;
}

/**
 * Split a command line into simple commands (argv arrays). Command substitutions are returned
 * as further commands. `escapes` = treat `\` as the bash escape character.
 */
export function splitCommands(line: string, escapes = true, depth = 0): string[][] {
  const cmds: string[][] = [];
  const nested: string[] = [];
  let cur: string[] = [];
  let word = '';
  let inWord = false;
  const flushWord = () => { if (inWord) cur.push(word); word = ''; inWord = false; };
  const flushCmd = () => { flushWord(); if (cur.length) cmds.push(cur); cur = []; };
  const s = line;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      let j = s.indexOf("'", i + 1);
      if (j < 0) j = s.length;
      word += s.slice(i + 1, j); inWord = true; i = j; continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && escapes && j + 1 < s.length && '"\\$`'.includes(s[j + 1])) { word += s[j + 1]; j += 2; continue; }
        if (s[j] === '$' && s[j + 1] === '(') { const end = matchParen(s, j + 1); nested.push(s.slice(j + 2, end)); word += s.slice(j, end + 1); j = end + 1; continue; }
        if (s[j] === '`') { const end = s.indexOf('`', j + 1); if (end > 0) { nested.push(s.slice(j + 1, end)); word += s.slice(j, end + 1); j = end + 1; continue; } }
        word += s[j]; j++;
      }
      inWord = true; i = j; continue;
    }
    if (c === '\\' && escapes) {
      if (i + 1 < s.length && s[i + 1] !== '\n') { word += s[i + 1]; inWord = true; }
      i++; continue;
    }
    if (c === '$' && s[i + 1] === '(') {
      const end = matchParen(s, i + 1);
      nested.push(s.slice(i + 2, end)); word += s.slice(i, end + 1); inWord = true; i = end; continue;
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > 0) { nested.push(s.slice(i + 1, end)); word += s.slice(i, end + 1); inWord = true; i = end; continue; }
    }
    if (c === '#' && !inWord) { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j - 1; continue; }
    if (c === '\n' || c === '\r') { flushCmd(); continue; }
    if (c === ' ' || c === '\t') { flushWord(); continue; }
    // Redirections like 2>&1, >&2, &> stay inside a word; any other & | ; ( ) ends the command.
    if (c === '&' && (s[i - 1] === '>' || s[i - 1] === '<' || s[i + 1] === '>')) { word += c; inWord = true; continue; }
    if ('|&;()'.includes(c)) { flushCmd(); continue; }
    word += c; inWord = true;
  }
  flushCmd();
  if (depth < MAX_DEPTH) for (const n of nested) cmds.push(...splitCommands(n, escapes, depth + 1));
  return cmds;
}

// ───────────────────────── wrappers ─────────────────────────

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}', 'time', 'source', '.', 'call', 'start']);
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Lowercased program name without directory or Windows executable suffix. */
export function progName(word: string): string {
  return (word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');
}

/** Drop leading option words; `withValue` options also drop their value. */
function skipOpts(argv: string[], start: number, withValue: string[] = []): number {
  let i = start;
  while (i < argv.length && argv[i].startsWith('-') && argv[i] !== '-') {
    if (argv[i] === '--') return i + 1;
    if (withValue.includes(argv[i])) i++;
    i++;
  }
  return i;
}

type Peeled = { argv: string[] } | { script: string };

/** Remove wrappers. Returns the real argv, or a script string to classify recursively. */
function peel(argv: string[]): Peeled {
  let a = argv.slice();
  for (let guard = 0; guard < 12 && a.length; guard++) {
    const p = progName(a[0]);
    if (KEYWORDS.has(p) || ASSIGN.test(a[0])) { a = a.slice(1); continue; }
    if (p === 'sudo' || p === 'doas') { a = a.slice(skipOpts(a, 1, ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U'])); continue; }
    if (p === 'env') {
      const s = a.findIndex((w, i) => i > 0 && (w === '-S' || w === '--split-string'));
      if (s > 0 && a[s + 1]) return { script: a.slice(s + 1).join(' ') };
      a = a.slice(skipOpts(a, 1, ['-u', '--unset', '-C', '--chdir'])); continue;
    }
    if (['nohup', 'command', 'builtin', 'exec', 'chronic', 'unbuffer', 'caffeinate', 'cross-env', 'dotenvx', 'with-env'].includes(p)) {
      a = a.slice(skipOpts(a, 1, ['-a'])); continue;
    }
    if (p === 'nice' || p === 'ionice' || p === 'stdbuf' || p === 'watch') { a = a.slice(skipOpts(a, 1, ['-n', '-c', '-o', '-e', '-i'])); continue; }
    if (p === 'timeout') { const i = skipOpts(a, 1, ['-s', '-k', '--signal', '--kill-after']); a = a.slice(i + 1); continue; }
    if (p === 'xargs') { a = a.slice(skipOpts(a, 1, ['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a'])); continue; }
    if (p === 'dotenv') { const i = a.indexOf('--'); a = i > 0 ? a.slice(i + 1) : a.slice(skipOpts(a, 1, ['-e', '-v', '-c'])); continue; }
    if (['npx', 'pnpx', 'bunx', 'uvx'].includes(p)) { a = a.slice(skipOpts(a, 1, ['-p', '--package', '-c', '--call', '--from'])); continue; }
    if ((p === 'npm' || p === 'pnpm' || p === 'yarn' || p === 'bun') && ['exec', 'dlx', 'x'].includes(a[1] ?? '')) { a = a.slice(skipOpts(a, 2, ['-p', '--package', '-c'])); continue; }
    if (p === 'pipx' && a[1] === 'run') { a = a.slice(skipOpts(a, 2)); continue; }
    if (['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'ash', 'busybox'].includes(p)) {
      const ci = a.findIndex((w, i) => i > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w));
      if (ci > 0) return { script: a[ci + 1] ?? '' };
      const i = skipOpts(a, 1, ['-o', '+o', '-O']);
      if (i < a.length) { a = a.slice(i); continue; } // bash deploy.sh → deploy.sh
      return { argv: [] };
    }
    if (p === 'eval') return { script: a.slice(1).join(' ') };
    if (p === 'cmd') {
      const i = a.findIndex(w => /^\/[ck]$/i.test(w));
      return i > 0 ? { script: a.slice(i + 1).join(' ') } : { argv: [] };
    }
    if (p === 'powershell' || p === 'pwsh') {
      for (let i = 1; i < a.length; i++) {
        const w = a[i].toLowerCase();
        if (/^-(e|ec|en|enc|encodedcommand|encoded)$/.test(w) && a[i + 1]) {
          try { return { script: Buffer.from(a[i + 1], 'base64').toString('utf16le') }; } catch { return { script: '' }; }
        }
        if (/^-c(o(m(m(a(n(d)?)?)?)?)?)?$/.test(w)) return { script: a.slice(i + 1).join(' ') };
        if (/^-f(i(l(e)?)?)?$/.test(w)) { a = a.slice(i + 1); break; }
        if (/^-(executionpolicy|ep|ex|exec|workingdirectory|wd|configurationname|settingsfile|outputformat|of|inputformat|if|windowstyle|w)$/.test(w)) { i++; continue; }
        if (!w.startsWith('-')) return { script: a.slice(i).join(' ') };
      }
      if (progName(a[0] ?? '') === p) return { argv: [] };
      continue;
    }
    break;
  }
  return { argv: a };
}

// ───────────────────────── rules ─────────────────────────

const DEPLOY_NAME = /^(deploy|release|publish|ship)([-_.:].*)?$|[-_:](deploy|release|publish)$/i;
const DESTRUCTIVE_SQL = /\b(drop\s+(table|database|schema|column|index|view|function|trigger|owned)|truncate\b|delete\s+from)\b/i;
const SQL_CLIENTS = ['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'clickhouse-client', 'duckdb', 'cockroach', 'pgcli', 'mycli', 'litecli', 'turso', 'wrangler'];

const nonFlags = (args: string[]) => args.filter(w => !w.startsWith('-'));
const scriptName = (w: string) => progName(w).replace(/\.(sh|bash|ps1|js|mjs|cjs|ts|py|rb|pl)$/, '');

/** Short flag clusters (`-rf`) and long flags, for "does this command have flag X". */
function flagSet(args: string[]): { short: Set<string>; long: Set<string> } {
  const short = new Set<string>();
  const long = new Set<string>();
  for (const w of args) {
    if (w === '--') break;
    if (w.startsWith('--')) long.add(w.split('=')[0].toLowerCase());
    else if (/^-[A-Za-z]+$/.test(w)) for (const ch of w.slice(1)) short.add(ch);
  }
  return { short, long };
}

const GIT_OPTS_WITH_VALUE = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--exec-path', '--config-env', '--list-cmds'];

/** Index of the git subcommand after global options (-C dir, -c k=v, --no-pager, --git-dir=…). */
export function gitSubcommandIndex(argv: string[]): number {
  let i = 1;
  while (i < argv.length && argv[i].startsWith('-')) {
    if (GIT_OPTS_WITH_VALUE.includes(argv[i])) i++;
    i++;
  }
  return i;
}

function gitRule(argv: string[], env: NodeJS.ProcessEnv): Hit | null {
  const i = gitSubcommandIndex(argv);
  const sub = (argv[i] ?? '').toLowerCase();
  const rest = argv.slice(i + 1);
  const { short, long } = flagSet(rest);
  const has = (...f: string[]) => f.some(x => (x.startsWith('--') ? long.has(x) : short.has(x.slice(1))));
  const history = (why: string): Hit => ({ action: 'delete', why });
  switch (sub) {
    case 'push':
      if (has('--force', '--force-with-lease', '--mirror', '--delete', '--prune', '-f', '-d') || rest.some(w => /^\+|^:/.test(w))) return history('history-rewriting git command (force push / remote delete)');
      return { action: 'deploy', why: 'git push' };
    case 'commit':
      return env.LITTI_GATE_COMMIT === 'false' ? null : { action: 'edit', why: 'git commit' };
    case 'merge':
      return has('--abort', '--quit') ? null : { action: 'edit', why: 'merge' };
    case 'rebase':
      return has('--abort', '--quit', '--show-current-patch') ? null : history('history-rewriting git command (rebase)');
    case 'reset':
      return has('--hard', '--merge', '--keep') ? history('history-rewriting git command (reset --hard)') : null;
    case 'clean':
      return has('-f', '--force') ? history('git clean (deletes untracked files)') : null;
    case 'branch':
      return has('-D') || (has('-d', '--delete') && has('-f', '--force')) ? history('history-rewriting git command (branch delete)') : null;
    case 'tag':
      return has('-d', '--delete') ? history('git tag delete') : null;
    case 'stash':
      return ['drop', 'clear'].includes(rest[0] ?? '') ? history('git stash drop/clear') : null;
    case 'checkout':
      return rest.includes('--') || rest.includes('.') || has('-f', '--force') ? history('git checkout discards local changes') : null;
    case 'switch':
      return has('-f', '--force', '--discard-changes') ? history('git switch discards local changes') : null;
    case 'restore':
      return !has('-S', '--staged') || has('-W', '--worktree') ? history('git restore discards local changes') : null;
    case 'rm':
      return has('-r') && !has('--cached') ? history('git rm -r') : null;
    case 'filter-branch': case 'filter-repo':
      return history('history-rewriting git command (filter)');
    case 'update-ref':
      return has('-d') ? history('git update-ref -d') : null;
    case 'reflog':
      return ['expire', 'delete'].includes(rest[0] ?? '') ? history('git reflog expire/delete') : null;
    default:
      return null;
  }
}

const VALUE_FLAGS_PKG = ['--prefix', '-C', '--dir', '--workspace', '-w', '--filter', '-F', '--cwd', '--registry', '--otp', '--tag'];

function packageManagerRule(p: string, args: string[]): Hit | null {
  const i = skipOpts(args, 0, VALUE_FLAGS_PKG);
  const sub = (args[i] ?? '').toLowerCase();
  const rest = args.slice(i + 1);
  if (['publish', 'unpublish', 'deprecate'].includes(sub)) return { action: 'deploy', why: 'package publish' };
  if (p === 'yarn' && sub === 'npm' && rest.includes('publish')) return { action: 'deploy', why: 'package publish' };
  if (['run', 'run-script', 'rum', 'urn'].includes(sub)) {
    const script = rest[skipOpts(rest, 0, VALUE_FLAGS_PKG)] ?? '';
    if (DEPLOY_NAME.test(script)) return { action: 'deploy', why: `${p} run ${script}` };
    return null;
  }
  // yarn/pnpm/bun run package scripts without "run".
  if (p !== 'npm' && DEPLOY_NAME.test(sub)) return { action: 'deploy', why: `${p} ${sub}` };
  return null;
}

const KUBE_VALUE_FLAGS = ['-n', '--namespace', '--context', '--kubeconfig', '--cluster', '--user', '-s', '--server', '--as', '--token'];
const KUBE_MUTATING = ['apply', 'create', 'replace', 'scale', 'patch', 'set', 'edit', 'drain', 'cordon', 'taint', 'autoscale', 'expose', 'label', 'annotate'];

function awsRule(args: string[]): Hit | null {
  const words = nonFlagsSkipping(args, ['--profile', '--region', '--output', '--endpoint-url', '--query']);
  const [svc, op] = [words[0] ?? '', words[1] ?? ''];
  const { long } = flagSet(args);
  if (svc === 's3') {
    if (op === 'rb' || (op === 'rm' && long.has('--recursive')) || (op === 'sync' && long.has('--delete'))) return { action: 'delete', why: 'aws s3 delete' };
    if ((op === 'cp' || op === 'sync' || op === 'mv') && words.slice(2).at(-1)?.startsWith('s3://')) return { action: 'deploy', why: 'aws s3 upload' };
    return null;
  }
  if (/^(delete|terminate|remove|deregister|purge)/.test(op)) return { action: 'delete', why: `aws ${svc} ${op}` };
  if (/^(deploy|update-function-code|publish|create-deployment|update-service|update-stack|create-stack|execute-change-set|put-bucket-policy|update-function-configuration)/.test(op)) return { action: 'deploy', why: `aws ${svc} ${op}` };
  return null;
}

/** Non-flag words, also skipping the values of the given options. */
function nonFlagsSkipping(args: string[], withValue: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('-')) { if (withValue.includes(args[i])) i++; continue; }
    out.push(args[i]);
  }
  return out;
}

/** Classify one simple command (wrappers already removed). */
function ruleFor(argv: string[], env: NodeJS.ProcessEnv): Hit | null {
  if (!argv.length) return null;
  const p = progName(argv[0]);
  const args = argv.slice(1);
  const words = nonFlags(args).map(w => w.toLowerCase());
  const { short, long } = flagSet(args);
  const lowerArgs = args.map(w => w.toLowerCase());

  // A program name we can't know (`$GIT push`, `$(echo git) push`) with a risky verb.
  if (/[$`%]/.test(argv[0]) && words.some(w => ['push', 'commit', 'publish', 'deploy', 'apply', 'delete', 'merge', 'destroy', 'upload'].includes(w))) {
    return { action: 'deploy', why: 'dynamic command with a risky verb' };
  }

  switch (p) {
    case 'git': return gitRule(argv, env);
    case 'rm':
      return (short.has('r') || short.has('R') || long.has('--recursive')) && (short.has('f') || long.has('--force')) ? { action: 'delete', why: 'recursive delete' } : null;
    case 'remove-item': case 'ri':
      return lowerArgs.some(w => /^-r(e(c(u(r(s(e)?)?)?)?)?)?(:\$true)?$/.test(w)) ? { action: 'delete', why: 'recursive delete' } : null;
    case 'rmdir': case 'rd': case 'del': case 'erase':
      return lowerArgs.some(w => w === '/s' || /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/.test(w)) ? { action: 'delete', why: 'recursive delete' } : null;
    case 'find':
      return lowerArgs.includes('-delete') || lowerArgs.some((w, i) => ['-exec', '-execdir', '-ok', '-okdir'].includes(w) && ['rm', 'shred', 'unlink'].includes(progName(args[i + 1] ?? ''))) ? { action: 'delete', why: 'find -delete' } : null;
    case 'shred': case 'wipefs': return { action: 'delete', why: 'destructive disk command' };
    case 'dd': return args.some(w => /^of=\/dev\//.test(w)) ? { action: 'delete', why: 'destructive disk command' } : null;

    case 'npm': case 'pnpm': case 'yarn': case 'bun': return packageManagerRule(p, args);
    case 'make': case 'just': case 'task': case 'mise': case 'rake-deploy':
      return words.some(w => !w.includes('=') && DEPLOY_NAME.test(w)) ? { action: 'deploy', why: `${p} ${words.find(w => DEPLOY_NAME.test(w))}` } : null;
    case 'cargo': return ['publish', 'yank'].includes(words[0]) ? { action: 'deploy', why: 'package publish' } : null;
    case 'gem': return ['push', 'yank'].includes(words[0]) ? { action: 'deploy', why: 'package publish' } : null;
    case 'twine': return words[0] === 'upload' ? { action: 'deploy', why: 'package publish' } : null;
    case 'poetry': case 'uv': case 'flit': case 'hatch': case 'pdm': case 'jsr': case 'deno': case 'vsce': case 'ovsx':
      return words[0] === 'publish' ? { action: 'deploy', why: 'package publish' } : null;
    case 'dotnet': return words[0] === 'nuget' && ['push', 'delete'].includes(words[1]) ? { action: 'deploy', why: 'package publish' } : null;
    case 'mvn': case 'mvnw': return words.some(w => w === 'deploy' || w.startsWith('release:')) ? { action: 'deploy', why: 'maven deploy' } : null;
    case 'gradle': case 'gradlew': return words.some(w => /publish/i.test(w)) ? { action: 'deploy', why: 'gradle publish' } : null;
    case 'pod': return words[0] === 'trunk' && words[1] === 'push' ? { action: 'deploy', why: 'package publish' } : null;
    case 'docker': case 'podman': case 'nerdctl': case 'buildah':
      return words.includes('push') || long.has('--push') ? { action: 'deploy', why: 'image push' } : null;

    case 'terraform': case 'tofu': case 'terragrunt': {
      const w = words.filter(x => !x.startsWith('-'));
      if (w.includes('destroy')) return { action: 'delete', why: 'infrastructure change (destroy)' };
      return w.some(x => ['apply', 'import', 'taint', 'run-all'].includes(x)) || (w[0] === 'state' && ['rm', 'mv', 'push'].includes(w[1])) ? { action: 'deploy', why: 'infrastructure change' } : null;
    }
    case 'pulumi':
      return words.includes('destroy') ? { action: 'delete', why: 'infrastructure change (destroy)' } : words.some(w => ['up', 'update', 'import', 'refresh'].includes(w)) ? { action: 'deploy', why: 'infrastructure change' } : null;
    case 'kubectl': case 'oc': case 'kubecolor': {
      const w = nonFlagsSkipping(args, KUBE_VALUE_FLAGS).map(x => x.toLowerCase());
      const verb = w[0] ?? '';
      if (verb === 'delete') return { action: 'delete', why: 'infrastructure change (kubectl delete)' };
      if (KUBE_MUTATING.includes(verb)) return { action: 'deploy', why: `infrastructure change (kubectl ${verb})` };
      if (verb === 'rollout' && ['restart', 'undo', 'pause', 'resume'].includes(w[1] ?? '')) return { action: 'deploy', why: `infrastructure change (kubectl rollout ${w[1]})` };
      return null;
    }
    case 'helm':
      return ['uninstall', 'delete'].includes(words[0]) ? { action: 'delete', why: 'infrastructure change' } : ['install', 'upgrade', 'rollback'].includes(words[0]) ? { action: 'deploy', why: 'infrastructure change' } : null;

    case 'vercel': case 'vc':
      return long.has('--prod') || long.has('--production') || ['deploy', 'promote', 'rollback', 'remove', 'rm', 'redeploy'].includes(words[0] ?? '') ? { action: 'deploy', why: 'deploy' } : null;
    case 'netlify': return words[0] === 'deploy' || words[0] === 'sites:delete' ? { action: 'deploy', why: 'deploy' } : null;
    case 'fly': case 'flyctl':
      return words.some(w => ['deploy', 'destroy', 'scale', 'launch'].includes(w)) ? { action: 'deploy', why: 'deploy' } : null;
    case 'railway': return ['up', 'deploy', 'down', 'redeploy'].includes(words[0]) ? { action: 'deploy', why: 'deploy' } : null;
    case 'wrangler':
      if (['deploy', 'publish', 'delete', 'rollback'].includes(words[0]) || (words[0] === 'pages' && words[1] === 'deploy')) return { action: 'deploy', why: 'deploy' };
      return words[0] === 'd1' && args.some(w => DESTRUCTIVE_SQL.test(w)) ? { action: 'delete', why: 'destructive SQL' } : null;
    case 'firebase': return words.some(w => w === 'deploy' || /:(delete|disable)$/.test(w)) ? { action: 'deploy', why: 'deploy' } : null;
    case 'serverless': case 'sls': return ['deploy', 'remove'].includes(words[0]) ? { action: 'deploy', why: 'deploy' } : null;
    case 'eb': return ['deploy', 'terminate'].includes(words[0]) ? { action: 'deploy', why: 'deploy' } : null;
    case 'cdk': case 'cdktf': return ['deploy', 'destroy'].includes(words[0]) ? { action: 'deploy', why: 'deploy' } : null;
    case 'sam': return ['deploy', 'delete'].includes(words[0]) ? { action: 'deploy', why: 'deploy' } : null;
    case 'heroku':
      return words.some(w => /^(releases:rollback|apps:destroy|apps:delete|ps:scale|container:release|pg:reset|addons:destroy|deploy)/.test(w)) ? { action: 'deploy', why: 'deploy' } : null;
    case 'gcloud':
      return words.includes('delete') ? { action: 'delete', why: 'gcloud delete' } : words.some(w => w === 'deploy' || w === 'update-traffic') ? { action: 'deploy', why: 'deploy' } : null;
    case 'az':
      return words.includes('delete') ? { action: 'delete', why: 'az delete' } : words.includes('deploy') || (words.includes('deployment') && words.includes('create')) ? { action: 'deploy', why: 'deploy' } : null;
    case 'aws': return awsRule(args);
    case 'gh':
      if (words[0] === 'release' && ['create', 'delete', 'upload', 'edit'].includes(words[1])) return { action: 'deploy', why: 'GitHub release' };
      if (words[0] === 'repo' && ['delete', 'archive', 'rename'].includes(words[1])) return { action: 'delete', why: 'GitHub repo delete' };
      if (words[0] === 'pr' && words[1] === 'merge') return { action: 'edit', why: 'merge' };
      if (words[0] === 'workflow' && words[1] === 'run') return { action: 'deploy', why: 'GitHub workflow run' };
      return null;

    // Database migrations and destructive database commands.
    case 'prisma':
      if (words[0] === 'migrate' && ['deploy', 'reset', 'resolve'].includes(words[1])) return { action: 'migrate', why: 'database migration' };
      return words[0] === 'db' && ['push', 'execute'].includes(words[1]) ? { action: 'migrate', why: 'database migration' } : null;
    case 'knex': return words.some(w => w.startsWith('migrate:')) ? { action: 'migrate', why: 'database migration' } : null;
    case 'sequelize': case 'sequelize-cli': return words.some(w => /^db:(migrate|drop|seed)/.test(w)) ? { action: 'migrate', why: 'database migration' } : null;
    case 'alembic': return ['upgrade', 'downgrade', 'stamp'].includes(words[0]) ? { action: 'migrate', why: 'database migration' } : null;
    case 'rails': case 'rake': case 'bin-rails':
      if (words.some(w => /^db:(drop|reset|purge|schema:load)/.test(w))) return { action: 'delete', why: 'destructive database command' };
      return words.some(w => /^db:(migrate|rollback|setup|seed)/.test(w)) ? { action: 'migrate', why: 'database migration' } : null;
    case 'manage.py': case 'django-admin':
      if (words.some(w => ['flush', 'sqlflush', 'reset_db'].includes(w))) return { action: 'delete', why: 'destructive database command' };
      return words.includes('migrate') ? { action: 'migrate', why: 'database migration' } : null;
    case 'flyway': return words.some(w => ['migrate', 'clean', 'undo', 'repair', 'baseline'].includes(w)) ? { action: 'migrate', why: 'database migration' } : null;
    case 'liquibase': return words.some(w => /^(update|rollback|drop-?all)/i.test(w)) ? { action: 'migrate', why: 'database migration' } : null;
    case 'drizzle-kit': return ['push', 'migrate', 'drop'].includes(words[0]) ? { action: 'migrate', why: 'database migration' } : null;
    case 'typeorm': return words.some(w => /^(migration:(run|revert)|schema:(drop|sync))/.test(w)) ? { action: 'migrate', why: 'database migration' } : null;
    case 'sqlx': case 'goose': case 'migrate': case 'dbmate': case 'atlas': case 'supabase':
      return words.some(w => ['up', 'down', 'run', 'revert', 'drop', 'force', 'migrate', 'rollback', 'apply', 'push', 'reset'].includes(w)) ? { action: 'migrate', why: 'database migration' } : null;
    case 'redis-cli': return lowerArgs.some(w => w === 'flushall' || w === 'flushdb') ? { action: 'delete', why: 'destructive database command' } : null;
    case 'mongosh': case 'mongo':
      return args.some(w => /dropDatabase|\.drop\(|deleteMany|remove\(/.test(w)) ? { action: 'delete', why: 'destructive database command' } : null;

    // Interpreters running a deploy script: node scripts/deploy.js, python manage.py migrate.
    case 'node': case 'python': case 'python3': case 'py': case 'ruby': case 'perl': case 'tsx': case 'ts-node': case 'php': {
      const i = skipOpts(args, 0, ['-r', '--require', '--import', '--loader', '-m', '-X', '-W']);
      if (i >= 2 && args[i - 2] === '-m') return null; // python -m module: not a script file
      const script = args[i];
      if (!script) return null;
      if (progName(script) === 'manage.py') return ruleFor(['manage.py', ...args.slice(i + 1)], env);
      return DEPLOY_NAME.test(scriptName(script)) ? { action: 'deploy', why: `deploy script (${progName(script)})` } : null;
    }
    default:
      if (SQL_CLIENTS.includes(p)) return args.some(w => DESTRUCTIVE_SQL.test(w)) ? { action: 'delete', why: 'destructive SQL' } : null;
      // ./deploy.sh, scripts/release.ps1, bin/publish
      if (/[\\/]/.test(argv[0]) || /\.(sh|ps1|bash)$/i.test(argv[0])) {
        return DEPLOY_NAME.test(scriptName(argv[0])) ? { action: 'deploy', why: `deploy script (${progName(argv[0])})` } : null;
      }
      return null;
  }
}

/** Every simple command in a line, wrappers removed, nested scripts expanded. */
function expand(line: string, escapes: boolean, depth = 0): string[][] {
  const out: string[][] = [];
  for (const raw of splitCommands(line, escapes)) {
    const peeled = peel(raw);
    if ('script' in peeled) { if (depth < MAX_DEPTH) out.push(...expand(peeled.script, escapes, depth + 1)); }
    else if (peeled.argv.length) out.push(peeled.argv);
  }
  return out;
}

/** Classify a shell command. Extra patterns: LITTI_GATE_PATTERNS (regex, `;;`-separated). */
export function classify(command: string, env: NodeJS.ProcessEnv = process.env): Classification {
  const cmd = command.trim();
  const commands = expand(cmd, true);
  let best: Hit | null = null;
  const consider = (h: Hit | null) => { if (h && (!best || SEVERITY[h.action] > SEVERITY[best.action])) best = h; };
  for (const argv of commands) consider(ruleFor(argv, env));
  // Windows reading: backslashes are path separators (C:\tools\git.exe push).
  if (cmd.includes('\\')) for (const argv of expand(cmd, false)) consider(ruleFor(argv, env));
  // SQL piped into a client: echo "DROP TABLE x" | psql
  if (commands.some(a => SQL_CLIENTS.includes(progName(a[0]))) && /[|<]/.test(cmd) && DESTRUCTIVE_SQL.test(cmd)) consider({ action: 'delete', why: 'destructive SQL' });
  if (best) { const b: Hit = best; return { risky: true, action: b.action, why: b.why, commands }; }
  for (const p of (env.LITTI_GATE_PATTERNS || '').split(';;').map(s => s.trim()).filter(Boolean)) {
    try { if (new RegExp(p, 'i').test(cmd)) return { risky: true, action: 'deploy', why: `matches LITTI_GATE_PATTERNS (${p})`, commands }; } catch { /* bad pattern: ignore */ }
  }
  return { risky: false, action: 'read', why: '', commands };
}
