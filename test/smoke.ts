/** End-to-end smoke test: tiering, quiz gate, rubber-stamp, tokens, deploy, chain tamper. */
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
process.env.SECRET_KEY = 'test-secret-'.repeat(6);
import { initDb, enableDemoTamper, getPending } from '../src/chain/db.js';
import { buildServer, setSwitchClient, registerPending } from '../src/approval/server.js';
import { buildActionCard } from '../src/agents/builder.js';
import type { ActionKind } from '../src/types.js';

initDb(':memory:');
enableDemoTamper();
setSwitchClient({ postMessage: () => {} } as any);
const app = buildServer();

const card = (file: string, action: ActionKind, paths: string[], reversible = true) =>
  buildActionCard({ action, description: file, diff: readFileSync(`demo/sample-diffs/${file}`, 'utf8'), touchedPaths: paths, reversible, rollbackPlan: 'revert' });

const submit = (id: string, approver: string, quizAnswer: string, timeSpentMs: number) =>
  app.inject({ method: 'POST', url: `/approve/${id}/submit`, payload: { actionId: id, approver, quizAnswer, timeSpentMs, scrolledToBottom: true, timestamp: new Date().toISOString() } }).then(r => r.json());

let passed = 0;
async function step(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`  ✓ ${name}`); }

try {
  const css = card('css-fix.diff', 'edit', ['src/styles/button.css']);
  const mig = card('migration.diff', 'migrate', ['migrations/20261105_add_mfa_to_users.sql']);
  const rm = card('destructive.diff', 'deploy', ['scripts/cleanup.sh'], false);

  await step('tiers CSS=1, migration=2', async () => {
    assert.equal(registerPending(css, 'http://t').tier, 1);
    assert.equal(registerPending(mig, 'http://t').tier, 2);
  });

  await step('approval page renders', async () => {
    assert.equal((await app.inject({ url: `/approve/${css.id}` })).statusCode, 200);
  });

  await step('too-fast approval rejected', async () => {
    assert.equal((await submit(css.id, 'alex', getPending(css.id)!.quizAnswer, 2000)).ok, false);
  });

  await step('tier 1 correct approval deploys', async () => {
    const r = await submit(css.id, 'alex', getPending(css.id)!.quizAnswer, 15000);
    assert.equal(r.ok, true, r.message);
  });

  await step('rubber-stamp blocked, action stays reviewable', async () => {
    const r = await submit(mig.id, 'sam', 'wrong', 3000);
    assert.equal(r.ok, false);
    assert.match(r.message, /Rubber-stamp/);
    assert.equal(getPending(mig.id)!.status, 'pending');
  });

  await step('tier 2 needs two correct approvers', async () => {
    const a = getPending(mig.id)!.quizAnswer;
    assert.match((await submit(mig.id, 'priya', a, 40000)).message, /1\/2/);
    assert.equal((await submit(mig.id, 'sam', a, 45000)).ok, true);
  });

  await step('destructive action is tier 3', async () => {
    assert.equal(registerPending(rm, 'http://t').tier, 3);
  });

  await step('chain verifies, then detects tampering', async () => {
    const before = (await app.inject({ url: '/api/chain/verify' })).json();
    assert.ok(before.length >= 3 && before.every((l: any) => l.valid));
    await app.inject({ method: 'POST', url: '/api/demo/break-chain', payload: {} });
    const after = (await app.inject({ url: '/api/chain/verify' })).json();
    assert.ok(after.some((l: any) => !l.valid));
  });

  await step('agent API: propose, poll, no quiz leak', async () => {
    const r = (await app.inject({ method: 'POST', url: '/api/actions', payload: { action: 'edit', description: 'api', diff: '+a\n', touchedPaths: ['src/a.ts'] } })).json();
    assert.equal(r.status, 'pending');
    assert.ok(r.approvalUrl.includes(r.id));
    const s = (await app.inject({ url: `/api/actions/${r.id}` })).json();
    assert.equal(s.status, 'pending');
    assert.equal(JSON.stringify(s).includes('quiz'), false);
  });

  await step('agent API: tier 0 auto-approves', async () => {
    const r = (await app.inject({ method: 'POST', url: '/api/actions', payload: { action: 'test', description: 'run tests', diff: 'npm test', touchedPaths: [] } })).json();
    assert.equal(r.status, 'approved', r.message);
  });

  await step('agent API: rejects bad body and wrong key', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/api/actions', payload: {} })).statusCode, 400);
    process.env.LITTI_API_KEY = 'k3y';
    assert.equal((await app.inject({ method: 'POST', url: '/api/actions', payload: {}, headers: { 'x-litti-key': 'nope' } })).statusCode, 401);
    delete process.env.LITTI_API_KEY;
  });

  console.log(`\n✅ ${passed} checks passed`);
} catch (err) {
  console.error(`\n❌ failed after ${passed} checks:`, err);
  process.exitCode = 1;
} finally {
  for (const f of readdirSync('.')) if (/^deployed-\d+\.txt$/.test(f)) rmSync(f);
}
