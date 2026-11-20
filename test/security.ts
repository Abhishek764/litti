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
import { issueViewStamp } from '../src/approval/identity.js';
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

  await step('0.5.10 the tamper button only exists in demo mode', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/meta' })).json().demo, false);
    assert.equal((await app.inject({ method: 'POST', url: '/api/demo/break-chain', payload: {} })).statusCode, 404);
  });
} finally { await app.close(); }

console.log(`\nsecurity: ${passed} passed`);
