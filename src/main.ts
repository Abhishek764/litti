#!/usr/bin/env node
/**
 * The `litti` command.
 *
 *   litti                 start Litti and open the dashboard in your browser
 *   litti start [--port N] [--no-open]
 *   litti demo            sample reviews to try it out (fresh data each run)
 *   litti install claude  gate Claude Code in the current project (also codex, opencode, all)
 *   litti <other>         propose, status, pending, review, notes, reply, submit, verify, stats
 *   litti --version | help | --help | -h   (help never starts the server)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { helpText } from './help.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = (() => { try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string; } catch { return 'dev'; } })();

const args = process.argv.slice(2);
const cmd = args[0];

function usageError(message: string): never {
  console.error(`❌ ${message}\n`);
  console.error(helpText());
  process.exit(1);
}

/** Server flags: --port N, --port=N, --no-open. Anything else is an error (never start by accident). */
function parseServeFlags(rest: string[]): { port?: number; open: boolean } {
  let port: string | undefined;
  let open = true;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--no-open') open = false;
    else if (a === '--port') {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith('-')) usageError('--port needs a number, e.g. --port 3848');
      port = v; i++;
    } else if (a.startsWith('--port=')) port = a.slice('--port='.length);
    else usageError(a.startsWith('-') ? `Unknown option: ${a}` : `Unexpected argument: ${a}`);
  }
  if (port === undefined) return { open };
  const n = Number(port);
  if (!/^[0-9]+$/.test(port) || n < 1 || n > 65535) usageError(`--port must be a number from 1 to 65535 (got "${port}").`);
  return { port: n, open };
}

async function serve(kind: 'start' | 'demo', rest: string[]) {
  const flags = parseServeFlags(rest); // before loadHome: bad flags must not create ~/.litti
  const { loadHome } = await import('./home.js');
  const { home, created, configFile } = loadHome();
  if (flags.port !== undefined) process.env.APPROVAL_SERVER_PORT = String(flags.port);
  if (flags.open && !process.env.CI) process.env.LITTI_OPEN = '1';
  if (created) console.log(`✨ First run: created ${configFile} with a new secret key.`);
  console.log(`📁 Litti data: ${home}`);
  await import(kind === 'demo' ? './demo.js' : './index.js');
}

if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
  console.log(version);
} else if (cmd === 'help' || cmd === '--help' || cmd === '-h' ||
  (cmd !== undefined && (['start', 'demo'].includes(cmd) || cmd.startsWith('-')) && (args.includes('--help') || args.includes('-h')))) {
  // Before anything that starts a server or creates ~/.litti.
  console.log(helpText());
} else if (!cmd || cmd === 'start' || cmd.startsWith('-')) {
  await serve('start', cmd && !cmd.startsWith('-') ? args.slice(1) : args);
} else if (cmd === 'demo') {
  await serve('demo', args.slice(1));
} else {
  // Everything else is the HTTP client CLI (it talks to a running Litti).
  // Load ~/.litti/config.env so the CLI finds the port and keys you set there.
  const { loadHome } = await import('./home.js');
  loadHome();
  await import('./cli.js');
}
