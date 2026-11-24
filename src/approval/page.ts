/** Generates the self-contained approval HTML page. Dark theme, no frameworks. */
import { fontFaces, THEME_TOKENS, THEME_BASE } from '../ui/theme.js';
import type { ActionCard, Quiz, Tier } from '../types.js';
import { diffLineKinds } from '../agents/challenges.js';

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

/** Render a diff as color-coded, line-numbered HTML. Colours come from the classifier the challenges use. */
function renderDiff(diff: string, pickable = false): string {
  const kinds = diffLineKinds(diff);
  return diff.split('\n').map((line, i) => {
    const k = kinds[i];
    const cls = k === 'add' || k === 'del' || k === 'hunk' ? `ln ${k}` : 'ln';
    if (pickable) return `<div class="${cls} pick" data-n="${i + 1}" role="button" tabindex="0" aria-pressed="false" aria-label="Line ${i + 1}: ${esc(line) || 'blank'}"><span class="num">${i + 1}</span><span class="code">${esc(line) || ' '}</span></div>`;
    return `<div class="${cls}"><span class="num">${i + 1}</span><span class="code">${esc(line) || ' '}</span></div>`;
  }).join('');
}

const KIND_LABEL: Record<NonNullable<Quiz['kind']>, string> = {
  quiz: 'Quiz',
  'spot-line': 'Spot the line',
  'type-in': 'Recall',
  canary: 'Canary check',
  count: 'Count',
  explain: 'Explain it',
};

/** Inputs for the comprehension check, by kind. Answers are checked on the server. */
function renderChallenge(quiz: Quiz): string {
  switch (quiz.kind ?? 'quiz') {
    case 'spot-line':
      return '<div class="hint">Click the line in the diff above. <span id="pickedline" role="status" aria-live="polite">No line selected.</span> Keyboard: Tab to a line, then Enter or Space.</div>';
    case 'type-in':
      return '<input id="answer" class="ans" autocomplete="off" spellcheck="false" placeholder="Type it exactly as in the diff"><div class="hint">No options to pick from: you need to have read it.</div>';
    case 'count':
      return '<input id="answer" class="ans" type="number" min="0" step="1" inputmode="numeric" placeholder="Number of lines">';
    case 'explain':
      return '<textarea id="answer" class="ans" maxlength="600" placeholder="This change ..."></textarea><div class="hint"><span id="wc" aria-live="polite">0 / 6 words</span> · Saved in the receipt as your review note.</div>';
    case 'canary':
      return `<div class="canary" id="canaryline">${esc(quiz.subject ?? '')}</div>`
        + `<div role="radiogroup" aria-labelledby="quizq canaryline"><label class="opt"><input type="radio" name="quiz" value="yes"><span>${esc(quiz.options[0] ?? 'Yes')}</span></label>`
        + `<label class="opt"><input type="radio" name="quiz" value="no"><span>${esc(quiz.options[1] ?? 'No')}</span></label></div>`;
    default:
      return '<div role="radiogroup" aria-labelledby="quizq">' + quiz.options.map(opt =>
        `<label class="opt"><input type="radio" name="quiz" value="${esc(opt)}"><span>${esc(opt)}</span></label>`).join('') + '</div>';
  }
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
  const kind = quiz.kind ?? 'quiz';
  const challengeHtml = renderChallenge(quiz);

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Litti — Countersign</title><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#121212">
<style>
${fontFaces()}:root{${THEME_TOKENS}--bg:var(--canvas);--surface:var(--canvas-2);--border:var(--line);--text:var(--ink);--text-muted:var(--ink-faint);--green:var(--ok);--red:var(--bad);--yellow:var(--warn);--orange:var(--hot);--blue:var(--accent);--font-mono:var(--mono);--font-sans:var(--sans);}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-sans);line-height:1.5}
.wrap{max-width:860px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:20px;margin:0 0 4px;letter-spacing:.5px}
.sub{color:var(--text-muted);font-size:13px;margin-bottom:24px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);padding:20px;margin-bottom:20px}
.badge{display:inline-block;padding:4px 12px;border-radius:var(--r-sm);font-weight:700;font-size:12px;color:var(--canvas);letter-spacing:1px}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.reasons{margin:12px 0 0;padding-left:18px;color:var(--text-muted);font-size:13px}
.meta{color:var(--text-muted);font-size:13px;margin-top:8px}
.diff{background:var(--canvas);border:1px solid var(--border);border-radius:var(--r-md);overflow:auto;font-family:var(--font-mono);font-size:13px;max-height:420px}
.ln{display:flex;white-space:pre}
.ln .num{width:44px;text-align:right;padding:0 10px;color:var(--text-muted);user-select:none;flex:0 0 auto}
.ln .code{padding:0 10px;flex:1}
.ln.add{background:#12331f}.ln.add .code{color:#7ee2a8}
.ln.del{background:#3a1a1a}.ln.del .code{color:#ff9b94}
.ln.hunk{background:var(--accent-soft)}.ln.hunk .code{color:var(--blue)}
.opt{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--r-sm);margin-bottom:8px;cursor:pointer;font-family:var(--font-mono);font-size:13px}
.opt:hover{border-color:var(--blue)}
.chkrow{display:flex;align-items:center;gap:10px;margin:16px 0}
.q{font-weight:600;display:block;margin-bottom:12px}
button{background:var(--blue);color:var(--accent-ink);border:0;border-radius:var(--r-md);padding:12px 22px;font-size:15px;font-weight:700;cursor:pointer}
button:disabled{opacity:.4;cursor:not-allowed}
.idnote{font-size:12px;color:var(--text-muted);margin-top:6px}
.idnote code{font-family:var(--font-mono);color:var(--blue)}
.timer{font-family:var(--font-mono);color:var(--text-muted);font-size:12px;margin-left:auto}
#result{margin-top:16px;font-weight:600}
.ok{color:var(--green)}.bad{color:var(--red)}
.scrollnote{color:var(--yellow);font-size:12px;margin-top:8px}
.kind{display:inline-block;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--blue);border:1px solid var(--border);border-radius:999px;padding:2px 10px;margin-bottom:10px}
.ln.pick{cursor:pointer}.ln.pick:hover{outline:1px solid var(--blue);outline-offset:-1px}
.ln.picked{outline:2px solid var(--blue);outline-offset:-2px;background:var(--accent-soft)}
.canary{font-family:var(--font-mono);font-size:13px;background:var(--canvas);border:1px dashed var(--yellow);border-radius:var(--r-sm);padding:12px;margin-bottom:12px;white-space:pre-wrap;word-break:break-all}
.ans{width:100%;padding:10px;background:var(--canvas);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text);font-family:var(--font-mono);font-size:14px}
textarea.ans{font-family:var(--font-sans);min-height:84px;resize:vertical}
.hint{font-size:12px;color:var(--text-muted);margin-top:6px}
button:focus-visible,input:focus-visible,textarea:focus-visible,.ln.pick:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.opt:focus-within{border-color:var(--blue);box-shadow:0 0 0 1px var(--blue)}
${THEME_BASE}</style></head>
<body><div class="wrap">
<h1 style="display:flex;align-items:center;gap:12px"><img src="/brand/litti-logo.svg" alt="Litti" height="30" style="display:block;height:30px;width:auto"><span>· COUNTERSIGN</span></h1>
<div class="sub">Prove you read it. Your signature binds to this exact diff.</div>

<div class="card">
  <div class="row">
    <span class="badge" style="background:${meta.color}">TIER ${tier} · ${meta.label}</span>
    <span>${esc(card.action.toUpperCase())}</span>
    <span class="timer" id="timer">0.0s on page</span><span class="timer" style="margin-left:10px">min review ${tier >= 2 ? 30 : 10}s</span>
  </div>
  <div class="meta">${esc(card.description)}</div>
  <div class="meta">Approvers: <strong>${approvalsSoFar}/${requiredApprovers}</strong> · Paths: ${card.touchedPaths.map(esc).join(', ')} · Reversible: ${card.reversible ? 'yes' : 'no'}</div>
  <ul class="reasons">${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
</div>

<div class="card">
  <div class="diff" id="diff">${renderDiff(card.diff, kind === 'spot-line')}<div id="sentinel"></div></div>
  ${lineCount > 20 ? '<div class="scrollnote" id="scrollnote" role="status" aria-live="polite">↓ Scroll to the end of the diff to enable approval.</div>' : ''}
</div>

<div class="card challenge">
  <div class="kind">${esc(KIND_LABEL[kind])}</div>
  ${kind === 'type-in' || kind === 'count' || kind === 'explain'
    ? `<label class="q" id="quizq" for="answer">${esc(quiz.question)}</label>`
    : `<div class="q" id="quizq">${esc(quiz.question)}</div>`}
  ${challengeHtml}
</div>

<div class="card">
  <input type="hidden" id="actionId" value="${esc(card.id)}">
  <label class="q" for="approver">Approver</label>
  <input id="approver" value="${esc(approver)}" ${identityLocked ? 'readonly' : ''} placeholder="${allowTyped ? 'Your name' : 'Open your personal review link'}" style="width:100%;padding:10px;background:var(--canvas);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text);font-family:var(--font-mono)">
  <div class="idnote">${identityLocked ? '🔐 Verified reviewer' : allowTyped ? 'Demo mode: typed names accepted.' : '🔐 Get your personal review link: <code>litti review ' + esc(card.id) + ' --as &lt;you&gt;</code>'}</div>
  <input type="hidden" id="viewStamp" value="${esc(viewStamp)}">
  <input type="hidden" id="ticket" value="${esc(ticket)}">
  <div class="chkrow"><input type="checkbox" id="reviewed"><label for="reviewed">I have reviewed this change.</label></div>
  <button id="submit" disabled>Countersign</button>
  <div id="result" role="status" aria-live="polite"></div>
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
const kind=${JSON.stringify(kind)};
let picked=null;
function selectedAnswer(){
  if(kind==='spot-line')return picked;
  const r=document.querySelector('input[name=quiz]:checked');if(r)return r.value;
  const t=document.getElementById('answer');if(!t)return null;
  const v=t.value.trim();
  if(kind==='explain'){const w=v.split(/\\s+/).filter(Boolean).length;const c=document.getElementById('wc');if(c)c.textContent=w+' / 6 words';return w>=6?v:null;}
  return v||null;
}
// Read the answer first so the word counter updates before the box is ticked.
function refresh(){const a=selectedAnswer();btn.disabled=!(reviewed.checked && scrolled && a);}
reviewed.addEventListener('change',refresh);
document.querySelectorAll('input[name=quiz]').forEach(r=>r.addEventListener('change',refresh));
const ansEl=document.getElementById('answer');if(ansEl)ansEl.addEventListener('input',refresh);
if(kind==='spot-line'){
  const pickLine=(el)=>{document.querySelectorAll('.ln.picked').forEach(x=>x.classList.remove('picked'));document.querySelectorAll('.ln.pick[aria-pressed=true]').forEach(x=>x.setAttribute('aria-pressed','false'));el.classList.add('picked');el.setAttribute('aria-pressed','true');picked=el.dataset.n;const p=document.getElementById('pickedline');if(p)p.textContent='Selected line '+picked;refresh();};
  document.querySelectorAll('.ln.pick').forEach(el=>{el.addEventListener('click',()=>pickLine(el));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pickLine(el);}});});
}

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
