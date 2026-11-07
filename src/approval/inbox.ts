/** Review inbox: the list of actions waiting for reviewers. Plain HTML, no framework. */
import type { PendingAction } from '../types.js';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const TIER = ['🟢 Tier 0', '🟡 Tier 1', '🟠 Tier 2', '🔴 Tier 3'];

export function renderInbox(pending: PendingAction[], baseUrl: string): string {
  const rows = pending.map(p => `
    <a class="row" href="${esc(`${baseUrl}/approve/${p.id}`)}">
      <span class="tier t${p.tier}">${TIER[p.tier]}</span>
      <span class="desc"><b>${esc(p.actionCard.action)}</b> · ${esc(p.actionCard.description)}<br>
        <small>by ${esc(p.actionCard.agent)} · ${esc(p.actionCard.touchedPaths.slice(0, 3).join(', ') || 'no paths')} · ${esc(new Date(p.createdAt).toLocaleString())}</small></span>
      <span class="prog">${p.currentApprovals.length}/${p.requiredApprovers}</span>
    </a>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Litti · Review inbox</title>
<style>
  :root { --bg:#0a0d12; --card:#121720; --border:#232b38; --text:#e6edf3; --muted:#8b97a8; --accent:#f5b942; }
  * { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,sans-serif }
  main { max-width:860px; margin:0 auto; padding:32px 16px }
  h1 { margin:0 0 4px; font-size:24px } p.sub { color:var(--muted); margin:0 0 24px }
  nav a { color:var(--accent); margin-right:16px; text-decoration:none }
  .row { display:flex; gap:16px; align-items:center; padding:14px 16px; background:var(--card); border:1px solid var(--border);
         border-radius:10px; margin-bottom:10px; color:inherit; text-decoration:none }
  .row:hover { border-color:var(--accent) }
  .tier { white-space:nowrap; font-weight:600; min-width:84px } .desc { flex:1; min-width:0 } small { color:var(--muted) }
  .prog { font-family:ui-monospace,monospace; color:var(--muted) }
  .empty { padding:40px; text-align:center; color:var(--muted); border:1px dashed var(--border); border-radius:10px }
</style></head>
<body><main>
  <nav><a href="/">Inbox</a><a href="/dashboard.html">Dashboard</a></nav>
  <h1 style="margin-top:20px">🔒 Waiting for review</h1>
  <p class="sub">Open an action, read the diff, pass the quiz. Nothing runs until enough reviewers pass.</p>
  ${rows || '<div class="empty">✅ Nothing waiting for review.</div>'}
</main></body></html>`;
}
