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
} finally { await app.close(); }

console.log(`\nsecurity: ${passed} passed`);
