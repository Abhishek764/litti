/** Production-mode tests: identity, server-measured timing, webhook deploys, pipeline token checks, hardening. */
import Fastify from 'fastify';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
process.env.SECRET_KEY = 'prod-test-secret-'.repeat(4);
delete process.env.LITTI_ALLOW_SELF_ASSERTED;
process.env.LITTI_DEPLOY_DIR = join(tmpdir(), `litti-prod-deploy-${process.pid}`);
import { initDb, getPending, getSetting } from '../src/chain/db.js';
import { buildServer, setSwitchClient } from '../src/approval/server.js';
import { issueTicket, issueViewStamp } from '../src/approval/identity.js';
import { createCommandHandler } from '../src/switch/commands.js';
import { checkProductionConfig } from '../src/config.js';

initDb(':memory:');
const room: string[] = [];
setSwitchClient({ postCard: (c) => { room.push(`CARD ${c.id}`); }, postMessage: (m) => { room.push(m); } });
const app = buildServer();
const chat = createCommandHandler('http://litti.test');

const DIFF = '--- a/src/pay.ts\n+++ b/src/pay.ts\n@@ -1 +1 @@\n-export function chargeCard(a) { return a; }\n+export function chargeCard(a) { return a * 100; }';
const propose = async (headers: Record<string, string> = {}) => (await app.inject({
  method: 'POST', url: '/api/actions', headers,
  payload: { agent: 'coder-bot', action: 'edit', description: 'Charge in cents', diff: DIFF, touchedPaths: ['src/pay.ts'] },
})).json();
const submit = (id: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: `/approve/${id}/submit`, headers, payload: { scrolledToBottom: true, ...body } });
const answer = (id: string) => getPending(id)!.quizAnswer;
const stamp = (id: string, agoMs: number) => issueViewStamp(id, Date.now() - agoMs);

let passed = 0;
async function step(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`  ✓ ${name}`); }

let hook: ReturnType<typeof Fastify> | null = null;
try {
  await step('config: weak SECRET_KEY is refused, warnings for open setups', async () => {
    assert.ok(checkProductionConfig({ SECRET_KEY: 'short' }).errors.length > 0);
    assert.ok(checkProductionConfig({ SECRET_KEY: 'change-me-to-a-long-random-string' }).errors.length > 0);
    const ok = checkProductionConfig({ SECRET_KEY: 'x'.repeat(40) });
    assert.equal(ok.errors.length, 0);
    assert.ok(ok.warnings.some(w => w.includes('LITTI_API_KEY')));
    assert.ok(checkProductionConfig({ SECRET_KEY: 'x'.repeat(40), PUBLIC_URL: 'ftp://x' }).errors.length > 0);
  });

  await step('security headers + no-store on review pages', async () => {
    const { id } = await propose();
    const r = await app.inject({ url: `/approve/${id}` });
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.match(String(r.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal((await app.inject({ url: '/healthz' })).json().ok, true);
  });

  await step('typed names are rejected in production', async () => {
    const { id } = await propose();
    const r = await submit(id, { approver: 'mallory', quizAnswer: answer(id), viewStamp: stamp(id, 20000) });
    assert.equal(r.statusCode, 401);
    assert.match(r.json().message, /@litti review/);
  });

  await step('@litti review issues a signed link that locks the reviewer name', async () => {
    const { id } = await propose();
    const reply = (await chat({ roomId: 'r', sender: '@switch-user-1:s', senderName: 'priya', body: `@litti review ${id}` }))!;
    const t = decodeURIComponent(reply.match(/\?t=(\S+)/)![1]);
    const page = (await app.inject({ url: `/approve/${id}?t=${encodeURIComponent(t)}` })).body;
    assert.match(page, /value="priya" readonly/);
    // Typed name is ignored; identity comes from the ticket.
    const r = (await submit(id, { approver: 'someone-else', ticket: t, quizAnswer: answer(id), viewStamp: stamp(id, 15000) })).json();
    assert.equal(r.ok, true, r.message);
    assert.ok(room.some(m => m.includes('Reviewed by priya')));
  });

  await step('requester cannot get a review link for their own action', async () => {
    const { id } = await propose();
    assert.match((await chat({ roomId: 'r', sender: '@a', senderName: 'coder-bot', body: `@litti review ${id}` }))!, /someone else/);
  });

  await step('tickets are bound to one action and expire', async () => {
    const a = await propose();
    const b = await propose();
    const forA = issueTicket(a.id, 'sam', '@s');
    assert.equal((await submit(b.id, { ticket: forA, quizAnswer: answer(b.id), viewStamp: stamp(b.id, 15000) })).statusCode, 401);
    const old = issueTicket(a.id, 'sam', '@s', Date.now() - 31 * 60 * 1000);
    assert.equal((await submit(a.id, { ticket: old, quizAnswer: answer(a.id), viewStamp: stamp(a.id, 15000) })).statusCode, 401);
    const forged = forA.slice(0, -4) + 'AAAA';
    assert.equal((await submit(a.id, { ticket: forged, quizAnswer: answer(a.id), viewStamp: stamp(a.id, 15000) })).statusCode, 401);
  });

  await step('review time is measured by the server, not the browser', async () => {
    const { id } = await propose();
    const t = issueTicket(id, 'sam', '@s');
    // Browser claims 60s but the page was opened 1s ago.
    const fast = (await submit(id, { ticket: t, quizAnswer: answer(id), timeSpentMs: 60000, viewStamp: stamp(id, 1000) })).json();
    assert.equal(fast.ok, false);
    assert.match(fast.message, /at least 10s/);
    assert.equal((await submit(id, { ticket: t, quizAnswer: answer(id), timeSpentMs: 60000 })).statusCode, 400);
    const tampered = stamp(id, 60000).replace(/^./, c => (c === 'A' ? 'B' : 'A'));
    assert.equal((await submit(id, { ticket: t, quizAnswer: answer(id), viewStamp: tampered })).statusCode, 400);
  });

  await step('SSO header identity (LITTI_IDENTITY_HEADER)', async () => {
    process.env.LITTI_IDENTITY_HEADER = 'x-forwarded-email';
    const { id } = await propose();
    const r = (await submit(id, { quizAnswer: answer(id), viewStamp: stamp(id, 15000) }, { 'x-forwarded-email': 'lee@acme.com' })).json();
    assert.equal(r.ok, true, r.message);
    assert.ok(room.some(m => m.includes('Reviewed by lee@acme.com')));
    delete process.env.LITTI_IDENTITY_HEADER;
  });

  await step('signed deploy webhook + pipeline token verification', async () => {
    const received: { sig: string; body: string }[] = [];
    hook = Fastify();
    hook.addContentTypeParser('application/json', { parseAs: 'string' }, (_r, body, done) => done(null, body));
    hook.post('/deploy', (req) => { received.push({ sig: String(req.headers['x-litti-signature']), body: req.body as string }); return { ok: true }; });
    await hook.listen({ port: 0, host: '127.0.0.1' });
    process.env.LITTI_DEPLOY_WEBHOOK = `http://127.0.0.1:${(hook.server.address() as any).port}/deploy`;
    process.env.LITTI_API_KEY = 'pipeline-key';
    const key = { 'x-litti-key': 'pipeline-key' };

    const { id } = await propose(key);
    const t = issueTicket(id, 'sam', '@s');
    const r = (await submit(id, { ticket: t, quizAnswer: answer(id), viewStamp: stamp(id, 15000) })).json();
    assert.equal(r.ok, true, r.message);
    assert.equal(received.length, 1);
    const expected = 'sha256=' + createHmac('sha256', process.env.SECRET_KEY!).update(received[0].body).digest('hex');
    assert.equal(received[0].sig, expected, 'webhook signature verifies');
    assert.equal(JSON.parse(received[0].body).action.id, id);

    assert.equal((await app.inject({ url: `/api/actions/${id}` })).statusCode, 401);
    const status = (await app.inject({ url: `/api/actions/${id}`, headers: key })).json();
    assert.equal(status.status, 'approved');
    assert.ok(status.token?.signature);
    const ok = (await app.inject({ method: 'POST', url: '/api/tokens/verify', headers: key, payload: { token: status.token, diff: DIFF } })).json();
    assert.equal(ok.valid, true);
    const changed = (await app.inject({ method: 'POST', url: '/api/tokens/verify', headers: key, payload: { token: status.token, diff: DIFF + ' ' } })).json();
    assert.equal(changed.valid, false);
    assert.match(changed.reason, /Diff changed/);
    const forgedToken = { ...status.token, approvers: ['sam', 'eve'] };
    assert.equal((await app.inject({ method: 'POST', url: '/api/tokens/verify', headers: key, payload: { token: forgedToken, diff: DIFF } })).json().valid, false);
    delete process.env.LITTI_DEPLOY_WEBHOOK;
    delete process.env.LITTI_API_KEY;
  });

  await step('rubber-stamp penalty survives a restart (persisted)', async () => {
    const { id } = await propose();
    const t = issueTicket(id, 'zed', '@z');
    await submit(id, { ticket: t, quizAnswer: 'definitely wrong', viewStamp: stamp(id, 15000) });
    assert.equal(getSetting('pending_tier_bump'), '1');
    const next = await propose();
    assert.equal(next.tier, 2, 'tier 1 edit bumped to tier 2');
    assert.equal(getSetting('pending_tier_bump'), '0');
  });

  console.log(`\n✅ ${passed} production checks passed`);
} catch (err) {
  console.error(`\n❌ failed after ${passed} production checks:`, err);
  process.exitCode = 1;
} finally {
  await (hook as ReturnType<typeof Fastify> | null)?.close();
  rmSync(process.env.LITTI_DEPLOY_DIR!, { recursive: true, force: true });
}
