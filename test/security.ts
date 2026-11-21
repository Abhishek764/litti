/** Security fixes (Phase 0.5): one attack per test. Each must fail. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
process.env.SECRET_KEY = 'security-test-secret-'.repeat(3);
process.env.LITTI_ALLOW_SELF_ASSERTED = 'true';
process.env.LITTI_DEPLOY_DIR = join(tmpdir(), `litti-sec-${process.pid}`);
delete process.env.LITTI_API_KEY;
import { initDb, getPending, getApprovalToken } from '../src/chain/db.js';
import { buildServer, setNotifier } from '../src/approval/server.js';
import { issueTicket, issueViewStamp, reviewerKey } from '../src/approval/identity.js';
import { sampleAnswer } from '../src/agents/challenges.js';
import { createToken } from '../src/approval/token.js';

initDb(':memory:');
setNotifier(null);
const app = buildServer();
let passed = 0;
async function step(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`  ✓ ${name}`); }

const DIFF = '--- a/src/pay.ts\n+++ b/src/pay.ts\n@@ -1 +1 @@\n-export function charge(a) { return a; }\n+export function charge(a) { return a * 100; }';
async function propose(extra: Record<string, unknown> = {}) {
  const r = await app.inject({ method: 'POST', url: '/api/actions', payload: { agent: 'bot', action: 'edit', description: 'Cents', diff: DIFF, touchedPaths: ['src/pay.ts'], ...extra } });
  return r.json();
}
async function approve(id: string, reviewers = ['ana', 'ben', 'cy']) {
  for (const who of reviewers) {
    const p = getPending(id)!;
    if (p.status !== 'pending') break;
    const r = await app.inject({ method: 'POST', url: `/approve/${id}/submit`, payload: { approver: who, quizAnswer: sampleAnswer(p), scrolledToBottom: true, viewStamp: issueViewStamp(id, Date.now() - 45000) } });
    assert.equal(r.json().ok, true, r.json().message);
  }
}
const verify = (token: unknown, diff = DIFF) => app.inject({ method: 'POST', url: '/api/tokens/verify', payload: { token, diff } }).then(r => r.json());
const consume = (token: unknown, diff = DIFF) => app.inject({ method: 'POST', url: '/api/tokens/consume', payload: { token, diff } });

try {
  await step('0.5.2 a pipeline can ship a token once; reuse is refused', async () => {
    const a = await propose();
    await approve(a.id);
    const token = getApprovalToken(a.id);
    assert.equal((await verify(token)).valid, true, 'executor delivery does not block the pipeline');
    assert.equal((await consume(token)).statusCode, 200);
    assert.equal((await consume(token)).statusCode, 409, 'second ship refused');
    assert.equal((await verify(token)).valid, false, 'verify now says it was used');
  });

  await step('0.5.3 a token cannot be re-labelled for another action or have its time changed', async () => {
    const a = await propose({ description: 'A' });
    await approve(a.id);
    const b = await propose({ description: 'B' });
    await approve(b.id);
    const ta = getApprovalToken(a.id) as any;
    assert.equal((await verify({ ...ta, actionId: b.id })).valid, false, 'moved to another action');
    assert.equal((await verify({ ...ta, issuedAt: new Date(0).toISOString() })).valid, false, 'issue time changed');
    const { v: _v, ...legacy } = ta;
    assert.equal((await verify(legacy)).valid, false, 'old unsigned-action format refused');
    const forged = createToken(a.id, 'f'.repeat(64), [{ approver: 'x', correct: true, timeMs: 1 }]);
    assert.equal((await verify(forged)).valid, false, 'token for a different diff');
    assert.equal((await verify('nonsense')).valid, false);
  });
  await step('0.5.1 receipts, stats and chain verify need the API key or a signed-in reviewer', async () => {
    process.env.LITTI_API_KEY = 'agent-key';
    process.env.LITTI_IDENTITY_HEADER = 'x-forwarded-email';
    try {
      for (const url of ['/api/receipts', '/api/stats', '/api/chain/verify']) {
        assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, `${url} anonymous`);
        assert.equal((await app.inject({ method: 'GET', url, headers: { 'x-litti-key': 'wrong' } })).statusCode, 401, `${url} wrong key`);
        assert.equal((await app.inject({ method: 'GET', url, headers: { 'x-litti-key': 'agent-key' } })).statusCode, 200, `${url} agent`);
        assert.equal((await app.inject({ method: 'GET', url, headers: { 'x-forwarded-email': 'ana@acme.test' } })).statusCode, 200, `${url} SSO reviewer`);
      }
    } finally { delete process.env.LITTI_API_KEY; delete process.env.LITTI_IDENTITY_HEADER; }
  });

  await step('0.5.4 editing a receipt\'s tier, approvals or time breaks the chain; old receipts still verify', async () => {
    const { getDb } = await import('../src/chain/db.js');
    const { verifyChain } = await import('../src/chain/verify.js');
    const { computeChainHash } = await import('../src/chain/receipt.js');
    assert.ok(verifyChain().every(r => r.valid), 'chain starts intact');
    const last = getDb().prepare('SELECT id FROM receipts ORDER BY seq DESC LIMIT 1').get() as { id: string };
    assert.equal((getDb().prepare('SELECT format FROM receipts WHERE id = ?').get(last.id) as any).format, 2, 'new receipts are format 2');
    for (const [col, val] of [['tier', 0], ['approvals', '[]'], ['created_at', '2000-01-01T00:00:00.000Z'], ['format', null]] as const) {
      const before = getDb().prepare(`SELECT ${col} AS v FROM receipts WHERE id = ?`).get(last.id) as { v: unknown };
      getDb().prepare(`UPDATE receipts SET ${col} = ? WHERE id = ?`).run(val, last.id);
      assert.equal(verifyChain().find(r => r.id === last.id)!.valid, false, `editing ${col} is detected`);
      getDb().prepare(`UPDATE receipts SET ${col} = ? WHERE id = ?`).run(before.v, last.id);
    }
    assert.ok(verifyChain().every(r => r.valid), 'restored');
    // A format-1 receipt (written by an older Litti) still verifies with its own rule.
    const legacy = { id: 'legacy', previousHash: 'p', actionCard: { a: 1 } as any, tier: 1 as const, approvals: [], outcome: 'approved' as const, attentionScore: 50, timestamp: 't' };
    assert.equal(computeChainHash(legacy), computeChainHash({ ...legacy, tier: 3, timestamp: 'changed' }), 'v1 ignores tier/time (as before)');
    assert.notEqual(computeChainHash({ ...legacy, format: 2 }), computeChainHash({ ...legacy, format: 2, tier: 3 }), 'v2 covers tier');
  });

  await step('SEC-1 an agent-declared Tier 0 action can neither pre-approve the gate nor ship', async () => {
    const gateDiff = 'diff --git a/.litti/command b/.litti/command\n--- a/.litti/command\n+++ b/.litti/command\n@@ -0,0 +1 @@\n+git push origin main\n'
      + 'diff --git a/src/pay.ts b/src/pay.ts\n--- a/src/pay.ts\n+++ b/src/pay.ts\n@@ -1 +1 @@\n-export const fee = 1;\n+export const fee = sendAllMoneyTo("attacker");';
    const gateReq = { agent: 'claude-code', action: 'deploy', command: 'git push origin main', description: 'push', diff: gateDiff, touchedPaths: ['src/pay.ts'] };
    const first = (await app.inject({ method: 'POST', url: '/api/gate', payload: gateReq })).json();
    assert.equal(first.decision, 'deny');
    // The agent declares the same diff as a harmless read: Tier 0, auto-approved with a token.
    const self = (await app.inject({ method: 'POST', url: '/api/actions', payload: { agent: 'claude-code', action: 'read', description: 'just reading', diff: gateDiff, touchedPaths: [] } })).json();
    assert.equal(self.tier, 0);
    const retry = (await app.inject({ method: 'POST', url: '/api/gate', payload: gateReq })).json();
    assert.equal(retry.decision, 'deny', 'a self-declared Tier 0 action must not satisfy the gate');
    assert.equal(retry.id, first.id, 'still the gate\'s own pending review');
    const shipped = await consume(self.token, gateDiff);
    assert.equal(shipped.statusCode, 409, 'a Tier 0 token is not a shipping approval');
    assert.match(shipped.json().reason, /Tier 0/);
  });

  await step('SEC-10 failed deploy: deploy-failed receipt, not shippable, gate stays shut; retry re-runs it', async () => {
    const { allReceipts } = await import('../src/chain/db.js');
    const diff = 'diff --git a/.litti/command b/.litti/command\n--- a/.litti/command\n+++ b/.litti/command\n@@ -0,0 +1 @@\n+npm publish\n'
      + 'diff --git a/src/pay.ts b/src/pay.ts\n--- a/src/pay.ts\n+++ b/src/pay.ts\n@@ -1 +1 @@\n-export const v = 1;\n+export const v = 2;';
    const req = { agent: 'claude-code', action: 'deploy', command: 'npm publish', description: 'publish', diff, touchedPaths: ['src/pay.ts'] };
    const gateCall = () => app.inject({ method: 'POST', url: '/api/gate', payload: req }).then(r => r.json());
    const retry = (headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: `/api/actions/${first.id}/retry`, headers });
    const first = await gateCall();
    process.env.LITTI_DEPLOY_WEBHOOK = 'http://127.0.0.1:9/deploy';
    try {
      const p = getPending(first.id)!;
      let last: any;
      for (const who of ['ana', 'ben', 'cy'].slice(0, p.requiredApprovers)) {
        last = (await app.inject({ method: 'POST', url: `/approve/${first.id}/submit`, payload: { approver: who, quizAnswer: sampleAnswer(getPending(first.id)!), scrolledToBottom: true, viewStamp: issueViewStamp(first.id, Date.now() - 45000) } })).json();
      }
      assert.equal(last.ok, false, 'the reviewer sees the failure');
      assert.equal(getPending(first.id)!.status, 'deploy-failed');
      assert.equal(allReceipts().at(-1)!.outcome, 'deploy-failed', 'the chain does not claim a deploy that never happened');
      assert.equal((await gateCall()).decision, 'deny', 'the gate does not allow a failed deploy');
      assert.equal((await consume(getApprovalToken(first.id), diff)).statusCode, 409, 'not shippable');
      assert.equal((await retry()).statusCode, 502, 'retry while the pipeline is still down fails again');
      assert.equal(getPending(first.id)!.status, 'deploy-failed');
    } finally { delete process.env.LITTI_DEPLOY_WEBHOOK; }
    process.env.LITTI_API_KEY = 'agent-key';
    try { assert.equal((await retry({ 'x-litti-key': 'agent-key' })).statusCode, 401, 'team mode: the agent key cannot retry, only the admin key'); }
    finally { delete process.env.LITTI_API_KEY; }
    const ok = await retry();
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(getPending(first.id)!.status, 'approved');
    assert.equal(allReceipts().at(-1)!.outcome, 'approved');
    assert.equal((await gateCall()).decision, 'allow', 'after a successful retry the command runs once');
    assert.equal((await retry()).statusCode, 409, 'nothing left to retry');
  });

  await step('0.5.10 the tamper button only exists in demo mode', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/meta' })).json().demo, false);
    assert.equal((await app.inject({ method: 'POST', url: '/api/demo/break-chain', payload: {} })).statusCode, 404);
  });

  await step('P0-5 SEC-3 review links need the admin key, also in local mode; litti creates one', async () => {
    const a = await propose({ description: 'admin key' });
    const link = (headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: `/api/actions/${a.id}/review-link`, headers, payload: { reviewer: 'bob' } });
    assert.equal((await link()).statusCode, 401, 'local mode, no admin key configured: refused');
    process.env.LITTI_ADMIN_KEY = 'adm';
    try {
      assert.equal((await link()).statusCode, 401, 'no header');
      assert.equal((await link({ 'x-litti-admin-key': 'nope' })).statusCode, 401, 'wrong key');
      assert.equal((await link({ 'x-litti-admin-key': 'adm' })).statusCode, 200);
    } finally { delete process.env.LITTI_ADMIN_KEY; }
    const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import('node:fs');
    const { loadHome } = await import('../src/home.js');
    const home = mkdtempSync(join(tmpdir(), 'litti-sec-home-'));
    try {
      const env: Record<string, string | undefined> = { LITTI_HOME: home };
      loadHome(env);
      assert.match(env.LITTI_ADMIN_KEY ?? '', /^[0-9a-f]{48}$/, 'first run generates LITTI_ADMIN_KEY');
      assert.match(readFileSync(join(home, 'config.env'), 'utf8'), /^LITTI_ADMIN_KEY=[0-9a-f]{48}$/m);
      writeFileSync(join(home, 'config.env'), 'SECRET_KEY=' + 'x'.repeat(64) + '\n');
      const old: Record<string, string | undefined> = { LITTI_HOME: home };
      loadHome(old);
      assert.match(old.LITTI_ADMIN_KEY ?? '', /^[0-9a-f]{48}$/, 'an older config gets one added');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  await step('P0-5 SEC-8 one person counts once: case, zero-width, Cyrillic/Greek look-alikes', async () => {
    assert.equal(reviewerKey('Bob'), 'bob');
    for (const v of ['bob​', 'Bоb', 'Вob ', 'B o b', 'BOB⁠', 'Ｂob', 'B‏ob']) assert.equal(reviewerKey(v), 'bob', JSON.stringify(v));
    assert.notEqual(reviewerKey('rob'), 'bob');
    const a = await propose({ action: 'delete', description: 'needs three' });
    assert.equal(getPending(a.id)!.requiredApprovers, 3);
    const submit = (who: string) => app.inject({ method: 'POST', url: `/approve/${a.id}/submit`, payload: { approver: who, quizAnswer: sampleAnswer(getPending(a.id)!), scrolledToBottom: true, viewStamp: issueViewStamp(a.id, Date.now() - 45000) } });
    assert.equal((await submit('Bob')).json().ok, true);
    for (const twin of ['Bob​', 'Bоb', 'bοb']) {
      const r = await submit(twin);
      assert.equal(r.json().ok, false, twin);
      assert.match(r.json().message, /already countersigned/);
    }
    assert.equal(getPending(a.id)!.currentApprovals.length, 1);
    assert.equal((await submit('bоt')).json().ok, false, 'requester look-alike ("bot" = agent "bot") refused');
  });

  await step('P0-5 SEC-7 a view stamp is single-use and bound to its reviewer', async () => {
    const a = await propose({ description: 'stamps' });
    const tAna = issueTicket(a.id, 'ana', reviewerKey('ana'));
    const send = (body: Record<string, unknown>) => app.inject({ method: 'POST', url: `/approve/${a.id}/submit`, payload: { quizAnswer: sampleAnswer(getPending(a.id)!), scrolledToBottom: true, ...body } });
    // A stamp opened for ben can't be used by ana; an unbound one can't be used with a ticket.
    assert.equal((await send({ ticket: tAna, viewStamp: issueViewStamp(a.id, Date.now() - 45000, reviewerKey('ben')) })).statusCode, 403);
    assert.equal((await send({ ticket: tAna, viewStamp: issueViewStamp(a.id, Date.now() - 45000) })).statusCode, 403);
    // A failed submit (too fast) burns the stamp: waiting and resubmitting needs a fresh page.
    const stamp = issueViewStamp(a.id, Date.now() - 2000, reviewerKey('ana'));
    const fast = await send({ ticket: tAna, viewStamp: stamp });
    assert.equal(fast.json().ok, false);
    assert.match(fast.json().message, /at least/);
    assert.equal((await send({ ticket: tAna, viewStamp: stamp })).statusCode, 409, 'reused stamp refused');
    // The page served with the ticket carries a stamp bound to ana.
    const page = (await app.inject({ url: `/approve/${a.id}?t=${encodeURIComponent(tAna)}` })).body;
    const served = page.match(/id="viewStamp" value="([^"]+)"/)![1];
    assert.equal(JSON.parse(Buffer.from(served.split('.')[0], 'base64url').toString()).r, 'ana');
    const ok = await send({ ticket: tAna, viewStamp: issueViewStamp(a.id, Date.now() - 45000, reviewerKey('ana')) });
    assert.equal(ok.json().ok, true, ok.json().message);
  });
} finally { await app.close(); }

console.log(`\nsecurity: ${passed} passed`);
