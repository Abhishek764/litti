/** UI tests: dashboard receipts + retry, inbox, review page accessibility. Pages run against a tiny fake DOM. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

console.log(`\nui: ${passed} passed`);
