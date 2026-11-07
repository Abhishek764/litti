/** Generates the self-contained approval HTML page. Dark theme, no frameworks. */
import type { ActionCard, Quiz, Tier } from '../types.js';

const TIER_META: Record<Tier, { label: string; color: string }> = {
  0: { label: 'AUTO', color: 'var(--green)' },
  1: { label: 'LOW', color: 'var(--yellow)' },
  2: { label: 'HIGH', color: 'var(--orange)' },
  3: { label: 'CRITICAL', color: 'var(--red)' },
};

/** Escape HTML-significant characters. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Render a diff as color-coded, line-numbered HTML. */
function renderDiff(diff: string): string {
  return diff.split('\n').map((line, i) => {
    let cls = 'ln';
    if (line.startsWith('+') && !line.startsWith('+++')) cls = 'ln add';
    else if (line.startsWith('-') && !line.startsWith('---')) cls = 'ln del';
    else if (line.startsWith('@@')) cls = 'ln hunk';
    return `<div class="${cls}"><span class="num">${i + 1}</span><span class="code">${esc(line) || ' '}</span></div>`;
  }).join('');
}

/** Build the full approval page HTML string. */
export function renderApprovalPage(args: {
  card: ActionCard;
  tier: Tier;
  reasons: string[];
  requiredApprovers: number;
  approvalsSoFar: number;
  quiz: Quiz;
  approver: string;
  /** Identity came from SSO or a signed review link: name can't be edited. */
  identityLocked: boolean;
  /** Typed names allowed (demo mode). */
  allowTyped: boolean;
  /** Signed page-open stamp; the server measures review time from it. */
  viewStamp: string;
  /** Signed review ticket from the link, if any. */
  ticket: string;
}): string {
  const { card, tier, reasons, requiredApprovers, approvalsSoFar, quiz, approver, identityLocked, allowTyped, viewStamp, ticket } = args;
  const meta = TIER_META[tier];
  const lineCount = card.diff.split('\n').length;
  const options = quiz.options.map((opt, i) =>
    `<label class="opt"><input type="radio" name="quiz" value="${esc(opt)}"><span>${esc(opt)}</span></label>`
  ).join('');

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Litti — Countersign</title><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#0A0D12">
<style>
:root{
  --bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--text-muted:#8b949e;
  --green:#3fb950;--red:#f85149;--yellow:#d29922;--orange:#db6d28;--blue:#58a6ff;
  --font-mono:'SF Mono','Cascadia Code','Fira Code',monospace;
  --font-sans:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-sans);line-height:1.5}
.wrap{max-width:860px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:20px;margin:0 0 4px;letter-spacing:.5px}
.sub{color:var(--text-muted);font-size:13px;margin-bottom:24px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:20px;margin-bottom:20px}
.badge{display:inline-block;padding:4px 12px;border-radius:6px;font-weight:700;font-size:12px;color:#0d1117;letter-spacing:1px}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.reasons{margin:12px 0 0;padding-left:18px;color:var(--text-muted);font-size:13px}
.meta{color:var(--text-muted);font-size:13px;margin-top:8px}
.diff{background:#0a0d12;border:1px solid var(--border);border-radius:8px;overflow:auto;font-family:var(--font-mono);font-size:13px;max-height:420px}
.ln{display:flex;white-space:pre}
.ln .num{width:44px;text-align:right;padding:0 10px;color:var(--text-muted);user-select:none;flex:0 0 auto}
.ln .code{padding:0 10px;flex:1}
.ln.add{background:#12331f}.ln.add .code{color:#7ee2a8}
.ln.del{background:#3a1a1a}.ln.del .code{color:#ff9b94}
.ln.hunk{background:#10233f}.ln.hunk .code{color:var(--blue)}
.opt{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;cursor:pointer;font-family:var(--font-mono);font-size:13px}
.opt:hover{border-color:var(--blue)}
.chkrow{display:flex;align-items:center;gap:10px;margin:16px 0}
.q{font-weight:600;display:block;margin-bottom:12px}
button{background:var(--blue);color:#06101f;border:0;border-radius:8px;padding:12px 22px;font-size:15px;font-weight:700;cursor:pointer}
button:disabled{opacity:.4;cursor:not-allowed}
.idnote{font-size:12px;color:var(--text-muted);margin-top:6px}
.idnote code{font-family:var(--font-mono);color:var(--blue)}
.timer{font-family:var(--font-mono);color:var(--text-muted);font-size:12px;margin-left:auto}
#result{margin-top:16px;font-weight:600}
.ok{color:var(--green)}.bad{color:var(--red)}
.scrollnote{color:var(--yellow);font-size:12px;margin-top:8px}
</style></head>
<body><div class="wrap">
<h1 style="display:flex;align-items:center;gap:12px"><img src="/brand/litti-logo.svg" alt="Litti" height="30" style="display:block;height:30px;width:auto"><span>· COUNTERSIGN</span></h1>
<div class="sub">Prove you read it. Your signature binds to this exact diff.</div>

<div class="card">
  <div class="row">
    <span class="badge" style="background:${meta.color}">TIER ${tier} · ${meta.label}</span>
    <span>${esc(card.action.toUpperCase())}</span>
    <span class="timer" id="timer">0.0s on page</span><span class="timer" style="margin-left:10px;opacity:.7">min review ${tier >= 2 ? 30 : 10}s</span>
  </div>
  <div class="meta">${esc(card.description)}</div>
  <div class="meta">Approvers: <strong>${approvalsSoFar}/${requiredApprovers}</strong> · Paths: ${card.touchedPaths.map(esc).join(', ')} · Reversible: ${card.reversible ? 'yes' : 'no'}</div>
  <ul class="reasons">${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
</div>

<div class="card">
  <div class="diff" id="diff">${renderDiff(card.diff)}<div id="sentinel"></div></div>
  ${lineCount > 20 ? '<div class="scrollnote" id="scrollnote">↓ Scroll to the end of the diff to enable approval.</div>' : ''}
</div>

<div class="card">
  <div class="q" id="quizq">${esc(quiz.question)}</div>
  ${options}
</div>

<div class="card">
  <input type="hidden" id="actionId" value="${esc(card.id)}">
  <label class="q" for="approver">Approver</label>
  <input id="approver" value="${esc(approver)}" ${identityLocked ? 'readonly' : ''} placeholder="${allowTyped ? 'Your name' : 'Open your personal review link'}" style="width:100%;padding:10px;background:#0a0d12;border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:var(--font-mono)">
  <div class="idnote">${identityLocked ? '🔐 Verified reviewer' : allowTyped ? 'Demo mode: typed names accepted.' : '🔐 Get your personal review link: <code>litti review ' + esc(card.id) + ' --as &lt;you&gt;</code>'}</div>
  <input type="hidden" id="viewStamp" value="${esc(viewStamp)}">
  <input type="hidden" id="ticket" value="${esc(ticket)}">
  <div class="chkrow"><input type="checkbox" id="reviewed"><label for="reviewed">I have reviewed this change.</label></div>
  <button id="submit" disabled>Countersign</button>
  <div id="result"></div>
</div>
</div>
<script>
const start=Date.now();
const needScroll=${lineCount > 20};
let scrolled=!needScroll;
const timerEl=document.getElementById('timer');
setInterval(()=>{timerEl.textContent=((Date.now()-start)/1000).toFixed(1)+'s on page';},100);

if(needScroll){
  const io=new IntersectionObserver((entries)=>{
    entries.forEach(e=>{if(e.isIntersecting){scrolled=true;const n=document.getElementById('scrollnote');if(n){n.textContent='✓ Diff read to the end.';n.style.color='var(--green)';}refresh();}});
  },{root:document.getElementById('diff'),threshold:1});
  io.observe(document.getElementById('sentinel'));
}

const reviewed=document.getElementById('reviewed');
const btn=document.getElementById('submit');
function selectedAnswer(){const r=document.querySelector('input[name=quiz]:checked');return r?r.value:null;}
function refresh(){btn.disabled=!(reviewed.checked && scrolled && selectedAnswer());}
reviewed.addEventListener('change',refresh);
document.querySelectorAll('input[name=quiz]').forEach(r=>r.addEventListener('change',refresh));

btn.addEventListener('click',async()=>{
  btn.disabled=true;
  const body={
    actionId:document.getElementById('actionId').value,
    approver:document.getElementById('approver').value,
    viewStamp:document.getElementById('viewStamp').value,
    ticket:document.getElementById('ticket').value,
    quizAnswer:selectedAnswer(),
    timeSpentMs:Date.now()-start,
    scrolledToBottom:scrolled,
    timestamp:new Date().toISOString()
  };
  const out=document.getElementById('result');
  try{
    const res=await fetch(location.pathname+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await res.json();
    out.textContent=data.message;
    out.className=data.ok?'ok':'bad';
    if(!data.ok)btn.disabled=false;
  }catch(err){
    out.textContent='Network error — try again.';
    out.className='bad';
    btn.disabled=false;
  }
});
</script>
</body></html>`;
}
