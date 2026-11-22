/** CLI tests: run the real `litti` command against a live in-process server. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
process.env.SECRET_KEY = 'cli-test-secret-'.repeat(4);
process.env.LITTI_API_KEY = 'cli-test-key';
import { initDb } from '../src/chain/db.js';
import { buildServer, setNotifier } from '../src/approval/server.js';

initDb(':memory:');
setNotifier({ postCard() {}, postMessage() {} });
const app = buildServer();
const dir = mkdtempSync(join(tmpdir(), 'litti-cli-'));

let passed = 0;
async function step(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

try {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  const env = { ...process.env, LITTI_URL: `http://127.0.0.1:${port}`, LITTI_API_KEY: 'cli-test-key' };
  // Async spawn: a blocking spawn would freeze this process and its server.
  const run = (extraEnv: Record<string, string>, args: string[]) => new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { env: { ...env, ...extraEnv } });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ code, out }));
  });
  const litti = (...args: string[]) => run({}, args);

  let id = '';
  await step('propose from a JSON file', async () => {
    const f = join(dir, 'action.json');
    writeFileSync(f, JSON.stringify({ agent: 'coder-bot', action: 'migrate', description: 'Add MFA column', diff: '+ALTER TABLE users ADD COLUMN mfa BOOLEAN;', touchedPaths: ['migrations/001.sql'] }));
    const r = await litti('propose', f);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Tier 2/);
    id = r.out.match(/Action ([0-9a-f-]{36})/)![1];
  });

  await step('pending lists it', async () => {
    const r = await litti('pending');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Add MFA column/);
  });

  await step('review issues a personal link; requester is refused', async () => {
    const r = await litti('review', id, '--as', 'priya');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`/approve/${id}\\?t=`));
    const reordered = await litti('review', '--as', 'sam', id);
    assert.equal(reordered.code, 0, reordered.out);
    assert.match(reordered.out, /for sam/);
    const self = await litti('review', id, '--as', ' Coder-Bot ');
    assert.notEqual(self.code, 0);
    assert.match(self.out, /requester/);
  });

  await step('status, verify, stats', async () => {
    assert.match((await litti('status', id)).out, /PENDING/);
    assert.match((await litti('verify')).out, /No receipts yet|intact/);
    assert.equal((await litti('stats')).code, 0);
  });

  await step('wrong API key is refused', async () => {
    const r = await run({ LITTI_API_KEY: 'wrong' }, ['pending']);
    assert.notEqual(r.code, 0);
  });

  const freePort = () => new Promise<number>((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
  // Default port for spawned entries: a free one, so a regression can never start a server on 3847.
  const fallbackPort = String(await freePort());
  // The real `litti` entry (src/main.ts) with its own LITTI_HOME: help and bad flags must never start a server.
  const entry = (home: string, args: string[], until?: RegExp) => new Promise<{ code: number | null; out: string; started: boolean }>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts', ...args], {
      // Local mode, like a user's first `litti`: no inherited API key (team mode would require PUBLIC_URL).
      env: { ...env, LITTI_HOME: home, CI: '1', LITTI_SKIP_CWD_ENV: '1', APPROVAL_SERVER_PORT: fallbackPort, LITTI_URL: '', LITTI_API_KEY: '' },
    });
    let out = '';
    let started = false;
    const timer = setTimeout(() => child.kill(), 90000); // safety net only: a server that starts by mistake is killed as soon as it logs (startedRe)
    const onData = (d: Buffer) => { out += d; if (until && until.test(out) && !started) { started = true; child.kill(); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, started }); });
  });
  const startedRe = /Litti is running at|Server listening at/;

  await step('litti --help / -h / help print help and exit; no server, no config.env', async () => {
    for (const args of [['--help'], ['-h'], ['help'], ['start', '--help'], ['demo', '-h'], ['--port', '3872', '--help']]) {
      const home = join(dir, `home-help-${args.join('')}`);
      const r = await entry(home, args, startedRe);
      assert.equal(r.code, 0, `${args.join(' ')}: ${r.out}`);
      assert.equal(r.started, false, `${args.join(' ')} started a server`);
      for (const s of ['litti [start]', 'litti demo', '--port N', '--port=N', '--no-open', '--version', 'propose', 'review', 'status', 'pending', 'verify', 'stats', 'notes', 'reply', 'resolve', 'submit', 'install']) {
        assert.ok(r.out.includes(s), `${args.join(' ')}: help mentions ${s}`);
      }
      assert.equal(existsSync(join(home, 'config.env')), false, `${args.join(' ')} created config.env`);
    }
  });

  await step('bad server flags exit with an error and never start or create config.env', async () => {
    for (const [args, msg] of [
      [['--bogus'], /Unknown option: --bogus/], [['start', '--prot', '3872'], /Unknown option: --prot/],
      [['--port'], /--port needs a number/], [['start', '--port', '--no-open'], /--port needs a number/],
      [['--port=abc'], /from 1 to 65535/], [['--port=70000'], /from 1 to 65535/], [['demo', '--port', '3.5'], /from 1 to 65535/],
      [['start', 'extra'], /Unexpected argument: extra/],
    ] as [string[], RegExp][]) {
      const home = join(dir, `home-bad-${args.join('').replace(/[^a-z0-9]/gi, '')}`);
      const r = await entry(home, args, startedRe);
      assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
      assert.equal(r.started, false, `${args.join(' ')} started a server`);
      assert.match(r.out, msg, args.join(' '));
      assert.match(r.out, /litti demo/, `${args.join(' ')}: help shown`);
      assert.equal(existsSync(join(home, 'config.env')), false, `${args.join(' ')} created config.env`);
    }
  });

  await step('litti start --port=N --no-open listens on N', async () => {
    const free = await freePort();
    const r = await entry(join(dir, 'home-port'), ['start', `--port=${free}`, '--no-open'], new RegExp(`running at http://127\\.0\\.0\\.1:${free}/`));
    assert.ok(r.started, r.out);
  });

  await step('busy port: litti and litti demo print a friendly message, no stack trace, demo data kept', async () => {
    const busy = createServer();
    const p = await new Promise<number>((resolve) => busy.listen(0, '127.0.0.1', () => resolve((busy.address() as { port: number }).port)));
    try {
      for (const kind of ['start', 'demo']) {
        const home = join(dir, `home-busy-${kind}`);
        mkdirSync(home, { recursive: true });
        writeFileSync(join(home, 'demo.db'), 'running demo data');
        const r = await entry(home, [kind, '--port', String(p), '--no-open'], startedRe);
        assert.equal(r.code, 1, `${kind}: ${r.out}`);
        assert.match(r.out, new RegExp(`Port ${p} is already in use`), kind);
        assert.match(r.out, new RegExp(`litti ${kind} --port ${p + 1}`), kind);
        assert.doesNotMatch(r.out, /\n\s+at |EADDRINUSE/, `${kind}: no raw stack trace`);
        assert.ok(existsSync(join(home, 'demo.db')), `${kind}: demo database not wiped`);
      }
    } finally {
      busy.close();
    }
  });

  // The installed CLI with only ~/.litti/config.env to go on (no LITTI_URL, no APPROVAL_SERVER_PORT in the env).
  const installed = (home: string, args: string[], cwd?: string) => new Promise<{ code: number | null; out: string }>((resolve) => {
    const e: Record<string, string | undefined> = { ...process.env, LITTI_HOME: home, CI: '1' };
    for (const k of ['LITTI_URL', 'APPROVAL_SERVER_PORT', 'LITTI_API_KEY', 'LITTI_SKIP_CWD_ENV']) delete e[k];
    // Absolute tsx loader: the child may run in a project folder without node_modules.
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(process.cwd(), 'src/main.ts'), ...args], { env: e, cwd: cwd ?? process.cwd() });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ code, out }));
  });

  await step('client CLI uses the port from ~/.litti/config.env; a project .env cannot redirect it (USER-6)', async () => {
    const home = join(dir, 'home-config-port');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'config.env'), `SECRET_KEY=${'a'.repeat(64)}\nAPPROVAL_SERVER_PORT=${port}\nLITTI_API_KEY=cli-test-key\n`);
    const proj = join(dir, 'proj-with-env');
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, '.env'), 'LITTI_URL=http://127.0.0.1:9\nAPPROVAL_SERVER_PORT=9\n');
    const r = await installed(home, ['pending'], proj);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Add MFA column/);
    // Nothing listening: the message names `litti`, never npm.
    writeFileSync(join(home, 'config.env'), `SECRET_KEY=${'a'.repeat(64)}\nAPPROVAL_SERVER_PORT=${fallbackPort}\n`);
    const down = await installed(home, ['pending']);
    assert.notEqual(down.code, 0);
    assert.match(down.out, new RegExp(`127\\.0\\.0\\.1:${fallbackPort}`));
    assert.match(down.out, /Start it with "litti"/);
    assert.doesNotMatch(down.out, /npm (start|run)/);
  });

  await step('the undocumented `up` alias is gone: it is an unknown command, not a server', async () => {
    const r = await entry(join(dir, 'home-up'), ['up'], startedRe);
    assert.equal(r.started, false, r.out);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Unknown command: up/);
  });

  await step('litti install prints next steps: restart the agent, open the local URL', async () => {
    const home = join(dir, 'home-install');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'config.env'), `SECRET_KEY=${'a'.repeat(64)}\nAPPROVAL_SERVER_PORT=3882\n`);
    const proj = join(dir, 'proj-install');
    mkdirSync(proj, { recursive: true });
    const r = await installed(home, ['install', 'claude', '--dir', proj], proj);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Restart Claude Code/);
    assert.match(r.out, /Open http:\/\/127\.0\.0\.1:3882\//);
    assert.doesNotMatch(r.out, /npm (start|run)/);
  });

  await step('busy top port 65535 suggests 65534, never 65536', async () => {
    const busy = createServer();
    await new Promise<void>((resolve) => { busy.once('error', () => resolve()); busy.listen(65535, '127.0.0.1', () => resolve()); });
    try {
      for (const kind of ['start', 'demo']) {
        const r = await entry(join(dir, `home-top-${kind}`), [kind, '--port', '65535', '--no-open'], startedRe);
        assert.equal(r.code, 1, `${kind}: ${r.out}`);
        assert.match(r.out, new RegExp(`litti ${kind} --port 65534`), kind);
        assert.doesNotMatch(r.out, /65536/);
      }
    } finally { busy.close(); }
  });

  console.log(`\n✅ ${passed} CLI checks passed`);
} catch (err) {
  console.error(`\n❌ CLI test failed after ${passed} checks:`, err);
  process.exitCode = 1;
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
