/** End-to-end smoke test: tiering, quiz gate, rubber-stamp, tokens, deploy, chain tamper. */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
process.env.SECRET_KEY = 'test-secret-'.repeat(6);
process.env.LITTI_ALLOW_SELF_ASSERTED = 'true';
const DEPLOY_DIR = mkdtempSync(join(tmpdir(), 'litti-deploy-'));
process.env.LITTI_DEPLOY_DIR = DEPLOY_DIR;
import { initDb, enableDemoTamper, getPending } from '../src/chain/db.js';
import { buildServer, setSwitchClient, registerPending } from '../src/approval/server.js';
import { buildActionCard } from '../src/agents/builder.js';
import { generateQuiz } from '../src/agents/gatekeeper.js';
import { createCommandHandler } from '../src/switch/commands.js';
import { issueViewStamp } from '../src/approval/identity.js';
import type { ActionKind } from '../src/types.js';

initDb(':memory:');
enableDemoTamper();
const room: string[] = [];
setSwitchClient({ postCard: (_c, a, url) => { room.push(`CARD ${a.tier} ${url}`); }, postMessage: (m) => { room.push(m); } });
const app = buildServer();

const card = (file: string, action: ActionKind, paths: string[], reversible = true) =>
  buildActionCard({ action, description: file, diff: readFileSync(`demo/sample-diffs/${file}`, 'utf8'), touchedPaths: paths, reversible, rollbackPlan: 'revert' });

const submit = (id: string, approver: string, quizAnswer: string, timeSpentMs: number) =>
  app.inject({ method: 'POST', url: `/approve/${id}/submit`, payload: { actionId: id, approver, quizAnswer, timeSpentMs, scrolledToBottom: true, viewStamp: issueViewStamp(id, Date.now() - timeSpentMs) } }).then(r => r.json());

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

  await step('quiz: 4 distinct options, one correct, for every sample diff', async () => {
    const samples = [['css-fix.diff', 'edit'], ['migration.diff', 'migrate'], ['destructive.diff', 'deploy']] as const;
    for (const [f, a] of samples) {
      for (let i = 0; i < 25; i++) {
        const q = generateQuiz(card(f, a, ['x']));
        assert.equal(q.options.length, 4, f);
        assert.equal(new Set(q.options).size, 4, `${f}: duplicate options ${q.options}`);
        assert.ok(q.correctIndex >= 0 && q.correctIndex < 4);
      }
    }
    const cssQ = generateQuiz(card('css-fix.diff', 'edit', ['x']));
    assert.equal(cssQ.options[cssQ.correctIndex], '8px');
    const migQ = generateQuiz(card('migration.diff', 'migrate', ['x']));
    assert.equal(migQ.options[migQ.correctIndex], 'users');
    const fn = buildActionCard({ action: 'edit', description: 'fn', diff: '+export function chargeCard() {}', touchedPaths: ['a.ts'], reversible: true, rollbackPlan: '' });
    const fnQ = generateQuiz(fn);
    assert.equal(fnQ.options[fnQ.correctIndex], 'chargeCard');
  });

  await step('separation of duties: no double-approval, no self-approval', async () => {
    const c = card('migration.diff', 'migrate', ['migrations/y.sql']);
    registerPending(c, 'http://t');
    const a = getPending(c.id)!.quizAnswer;
    assert.equal((await submit(c.id, 'priya', a, 40000)).ok, true);
    assert.match((await submit(c.id, 'Priya', a, 40000)).message, /already countersigned/);
    assert.match((await submit(c.id, 'builder-agent', a, 40000)).message, /requester/);
    assert.equal(getPending(c.id)!.status, 'pending');
  });

  await step('room gets approval cards, warnings and results', async () => {
    assert.ok(room.some(m => m.startsWith('CARD 2 ')));
    assert.ok(room.some(m => m.includes('Deploy executed') && m.includes('Reviewed by')));
    assert.ok(room.some(m => m.includes('@sam') && m.includes('tier is bumped')));
    assert.ok(room.some(m => m.includes('countersigned')));
  });

  await step('@litti chat commands', async () => {
    const h = createCommandHandler('http://t');
    const ev = (body: string) => h({ roomId: 'r', sender: '@u', senderName: 'dev', body });
    assert.match((await ev('@litti help'))!, /propose/);
    assert.match((await ev('@litti pending'))!, /Waiting/);
    assert.match((await ev('@litti approve abc'))!, /doesn't take approvals in chat/);
    assert.match((await ev('@litti stats'))!, /priya/);
    const before = room.length;
    const fence = '`'.repeat(3);
    const r = await ev(`@litti propose\n${fence}json\n{"action":"edit","description":"chat proposal","diff":"+a","touchedPaths":["src/a.ts"]}\n${fence}`);
    assert.equal(r, null);
    const posted = room.slice(before).find(m => m.startsWith('CARD 1 '));
    assert.ok(posted, 'proposal card posted to room');
    const id = posted!.split('/approve/')[1];
    assert.match((await ev(`@litti status ${id}`))!, /PENDING/);
    assert.match((await ev('@litti propose not json'))!, /JSON/);
  });

  await step('@litti verify reports a broken chain', async () => {
    const h = createCommandHandler('http://t');
    assert.match((await h({ roomId: 'r', sender: '@u', senderName: 'dev', body: '@litti verify' }))!, /Chain broken/);
  });

  console.log(`\n✅ ${passed} checks passed`);
} catch (err) {
  console.error(`\n❌ failed after ${passed} checks:`, err);
  process.exitCode = 1;
} finally {
  rmSync(DEPLOY_DIR, { recursive: true, force: true });
}
