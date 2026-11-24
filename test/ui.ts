/** UI tests: dashboard receipts + retry, inbox, review page accessibility. Pages run against a tiny fake DOM. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderInbox, age } from '../src/approval/inbox.js';
import { renderApprovalPage } from '../src/approval/page.js';
import { buildActionCard } from '../src/agents/builder.js';
import type { PendingAction, Quiz } from '../src/types.js';

let passed = 0;
async function step(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`  ✓ ${name}`); }

/** Minimal element: enough for the dashboard script (innerHTML, textContent, style, listeners). */
function fakeEl(): any {
  const listeners: Record<string, Function[]> = {};
  return {
    innerHTML: '', textContent: '', style: {}, dataset: {}, disabled: false, classList: { add() {}, remove() {} },
    addEventListener(t: string, f: Function) { (listeners[t] ??= []).push(f); },
    fire(t: string, ev: unknown) { for (const f of listeners[t] ?? []) f(ev); },
    querySelector() { return null; }, closest() { return null; },
  };
}

/** Run the dashboard's inline script with fetch answering from `routes`. */
async function runDashboard(routes: (url: string, init?: any) => { status: number; body: unknown }) {
  const html = readFileSync('public/dashboard.html', 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const els: Record<string, any> = {};
  const document = {
    getElementById: (id: string) => (els[id] ??= fakeEl()),
    querySelector: () => fakeEl(),
    querySelectorAll: () => [],
  };
  const calls: Array<{ url: string; init?: any }> = [];
  const fetch = async (url: string, init?: any) => {
    calls.push({ url, init });
    const r = routes(url, init);
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  };
  new Function('document', 'fetch', 'setTimeout', 'console', script)(document, fetch, () => 0, { error() {} });
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  return { els, calls, script };
}

const receipt = (id: string, actionId: string, outcome: string, timestamp: string) => ({
  id, outcome, timestamp, tier: 2, attentionScore: 80, chainHash: 'h' + id, approvals: [{ approver: 'ana' }],
  actionCard: { id: actionId, description: `action ${actionId}` },
});

await step('dashboard: deploy-failed has its own colour and label, Retry only on the newest receipt of the action', async () => {
  const list = [
    receipt('r1', 'a1', 'deploy-failed', '2026-11-21T10:00:00.000Z'),
    receipt('r2', 'a1', 'approved', '2026-11-21T10:05:00.000Z'),
    receipt('r3', 'a2', 'deploy-failed', '2026-11-21T10:06:00.000Z'),
    receipt('r4', 'a3', 'superseded', '2026-11-21T10:07:00.000Z'),
  ];
  const { els, script } = await runDashboard(url => ({ status: 200, body: url === '/api/receipts' ? list : url === '/api/stats' ? [] : {} }));
  const out: string = els.receipts.innerHTML;
  assert.match(script, /'deploy-failed':'var\(--orange\)'/);
  assert.equal((out.match(/APPROVED · DELIVERY FAILED/g) ?? []).length, 2);
  assert.equal((out.match(/class="retry"/g) ?? []).length, 1, 'a1 was retried successfully: only a2 can be retried');
  assert.match(out, /data-action="a2"/);
  assert.match(out, /class="card muted" data-id="r4"/, 'superseded is muted');
  assert.match(out, /SUPERSEDED/);
});

await step('dashboard: Retry posts with x-litti-ui and shows the server message for 200, 502 and 409', async () => {
  for (const [status, message, ok] of [[200, 'Delivered.', true], [502, 'Webhook down.', false], [409, 'Nothing to retry: the action is approved.', false]] as const) {
    const { els, calls } = await runDashboard((url) => url.endsWith('/retry')
      ? { status, body: { ok, message } }
      : { status: 200, body: url === '/api/receipts' ? [receipt('r1', 'a 1', 'deploy-failed', 't')] : url === '/api/stats' ? [] : {} });
    const msg = fakeEl();
    const btn = { ...fakeEl(), dataset: { action: 'a 1' }, closest: () => ({ querySelector: () => msg }) };
    els.receipts.fire('click', { target: { closest: () => btn } });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    const call = calls.find(c => c.url.endsWith('/retry'))!;
    assert.equal(call.url, '/api/actions/a%201/retry');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers['x-litti-ui'], '1');
    assert.ok(msg.textContent.includes(message), `${status}: ${msg.textContent}`);
    assert.equal(msg.style.color, ok ? 'var(--green)' : 'var(--red)');
    assert.equal(btn.disabled, ok, 'the button comes back after a failure');
  }
});

const pendingAction = (id: string, status: string, tier: 0 | 1 | 2 | 3, createdAt: string, agent = 'claude-code') => ({
  id, tier, status, createdAt, requiredApprovers: 2, currentApprovals: [{ approver: 'ana' }], quiz: { question: '', options: [], correctIndex: 0 }, quizAnswer: '',
  actionCard: { id, agent, action: 'commit', description: `desc ${id}`, diff: '', diffHash: '', touchedPaths: ['src/a.ts'], reversible: true, rollbackPlan: '', timestamp: createdAt },
}) as unknown as PendingAction;

await step('inbox: only pending actions, each with requester, tier and age', () => {
  const now = Date.parse('2026-11-21T12:00:00.000Z');
  const html = renderInbox([
    pendingAction('p1', 'pending', 3, '2026-11-21T11:55:00.000Z', '<agent>'),
    pendingAction('p2', 'approved', 1, '2026-11-21T11:00:00.000Z'),
    pendingAction('p3', 'superseded', 1, '2026-11-21T11:00:00.000Z'),
    pendingAction('p4', 'deploy-failed', 2, '2026-11-21T11:00:00.000Z'),
    pendingAction('p5', 'rejected', 2, '2026-11-21T11:00:00.000Z'),
    pendingAction('p6', 'pending', 1, '2026-11-19T11:00:00.000Z'),
  ], 'http://127.0.0.1:3882', now);
  assert.match(html, /approve\/p1/);
  assert.match(html, /approve\/p6/);
  for (const id of ['p2', 'p3', 'p4', 'p5']) assert.doesNotMatch(html, new RegExp(`approve/${id}`), `${id} is not pending`);
  assert.match(html, /Requested by <b class="who">&lt;agent&gt;<\/b>/, 'requester shown and escaped');
  assert.match(html, /Tier 3 · critical/);
  assert.match(html, /5 min ago/);
  assert.match(html, /2 days ago/);
  assert.match(html, /aria-label="1 of 2 approvals"/);
  assert.match(html, /href="\/changes"/);
  assert.match(html, /href="\/integrations"/);
  assert.doesNotMatch(html, /Get started/);
  assert.equal(age('2026-11-21T11:59:30.000Z', now), 'just now');
  assert.equal(age('2026-11-21T09:00:00.000Z', now), '3 h ago');
  assert.equal(age('garbage', now), 'unknown age');
});

await step('inbox: nothing pending (even with old non-pending rows) shows the Get started guide', () => {
  const html = renderInbox([pendingAction('p2', 'approved', 1, '2026-11-21T11:00:00.000Z')], 'http://127.0.0.1:3882');
  assert.match(html, /Nothing waiting for review/);
  assert.match(html, /Get started/);
  assert.match(html, /litti install claude/);
});

/** Every visible form control has an accessible name: label[for], a wrapping <label>, aria-label or aria-labelledby. */
function unlabelled(html: string): string[] {
  const bad: string[] = [];
  for (const m of html.matchAll(/<(input|textarea|select)\b[^>]*>/g)) {
    const tag = m[0];
    if (/type="hidden"/.test(tag)) continue;
    if (/aria-label(ledby)?="[^"]+"/.test(tag)) continue;
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    if (id && new RegExp(`<label[^>]*\\bfor="${id}"`).test(html)) continue;
    const before = html.slice(0, m.index);
    if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue;
    bad.push(tag);
  }
  return bad;
}

const reviewPage = (kind: NonNullable<Quiz['kind']>, extra: Partial<Parameters<typeof renderApprovalPage>[0]> = {}) => renderApprovalPage({
  card: buildActionCard({ action: 'edit', description: 'Charge in cents', diff: '--- a/p.ts\n+++ b/p.ts\n@@ -1 +1 @@\n-export const v = 1;\n+export const v = 2;', touchedPaths: ['p.ts'], reversible: true, rollbackPlan: '' }),
  tier: 2, reasons: ['r'], requiredApprovers: 1, approvalsSoFar: 0,
  quiz: { kind, question: 'What changed?', options: kind === 'quiz' ? ['a', 'b', 'c', 'd'] : kind === 'canary' ? ['Yes', 'No'] : [], correctIndex: -1, subject: 'export const v = 2;' },
  approver: '', identityLocked: false, allowTyped: false, viewStamp: 's', ticket: '', ...extra,
});

await step('review page: every input has a label, for every challenge kind and identity mode', () => {
  for (const kind of ['quiz', 'spot-line', 'type-in', 'canary', 'count', 'explain'] as const) {
    for (const extra of [{}, { identityLocked: true, approver: 'ana' }, { allowTyped: true }]) {
      const html = reviewPage(kind, extra);
      assert.deepEqual(unlabelled(html), [], `${kind}: unlabelled inputs`);
      if (kind === 'quiz' || kind === 'canary') assert.match(html, /role="radiogroup" aria-labelledby="quizq/, `${kind}: options are a named group`);
      if (kind === 'type-in' || kind === 'count' || kind === 'explain') assert.match(html, /<label class="q" id="quizq" for="answer">/);
    }
  }
  // The checker itself catches a bare input.
  assert.equal(unlabelled('<input id="x">').length, 1);
});

await step('review page: results are announced, focus is visible, spot-the-line works from the keyboard', () => {
  const html = reviewPage('spot-line');
  assert.match(html, /<div id="result" role="status" aria-live="polite">/);
  assert.match(html, /id="pickedline" role="status" aria-live="polite"/);
  assert.match(html, /:focus-visible\{outline:2px solid/);
  const lines = html.match(/<div class="ln[^"]*pick"[^>]*>/g) ?? [];
  assert.equal(lines.length, 5);
  for (const l of lines) { assert.match(l, /role="button"/); assert.match(l, /tabindex="0"/); assert.match(l, /aria-pressed="false"/); assert.match(l, /aria-label="Line \d+: /); }
  assert.match(html, /e\.key==='Enter'\|\|e\.key===' '/);
  assert.match(html, /setAttribute\('aria-pressed','true'\)/);
  assert.doesNotMatch(reviewPage('quiz'), /opacity:\.7/, 'no faded low-contrast text');
});

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

await step('tier badges: dark text on every tier colour meets WCAG AA (4.5:1) on the review page and inbox', () => {
  const page = reviewPage('quiz');
  // Tier colours come from the shared theme tokens (--ok/--warn/--hot/--bad) on the #121212 canvas.
  const vars = Object.fromEntries([...page.matchAll(/--(ok|warn|hot|bad|canvas):(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]));
  assert.match(page, /--green:var\(--ok\);--red:var\(--bad\);--yellow:var\(--warn\);--orange:var\(--hot\)/);
  for (const c of ['ok', 'warn', 'hot', 'bad']) assert.ok(contrast(vars.canvas, vars[c]) >= 4.5, `review ${c} ${vars[c]}`);
  const inbox = renderInbox([], 'http://127.0.0.1:3882');
  for (const m of inbox.matchAll(/\.t\d \{ background:(#[0-9a-f]{6}) \}/g)) assert.ok(contrast('#121212', m[1]) >= 4.5, `inbox ${m[1]}`);
  assert.equal([...inbox.matchAll(/\.t\d \{ background:/g)].length, 4);
  assert.match(inbox, /:focus-visible/);
  assert.match(inbox, /<nav aria-label="Main"/);
  assert.deepEqual(unlabelled(inbox), []);
});

console.log(`\nui: ${passed} passed`);
