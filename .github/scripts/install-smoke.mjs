// Install-smoke for the packed tarball: install it into a temp prefix, run
// `litti --version`, start the server, wait for /healthz, then stop it.
// Usage: node .github/scripts/install-smoke.mjs <tarball> [port]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tarball = resolve(process.argv[2] ?? '');
const port = Number(process.argv[3] ?? 3873);
const win = process.platform === 'win32';
const temp = mkdtempSync(join(tmpdir(), 'litti-smoke-'));
const prefix = join(temp, 'prefix');
const binDir = win ? prefix : join(prefix, 'bin');
const env = { ...process.env, LITTI_HOME: join(temp, 'home'), CI: '1', PATH: `${binDir}${win ? ';' : ':'}${process.env.PATH}` };
const sh = (cmd, args) => execFileSync(cmd, args, { env, stdio: ['ignore', 'pipe', 'inherit'], shell: win }).toString().trim();

let child;
let ok = false;
try {
  sh('npm', ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', tarball]);
  console.log('litti --version:', sh('litti', ['--version']));

  child = spawn('litti', ['start', '--port', String(port), '--no-open'], { env, stdio: 'inherit', shell: win, detached: !win });
  child.on('error', (e) => console.error('could not start litti:', e.message));
  for (let i = 0; i < 60 && !ok; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      ok = res.ok && (await res.json()).ok === true;
    } catch { /* not up yet */ }
  }
  console.log(ok ? `/healthz ok on port ${port}` : `/healthz did not answer on port ${port}`);
} finally {
  if (child?.pid) {
    try {
      if (win) execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch { /* already gone */ }
  }
  await new Promise((r) => setTimeout(r, 1000));
  try { rmSync(temp, { recursive: true, force: true }); } catch { /* Windows may still hold a file */ }
}
process.exit(ok ? 0 : 1);
