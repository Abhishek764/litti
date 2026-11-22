/** Review inbox: the list of actions waiting for reviewers. Plain HTML, no framework. */
import type { PendingAction } from '../types.js';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const TIER = ['Tier 0 · auto', 'Tier 1 · low', 'Tier 2 · high', 'Tier 3 · critical'];

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function age(createdAt: string, now = Date.now()): string {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return 'unknown age';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export function renderInbox(all: PendingAction[], baseUrl: string, now = Date.now()): string {
  // Only actions still waiting: approved, rejected, failed or superseded ones never show here.
  const pending = all.filter(p => p.status === 'pending');
  const rows = pending.map(p => `
    <li><a class="row" href="${esc(`${baseUrl}/approve/${p.id}`)}">
      <span class="tier t${p.tier}">${TIER[p.tier] ?? `Tier ${p.tier}`}</span>
      <span class="desc"><b>${esc(p.actionCard.action)}</b> · ${esc(p.actionCard.description)}<br>
        <small>Requested by <b class="who">${esc(p.actionCard.agent || 'unknown')}</b> · <time datetime="${esc(p.createdAt)}" title="${esc(p.createdAt)}">${esc(age(p.createdAt, now))}</time> · ${esc(p.actionCard.touchedPaths.slice(0, 3).join(', ') || 'no paths')}</small></span>
      <span class="prog" aria-label="${p.currentApprovals.length} of ${p.requiredApprovers} approvals">${p.currentApprovals.length}/${p.requiredApprovers}</span>
    </a></li>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Litti · Review inbox</title><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#0A0D12">
<style>
  :root { --bg:#0a0d12; --card:#121720; --border:#232b38; --text:#e6edf3; --muted:#8b97a8; --accent:#f5b942; }
  * { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,sans-serif }
  main { max-width:860px; margin:0 auto; padding:32px 16px }
  h1 { margin:0 0 4px; font-size:24px } p.sub { color:var(--muted); margin:0 0 24px }
  nav a { color:var(--accent); margin-right:16px; text-decoration:none }
  .row { display:flex; gap:16px; align-items:center; padding:14px 16px; background:var(--card); border:1px solid var(--border);
         border-radius:10px; margin-bottom:10px; color:inherit; text-decoration:none }
  .row:hover { border-color:var(--accent) }
  .tier { white-space:nowrap; font-weight:700; font-size:12px; letter-spacing:.3px; padding:3px 10px; border-radius:6px; color:#0a0d12; min-width:120px; text-align:center }
  .t0 { background:#3fb950 } .t1 { background:#e3b341 } .t2 { background:#f0883e } .t3 { background:#ff7b72 }
  ul.list { list-style:none; margin:0; padding:0 }
  a:focus-visible, .row:focus-visible { outline:2px solid var(--accent); outline-offset:2px }
  .more { color:var(--muted); font-size:14px; margin-top:16px } .more a { color:var(--accent) } .desc { flex:1; min-width:0 } small { color:var(--muted) }
  .prog { font-family:ui-monospace,monospace; color:var(--muted) }
  .empty { padding:40px; text-align:center; color:var(--muted); border:1px dashed var(--border); border-radius:10px }
  .welcome { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:22px 24px; margin-top:8px }
  .welcome h2 { margin:0 0 4px; font-size:18px } .welcome > p { color:var(--muted); margin:0 0 16px }
  .steps { display:grid; gap:12px; counter-reset:s }
  .step { display:grid; grid-template-columns:32px 1fr; gap:12px; align-items:start; counter-increment:s }
  .step::before { content:counter(s); width:28px; height:28px; border-radius:50%; background:var(--accent); color:#0a0d12; font-weight:800; display:grid; place-items:center }
  .step b { display:block } .step span { color:var(--muted); font-size:14px }
  .step code { font-family:ui-monospace,monospace; background:#0a0d12; border:1px solid var(--border); border-radius:6px; padding:2px 7px; color:var(--text); font-size:13px }
  .step a { color:var(--accent) }
</style></head>
<body><main>
  <nav aria-label="Main" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><a href="/" style="margin-right:20px"><img src="/brand/litti-logo.svg" alt="Litti" height="30" style="display:block;height:30px;width:auto"></a><a href="/">Inbox</a><a href="/changes">Changes</a><a href="/integrations">Integrations</a><a href="/dashboard.html">Dashboard</a><a href="/docs">Docs</a></nav>
  <h1 style="margin-top:24px">Waiting for review</h1>
  <p class="sub">Open an action, read the diff, pass the check. Nothing runs until enough reviewers pass.</p>
  ${rows ? `<ul class="list">${rows}</ul>
  <p class="more"><a href="/changes">Changes view</a> shows everything your agent changed, reviewed or not · <a href="/integrations">Integrations</a> post new reviews to Slack, Discord or Jira.</p>` : `<div class="empty">✅ Nothing waiting for review.</div>
  <section class="welcome">
    <h2>Get started</h2>
    <p>Three steps and your coding agent can't ship anything risky without a human who read it.</p>
    <div class="steps">
      <div class="step"><div><b>Put Claude Code behind Litti</b><span>In a new terminal, inside your project folder, run <code>litti install claude</code> and restart Claude Code. Also works with <code>codex</code> and <code>opencode</code>.</span></div></div>
      <div class="step"><div><b>Tell your team</b><span><a href="/integrations">Connect Slack, Discord or Jira</a>. Discord takes one minute.</span></div></div>
      <div class="step"><div><b>Try it</b><span>Ask your agent to change a file and commit it. The commit is blocked with a review link; review it here, then let the agent retry. Want a sandbox first? Run <code>litti demo</code>.</span></div></div>
    </div>
    <p style="margin:16px 0 0"><a href="/docs" style="color:var(--accent)">Read the docs →</a> · <a href="/changes" style="color:var(--accent)">Watch your agent's changes →</a></p>
  </section>`}
</main></body></html>`;
}
