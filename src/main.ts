#!/usr/bin/env node
/**
 * The `litti` command.
 *
 *   litti                 start Litti and open the dashboard in your browser
 *   litti start [--port N] [--no-open]
 *   litti demo            sample reviews to try it out (fresh data each run)
 *   litti install claude  gate Claude Code in the current project (also codex, opencode, all)
 *   litti <other>         propose, status, pending, review, notes, reply, submit, verify, stats
 *   litti --version | help
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = (() => { try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string; } catch { return 'dev'; } })();

const args = process.argv.slice(2);
const cmd = args[0];

function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function serve(kind: 'start' | 'demo') {
  const { loadHome } = await import('./home.js');
  const { home, created, configFile } = loadHome();
  const port = flagValue('--port');
  if (port !== undefined) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) { console.error(`❌ --port must be a number from 1 to 65535 (got "${port}").`); process.exit(1); }
    process.env.APPROVAL_SERVER_PORT = String(n);
  }
  if (!args.includes('--no-open') && !process.env.CI) process.env.LITTI_OPEN = '1';
  if (created) console.log(`✨ First run: created ${configFile} with a new secret key.`);
  console.log(`📁 Litti data: ${home}`);
  await import(kind === 'demo' ? './demo.js' : './index.js');
}

if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
  console.log(version);
} else if (!cmd || cmd === 'start' || cmd === 'up' || cmd.startsWith('--')) {
  await serve('start');
} else if (cmd === 'demo') {
  await serve('demo');
} else {
  // Everything else is the HTTP client CLI (it talks to a running Litti).
  // Load ~/.litti/config.env so the CLI finds the port and keys you set there.
  const { loadHome } = await import('./home.js');
  loadHome();
  await import('./cli.js');
}
