/** CLI tests: run the real `litti` command against a live in-process server. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
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

  console.log(`\n✅ ${passed} CLI checks passed`);
} catch (err) {
  console.error(`\n❌ CLI test failed after ${passed} checks:`, err);
  process.exitCode = 1;
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
