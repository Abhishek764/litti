/**
 * `litti install <claude|codex|opencode|all> [--dir <project>]`
 *
 * Wires the Litti gate into a project's agent config. Existing settings are kept;
 * an earlier Litti entry is replaced, never duplicated.
 *
 *  - Claude Code: .claude/settings.json → hooks.PreToolUse (matcher "Bash|PowerShell"), onFailure "block"
 *  - Codex:       .codex/hooks.json     → hooks.PreToolUse (matcher "^Bash$"); trust it with /hooks
 *
 * Fail closed: if the hook can't run at all (node missing, Litti moved or uninstalled, a crash),
 * the shell form ends in `|| exit 2`, which both agents treat as "block". Claude Code also gets
 * `onFailure: "block"` (v2.1.295+), which covers timeouts. On Windows without Git Bash, Claude
 * Code runs hooks in PowerShell, where `||` doesn't parse (5.1), so there we write exec form
 * (`command: "node", args: [...]`), which needs no shell.
 *  - OpenCode:    .opencode/plugin/litti.ts (throws in tool.execute.before to block)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AgentName = 'claude' | 'codex' | 'opencode';
export const AGENTS: AgentName[] = ['claude', 'codex', 'opencode'];

const LITTI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fwd = (p: string) => p.replace(/\\/g, '/');

/** Paths the hook runs from in a source checkout: tsx and the TypeScript hook entry. */
export function hookPaths(root = LITTI_ROOT) {
  return {
    tsx: fwd(join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')),
    hook: fwd(join(root, 'src', 'integrations', 'hook-cli.ts')),
    compiled: fwd(join(root, 'dist', 'integrations', 'hook-cli.js')),
  };
}

/**
 * Arguments after `node` that run the hook. The installed npm package runs compiled
 * JavaScript; a source checkout (running under tsx) runs the TypeScript entry.
 */
export function hookArgv(root = LITTI_ROOT, compiledRun = import.meta.url.endsWith('.js')): string[] {
  const p = hookPaths(root);
  return compiledRun && existsSync(p.compiled) ? [p.compiled] : [p.tsx, p.hook];
}

/** Shell form: any failure to run the hook exits 2, which blocks the tool call. */
export function hookCommand(flavor: AgentName, root = LITTI_ROOT): string {
  return `node ${hookArgv(root).map(a => `"${a}"`).join(' ')} ${flavor} || exit 2`;
}

/** Git Bash, the shell Claude Code uses for hooks on Windows when it is installed. */
export function gitBashPath(env = process.env): string | null {
  const fromPath = (env.PATH ?? env.Path ?? '').split(delimiter)
    .filter(p => /[\\/]git[\\/](cmd|bin)$/i.test(p)).map(p => join(p, '..', 'bin', 'bash.exe'));
  const candidates = [
    env.CLAUDE_CODE_GIT_BASH_PATH,
    'C:/Program Files/Git/bin/bash.exe',
    'C:/Program Files (x86)/Git/bin/bash.exe',
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe') : undefined,
    ...fromPath,
  ];
  return candidates.find((p): p is string => typeof p === 'string' && p !== '' && existsSync(p)) ?? null;
}

/** The Claude Code hook entry. Exec form where Claude Code would run hooks in PowerShell. */
export function claudeHook(root = LITTI_ROOT, execForm = process.platform === 'win32' && !gitBashPath()): Record<string, unknown> {
  const base = { type: 'command', timeout: 30, onFailure: 'block' };
  return execForm
    ? { ...base, command: 'node', args: [...hookArgv(root), 'claude'] }
    : { ...base, command: hookCommand('claude', root) };
}

const isLittiHook = (h: any) =>
  /hook-cli\.(ts|js)/.test([h?.command, ...(Array.isArray(h?.args) ? h.args : [])].map(String).join(' '));

/** Add (or replace) the Litti PreToolUse hook in a Claude-Code-style hooks object. */
export function mergeHooks(config: any, command: string | Record<string, unknown>, matcher: string | undefined): any {
  const out = config && typeof config === 'object' && !Array.isArray(config) ? { ...config } : {};
  out.hooks = out.hooks && typeof out.hooks === 'object' ? { ...out.hooks } : {};
  const groups: any[] = Array.isArray(out.hooks.PreToolUse) ? out.hooks.PreToolUse : [];
  const kept = groups
    .map(g => ({ ...g, hooks: Array.isArray(g?.hooks) ? g.hooks.filter((h: any) => !isLittiHook(h)) : [] }))
    .filter(g => g.hooks.length > 0);
  const hook = typeof command === 'string' ? { type: 'command', command, timeout: 30 } : command;
  const entry: any = { hooks: [hook] };
  if (matcher) entry.matcher = matcher;
  out.hooks.PreToolUse = [...kept, entry];
  return out;
}

function readJson(file: string): any {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, 'utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error(`${file} is not valid JSON; fix it first, Litti won't overwrite it.`); }
}

function writeJson(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function openCodePlugin(root = LITTI_ROOT): string {
  return `// Litti gate for OpenCode: risky shell commands need a human review first.
// Generated by \`litti install opencode\`. Re-run it after updating or moving Litti.
import { spawnSync } from "node:child_process";

const HOOK_ARGS = ${JSON.stringify(hookArgv(root))};

export const Litti = async ({ directory }: { directory: string }) => ({
  "tool.execute.before": async (input: { tool: string }, output: { args: any }) => {
    if (input.tool !== "bash") return;
    const payload = JSON.stringify({ tool: "bash", args: output.args, cwd: directory });
    const r = spawnSync("node", [...HOOK_ARGS, "opencode"], { input: payload, encoding: "utf8", timeout: 25000 });
    let d: { decision?: string; reason?: string } = {};
    try { d = JSON.parse(r.stdout || "{}"); } catch { d = {}; }
    // Anything but an explicit allow blocks (fail closed).
    if (d.decision !== "allow") throw new Error(d.reason || "🔒 Litti: blocked (the Litti hook did not answer). Ask the user to check Litti.");
  },
});
`;
}

/** Install the gate for one agent into a project. Returns the file written and any follow-up notes. */
export function install(agent: AgentName, projectDir: string, root = LITTI_ROOT, opts: { execForm?: boolean } = {}): { file: string; notes: string[] } {
  const dir = resolve(projectDir);
  if (agent === 'claude') {
    const file = join(dir, '.claude', 'settings.json');
    writeJson(file, mergeHooks(readJson(file), claudeHook(root, opts.execForm), 'Bash|PowerShell'));
    return { file, notes: ['Restart Claude Code (or run /hooks) so it loads the hook.'] };
  }
  if (agent === 'codex') {
    const file = join(dir, '.codex', 'hooks.json');
    writeJson(file, mergeHooks(readJson(file), hookCommand('codex', root), '^Bash$'));
    return {
      file,
      notes: [
        'Open Codex in this project and run /hooks to trust the Litti hook (needed again after upgrading or moving Litti).',
        'Codex skips untrusted project hooks without a warning. Docs: https://learn.chatgpt.com/docs/hooks',
      ],
    };
  }
  const file = join(dir, '.opencode', 'plugin', 'litti.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, openCodePlugin(root));
  return { file, notes: ['Restart OpenCode so it loads the plugin. Needs `node` on PATH.'] };
}
