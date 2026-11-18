/**
 * PreToolUse hook entry point for coding agents.
 *
 *   node <litti>/node_modules/tsx/dist/cli.mjs <litti>/src/integrations/hook-cli.ts <claude|codex|opencode>
 *
 * Reads the agent's hook JSON on stdin, asks Litti whether the command may run, and answers
 * in the agent's format:
 *  - claude / codex: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
 *                    "permissionDecisionReason":"…"}} on stdout, exit 0. Nothing printed = allowed.
 *  - opencode:       {"decision":"allow"|"deny","reason":"…"} on stdout (the plugin throws on deny).
 *
 * Any internal error denies (fail closed) unless LITTI_HOOK_FAIL_OPEN=true.
 */
import 'dotenv/config';
import { extractCommand, gate, type GateDecision } from './gate.js';

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { s += c; });
    process.stdin.on('end', () => resolve(s));
    process.stdin.on('error', () => resolve(s));
  });
}

export function formatOutput(flavor: string, d: GateDecision): string {
  if (flavor === 'opencode') return JSON.stringify({ decision: d.decision, reason: d.reason });
  if (d.decision === 'allow') return '';
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason },
  });
}

export async function runHook(flavor: string, raw: string, cwdFallback = process.cwd()): Promise<string> {
  let payload: any = {};
  try { payload = raw.trim() ? JSON.parse(raw) : {}; } catch { payload = {}; }
  const command = extractCommand(payload);
  if (!command) return formatOutput(flavor, { decision: 'allow', reason: '' });
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : cwdFallback;
  const agent = process.env.LITTI_AGENT_NAME || (flavor === 'claude' ? 'claude-code' : flavor);
  return formatOutput(flavor, await gate(command, cwd, { agent }));
}

const isMain = process.argv[1] && /hook-cli\.(ts|js|mjs)$/.test(process.argv[1]);
if (isMain) {
  const flavor = (process.argv[2] || 'claude').toLowerCase();
  readStdin()
    .then(raw => runHook(flavor, raw))
    .then(out => { if (out) process.stdout.write(out); process.exit(0); })
    .catch(err => {
      const failOpen = process.env.LITTI_HOOK_FAIL_OPEN === 'true';
      const d: GateDecision = failOpen
        ? { decision: 'allow', reason: '' }
        : { decision: 'deny', reason: `🔒 Litti hook error (${err instanceof Error ? err.message : String(err)}). Blocked to be safe; ask the user to check Litti.` };
      const out = formatOutput(flavor, d);
      if (out) process.stdout.write(out);
      process.exit(0);
    });
}
