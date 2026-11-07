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
import { buildServer, setNotifier, registerPending } from '../src/approval/server.js';
import { buildActionCard } from '../src/agents/builder.js';
import { generateQuiz } from '../src/agents/gatekeeper.js';
import { issueViewStamp } from '../src/approval/identity.js';
import type { ActionKind } from '../src/types.js';

initDb(':memory:');
enableDemoTamper();
const room: string[] = [];
setNotifier({ postCard: (_c, a, url) => { room.push(`CARD ${a.tier} ${url}`); }, postMessage: (m) => { room.push(m); } });
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

  await step('notifier gets approval cards, warnings and results', async () => {
    assert.ok(room.some(m => m.startsWith('CARD 2 ')));
    assert.ok(room.some(m => m.includes('Deploy executed') && m.includes('Reviewed by')));
    assert.ok(room.some(m => m.includes('@sam') && m.includes('tier is bumped')));
    assert.ok(room.some(m => m.includes('countersigned')));
  });

  await step('agent API: propose, pending list, review link, status, inbox', async () => {
    const before = room.length;
    const res = await app.inject({ method: 'POST', url: '/api/actions', payload: { action: 'edit', agent: 'dev', description: 'api proposal', diff: '+a', touchedPaths: ['src/a.ts'] } });
    assert.equal(res.statusCode, 200);
    const { id, status, approvalUrl } = res.json();
    assert.equal(status, 'pending');
    assert.ok(approvalUrl.endsWith(`/approve/${id}`));
    assert.ok(room.slice(before).some(m => m.startsWith('CARD 1 ')), 'approval card notified');

    const pending = (await app.inject({ method: 'GET', url: '/api/pending' })).json().pending;
    const mine = pending.find((p: any) => p.id === id);
    assert.ok(mine && mine.description === 'api proposal' && !('quizAnswer' in mine) && !('quiz' in mine));

    const link = await app.inject({ method: 'POST', url: `/api/actions/${id}/review-link`, payload: { reviewer: 'priya' } });
    assert.equal(link.statusCode, 200);
    assert.match(link.json().url, new RegExp(`/approve/${id}\\?t=`));
    assert.equal((await app.inject({ method: 'POST', url: `/api/actions/${id}/review-link`, payload: { reviewer: 'dev' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: `/api/actions/${id}/review-link`, payload: {} })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/actions/nope/review-link', payload: { reviewer: 'x' } })).statusCode, 404);

    assert.equal((await app.inject({ method: 'GET', url: `/api/actions/${id}` })).json().status, 'pending');
    const inbox = await app.inject({ method: 'GET', url: '/' });
    assert.equal(inbox.statusCode, 200);
    assert.match(inbox.body, /api proposal/);
    assert.equal((await app.inject({ method: 'POST', url: '/api/actions', payload: { action: 'nope' } })).statusCode, 400);
  });

  await step('chain verify API reports a broken chain', async () => {
    const links = (await app.inject({ method: 'GET', url: '/api/chain/verify' })).json();
    assert.ok(links.some((l: any) => !l.valid));
    const stats = (await app.inject({ method: 'GET', url: '/api/stats' })).json();
    assert.ok(stats.some((s: any) => s.approver === 'priya'));
  });

  console.log(`\n✅ ${passed} checks passed`);
} catch (err) {
  console.error(`\n❌ failed after ${passed} checks:`, err);
  process.exitCode = 1;
} finally {
  rmSync(DEPLOY_DIR, { recursive: true, force: true });
}
