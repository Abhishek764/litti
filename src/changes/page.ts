/**
 * Changes page: live view of the working-tree diff with line notes.
 * Plain HTML + inline CSS/JS, no build step. All diff and note text is inserted with
 * textContent, so file contents and agent replies can't inject markup.
 * Line anchors: positive = new-file line, negative = removed line (old-file number), 0 = whole file.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

import { fontFaces, THEME_TOKENS, THEME_BASE } from '../ui/theme.js';
export function renderChangesPage(args: { reviewer: string | null }): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Litti — Changes</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta name="theme-color" content="#121212">
<style>
${fontFaces()}:root{${THEME_TOKENS}--bg:var(--canvas);--surface:var(--canvas-2);--raised:var(--raised);--border:var(--line);--text:var(--ink);--muted:var(--ink-faint);--green:var(--ok);--red:var(--bad);--yellow:var(--warn);--blue:var(--accent);--brass:var(--accent);}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:14px;line-height:1.45}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 20px;background:var(--canvas);border-bottom:1px solid var(--border)}
header img{height:26px;display:block}
.crumb{color:var(--muted);font-family:var(--mono);font-size:12px}
.crumb b{color:var(--text);font-weight:600}
.stat{font-family:var(--mono);font-size:12px}.plus{color:var(--green)}.minus{color:var(--red)}
.spacer{flex:1}
.live{font-size:12px;color:var(--muted)}.live::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:6px;vertical-align:1px}
.live.stale::before{background:var(--yellow)}
button{font:inherit;cursor:pointer;border-radius:var(--r-sm);border:1px solid var(--border);background:var(--raised);color:var(--text);padding:6px 12px}
button.primary{background:var(--brass);color:var(--canvas);border-color:var(--brass);font-weight:700}
button:disabled{opacity:.45;cursor:not-allowed}
.layout{display:grid;grid-template-columns:280px 1fr;min-height:calc(100vh - 52px)}
nav{border-right:1px solid var(--border);padding:12px 0;position:sticky;top:52px;align-self:start;max-height:calc(100vh - 52px);overflow:auto}
nav h2,aside h2{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin:4px 16px 8px}
.file-link{display:flex;align-items:center;gap:8px;padding:5px 16px;color:var(--text);text-decoration:none;font-family:var(--mono);font-size:12px}
.file-link:hover{background:var(--raised)}
.file-link .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.chip{font-size:10px;font-weight:700;border-radius:var(--r-sm);padding:1px 5px;font-family:var(--sans)}
.chip.added{background:#12331f;color:var(--green)}.chip.deleted{background:#3a1a1a;color:var(--red)}
.chip.modified{background:var(--accent-soft);color:var(--blue)}.chip.renamed,.chip.binary{background:#2d2614;color:var(--yellow)}
.notes-count{background:var(--brass);color:var(--canvas);border-radius:999px;font-size:10px;font-weight:700;padding:0 6px}
main{padding:16px 20px 80px;min-width:0}
.file{border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:16px;overflow:hidden;background:var(--surface)}
.file-head{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--raised);font-family:var(--mono);font-size:12px;position:sticky;top:52px;z-index:2}
.file-head .path{flex:1;overflow-wrap:anywhere}
.file-head button{font-size:12px;padding:3px 8px}
.diff{font-family:var(--mono);font-size:12.5px;overflow-x:auto}
.row{display:grid;grid-template-columns:44px 44px 22px 1fr;min-width:max-content}
.row .n{color:var(--muted);text-align:right;padding:0 8px;user-select:none}
.row .code{white-space:pre;padding-right:16px}
.row.add{background:#12331f}.row.add .code{color:#7ee2a8}
.row.del{background:#3a1a1a}.row.del .code{color:#ff9b94}
.row.hunk{background:var(--accent-soft);color:var(--blue)}.row.hunk .code{padding-left:8px}
.row .addnote{visibility:hidden;border:0;background:var(--blue);color:var(--accent-ink);width:18px;height:18px;padding:0;line-height:18px;border-radius:var(--r-sm);font-weight:700;margin-top:1px}
.row:hover .addnote,.row .addnote:focus{visibility:visible}
.thread{margin:6px 12px 10px 110px;border:1px solid var(--border);border-radius:var(--r-md);background:var(--bg);font-family:var(--sans);font-size:13px;white-space:normal;max-width:760px}
.thread.resolved{opacity:.6}
.msg{padding:8px 12px;border-bottom:1px solid var(--border)}
.msg .who{font-weight:600;margin-right:6px}.msg .who.agent{color:var(--brass)}
.msg .when{color:var(--muted);font-size:11px}
.msg .body{margin-top:3px;white-space:pre-wrap;overflow-wrap:anywhere}
.compose{padding:8px 12px;display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}
.compose textarea{flex:1;min-width:220px;min-height:38px;resize:vertical;background:var(--canvas);color:var(--text);border:1px solid var(--border);border-radius:var(--r-sm);padding:7px;font:inherit}
.empty{color:var(--muted);text-align:center;padding:80px 20px}
.problem{color:var(--text)}.problem h2{margin:0 0 8px;font-size:18px}.problem p{color:var(--muted);max-width:560px;margin:0 auto 10px}
.problem code{font-family:ui-monospace,monospace;background:var(--canvas);border:1px solid var(--border);border-radius:var(--r-sm);padding:3px 8px}
.hint{color:var(--muted);font-size:13px;padding:8px 12px}
.toast{position:fixed;bottom:20px;right:20px;background:var(--raised);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 16px;max-width:420px;display:none;z-index:9}
.toast a{color:var(--blue)}
@media (max-width:820px){.layout{grid-template-columns:1fr}nav{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--border)}.thread{margin-left:12px}.file-head{top:0}}
${THEME_BASE}</style></head><body>
<header>
  <a href="/" title="Review inbox"><img src="/brand/litti-logo.svg" alt="Litti"></a>
  <span class="crumb" id="crumb">loading…</span>
  <span class="stat" id="totals"></span>
  <span class="spacer"></span>
  <span class="live" id="live">live</span>
  <button class="primary" id="review" disabled>Request review</button>
</header>
<div class="layout">
  <nav><h2>Changed files</h2><div id="files"></div></nav>
  <main id="main"><div class="empty">Reading the working tree…</div></main>
</div>
<div class="toast" id="toast"></div>
<script>
const ME=${JSON.stringify(args.reviewer ? esc(args.reviewer) : '')};
const H={'content-type':'application/json','x-litti-ui':'1'};
let state={version:'',files:[],threads:[]};
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const ago=(iso)=>{const s=Math.max(0,(Date.now()-new Date(iso))/1000);return s<60?'just now':s<3600?Math.floor(s/60)+'m ago':s<86400?Math.floor(s/3600)+'h ago':new Date(iso).toLocaleDateString();};
function toast(text,link){const t=document.getElementById('toast');t.textContent=text;if(link&&/^https?:/i.test(link)){t.append(' ');const a=el('a','', 'Open review →');a.href=link;t.append(a);}t.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>t.style.display='none',link?20000:5000);}
const fileId=(p)=>'f-'+Array.from(p).map(c=>c.charCodeAt(0).toString(36)).join('');

/** Parse one file's diff into rows with old/new line numbers. */
function rows(diff){
  const out=[];let o=0,n=0,inHunk=false;
  for(const l of diff.split('\\n')){
    const m=l.match(/^@@ -(\\d+)(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@/);
    if(m){o=+m[1];n=+m[2];inHunk=true;out.push({k:'hunk',t:l});continue;}
    if(!inHunk)continue;
    if(l.startsWith('+')){out.push({k:'add',t:l.slice(1),o:'',n:n,a:n});n++;}
    else if(l.startsWith('-')){out.push({k:'del',t:l.slice(1),o:o,n:'',a:-o});o++;}
    else if(l.startsWith('\\\\')){out.push({k:'hunk',t:l});}
    else{out.push({k:'ctx',t:l.slice(1),o:o,n:n,a:n});o++;n++;}
  }
  return out;
}

function threadBox(th){
  const box=el('div','thread'+(th.status==='resolved'?' resolved':''));
  for(const m of [th,...th.replies]){
    const msg=el('div','msg');
    msg.append(el('span','who'+(m.role==='agent'?' agent':''),(m.role==='agent'?'🤖 ':'')+m.author),el('span','when',ago(m.createdAt)),el('div','body',m.body));
    box.append(msg);
  }
  const c=el('div','compose');
  const ta=el('textarea');ta.placeholder=th.status==='resolved'?'Reply to reopen…':'Reply…';
  const send=el('button','', 'Reply');
  send.onclick=async()=>{if(!ta.value.trim())return;send.disabled=true;await post('/api/notes',{parentId:th.id,body:ta.value});await refresh(true);};
  const res=el('button','',th.status==='resolved'?'Reopen':'Resolve');
  res.onclick=async()=>{await post('/api/notes/'+encodeURIComponent(th.id)+'/resolve',{open:th.status==='resolved'});await refresh(true);};
  c.append(ta,send,res);box.append(c);
  return box;
}

function composer(file,anchor,snippet,after){
  if(after.nextSibling&&after.nextSibling.classList&&after.nextSibling.classList.contains('new-note')){after.nextSibling.querySelector('textarea').focus();return;}
  const box=el('div','thread new-note');const c=el('div','compose');
  const ta=el('textarea');ta.placeholder='Ask the agent about this line, or tell it what to change…';
  const send=el('button','primary','Comment');const cancel=el('button','','Cancel');
  send.onclick=async()=>{if(!ta.value.trim())return;send.disabled=true;const r=await post('/api/notes',{file,line:anchor,snippet,body:ta.value});if(!r.ok){toast(r.message||'Could not save the note.');send.disabled=false;return;}await refresh(true);};
  cancel.onclick=()=>box.remove();
  c.append(ta,send,cancel);box.append(c);after.after(box);ta.focus();
}

async function post(url,body){try{const r=await fetch(url,{method:'POST',headers:H,body:JSON.stringify(body)});return await r.json();}catch{return{ok:false,message:'Network error.'};}}

function render(){
  const nav=document.getElementById('files');const main=document.getElementById('main');
  nav.textContent='';main.textContent='';
  const byFile={};for(const th of state.threads)(byFile[th.file]=byFile[th.file]||[]).push(th);
  if(!state.files.length){main.append(el('div','empty','No changes. When your agent edits files in this repository, they show up here.'));}
  let plus=0,minus=0;
  for(const f of state.files){
    plus+=f.added;minus+=f.removed;
    const open=(byFile[f.path]||[]).filter(t=>t.status==='open').length;
    const a=el('a','file-link');a.href='#'+fileId(f.path);
    a.append(el('span','chip '+f.status,f.status[0].toUpperCase()),el('span','name',f.path));
    if(open)a.append(el('span','notes-count',String(open)));
    a.append(el('span','stat plus','+'+f.added),el('span','stat minus','−'+f.removed));
    nav.append(a);

    const card=el('section','file');card.id=fileId(f.path);
    const head=el('div','file-head');
    head.append(el('span','chip '+f.status,f.status),el('span','path',f.path),el('span','stat plus','+'+f.added),el('span','stat minus','−'+f.removed));
    const fileNote=el('button','','💬 File note');head.append(fileNote);
    card.append(head);
    const d=el('div','diff');card.append(d);
    fileNote.onclick=()=>composer(f.path,0,'',head);
    const threads=byFile[f.path]||[];
    for(const th of threads.filter(t=>t.line===0))d.append(threadBox(th));
    const seen=new Set();
    for(const r of rows(f.diff)){
      const row=el('div','row '+r.k);
      if(r.k==='hunk'){row.append(el('span','n'),el('span','n'),el('span',''),el('span','code',r.t));d.append(row);continue;}
      const b=el('button','addnote','+');b.title='Comment on this line';
      b.onclick=()=>composer(f.path,r.a,r.t.trim().slice(0,300),row);
      row.append(el('span','n',String(r.o)),el('span','n',String(r.n)),b,el('span','code',r.t||' '));
      d.append(row);
      for(const th of threads.filter(t=>t.line===r.a&&!seen.has(t.id))){seen.add(th.id);d.append(threadBox(th));}
    }
    // Notes whose line no longer exists in the diff (code moved): keep them visible at the end.
    for(const th of threads.filter(t=>t.line!==0&&!seen.has(t.id))){
      const box=threadBox(th);box.prepend(el('div','msg','📍 was on: '+(th.snippet||('line '+Math.abs(th.line)))));d.append(box);
    }
    main.append(card);
  }
  // Notes on files that are no longer changed.
  const gone=state.threads.filter(t=>!state.files.some(f=>f.path===t.file)&&t.status==='open');
  if(gone.length){const card=el('section','file');const head=el('div','file-head');head.append(el('span','path','Notes on files with no changes now'));card.append(head);for(const th of gone){const b=threadBox(th);b.prepend(el('div','msg','📄 '+th.file+(th.line?' · '+(th.snippet||''):'')));card.append(b);}main.append(card);}
  document.getElementById('totals').innerHTML='';
  const t=document.getElementById('totals');t.append(el('span','',state.files.length+' file'+(state.files.length===1?'':'s')+' '),el('span','plus','+'+plus),' ',el('span','minus','−'+minus));
  const openCount=state.threads.filter(x=>x.status==='open').length;
  document.getElementById('review').disabled=!state.files.length||state.truncated;
  document.getElementById('review').textContent=openCount?'Request review ('+openCount+' open note'+(openCount===1?'':'s')+')':'Request review';
}

const typing=()=>{const a=document.activeElement;return a&&a.tagName==='TEXTAREA'&&a.value.trim();};
async function refresh(force){
  try{
    const [c,n]=await Promise.all([fetch('/api/changes').then(r=>r.json()),fetch('/api/notes').then(r=>r.json()).catch(()=>({threads:[]}))]);
    const live=document.getElementById('live');
    if(!c.ok){showProblem(c);return;}
    problem=false;
    live.className='live';live.textContent='live · '+new Date().toLocaleTimeString();
    document.getElementById('crumb').innerHTML='';
    document.getElementById('crumb').append(el('b','',c.repo.split(/[\\\\/]/).pop()),' · '+c.branch+' @ '+c.head+(c.truncated?' · truncated at 512 KB':''));
    const notesKey=JSON.stringify(n.threads||[]);
    if(!force&&c.version===state.version&&notesKey===state.notesKey)return;
    if(!force&&typing()){live.textContent='updates waiting — finish your note';return;}
    state={version:c.version,files:c.files,truncated:c.truncated,threads:n.threads||[],notesKey};
    render();
  }catch{showProblem({message:'Litti is not answering. Is it still running?'},true);}
}
// Errors replace every loading placeholder, so the page never sits on "loading…" under an error (USER-9).
let problem=false;
function showProblem(c,offline){
  const live=document.getElementById('live');live.className='live stale';live.textContent=offline?'offline':'not available';
  if(offline&&state.version)return; // keep the last good view; the badge says offline
  if(problem===(c.message||''))return;
  problem=c.message||'';state={version:'',files:[],threads:[]};
  document.getElementById('crumb').textContent=c.code==='not-a-repo'?'not a git repository':'changes unavailable';
  document.getElementById('totals').textContent='';
  document.getElementById('files').replaceChildren(el('div','hint','No files to show.'));
  const box=el('div','empty problem');box.setAttribute('role','alert');
  box.append(el('h2','',c.code==='not-a-repo'?'This folder is not a git repository':'Could not read changes'),el('p','',c.message||'Unknown error.'));
  if(c.folder)box.append(el('p','',''),el('code','',c.folder));
  document.getElementById('main').replaceChildren(box);
  document.getElementById('review').disabled=true;
}
document.getElementById('review').onclick=async()=>{
  const b=document.getElementById('review');b.disabled=true;
  const r=await post('/api/changes/review',{});
  if(r.ok)toast('Sent for review: Tier '+r.tier+'.',r.approvalUrl);else toast(r.message||'Could not request review.');
  b.disabled=false;
};
refresh(true);setInterval(()=>refresh(false),3000);
</script></body></html>`;
}
