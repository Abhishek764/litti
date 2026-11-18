/**
 * Integrations page: Connect buttons for Slack, Discord and Jira, with the one-time
 * setup explained step by step (copy buttons for every value you need to paste).
 * Plain HTML + inline JS. Dynamic text goes through textContent.
 * NOTE: this script sits in a template string — avoid backslashes in it.
 */
export function renderIntegrationsPage(): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Litti — Integrations</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta name="theme-color" content="#0A0D12">
<style>
:root{--bg:#0d1117;--surface:#161b22;--raised:#1c2230;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--green:#3fb950;--red:#f85149;--yellow:#d29922;--blue:#58a6ff;--brass:#F5B942;
--mono:'SF Mono','Cascadia Code',Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.5}
header{display:flex;align-items:center;gap:16px;padding:14px 24px;border-bottom:1px solid var(--border);background:#0a0d12;flex-wrap:wrap}
header img{height:28px;display:block}header nav a{color:var(--muted);text-decoration:none;margin-right:14px;font-size:14px}header nav a:hover{color:var(--text)}
.wrap{max-width:860px;margin:0 auto;padding:28px 16px 80px}
h1{font-size:22px;margin:0 0 6px}.sub{color:var(--muted);margin:0 0 24px}
.banner{border-radius:8px;padding:12px 16px;margin-bottom:18px;display:none}.banner.ok{background:#12331f;border:1px solid var(--green)}.banner.bad{background:#3a1a1a;border:1px solid var(--red)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:18px}
.top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.logo{width:36px;height:36px;border-radius:8px;display:grid;place-items:center;font-weight:800;font-size:18px}
.top h2{margin:0;font-size:18px;flex:1}.pill{font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px}
.pill.on{background:#12331f;color:var(--green)}.pill.off{background:var(--raised);color:var(--muted)}
.what{color:var(--muted);font-size:14px;margin:8px 0 14px}
button,.btn{font:inherit;font-size:14px;cursor:pointer;border-radius:8px;border:1px solid var(--border);background:var(--raised);color:var(--text);padding:8px 14px;text-decoration:none;display:inline-block}
button.primary,.btn.primary{background:var(--brass);border-color:var(--brass);color:#0a0d12;font-weight:700}
button.danger{color:var(--red)}button:disabled{opacity:.5;cursor:not-allowed}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
input,select{font:inherit;font-size:14px;background:#0a0d12;color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 10px;min-width:0;flex:1}
details{border:1px solid var(--border);border-radius:10px;margin-top:12px;background:var(--bg)}
summary{cursor:pointer;padding:12px 14px;font-weight:600}summary .tag{font-weight:400;color:var(--muted);font-size:13px;margin-left:6px}
.steps{padding:0 14px 14px}.steps ol{margin:0;padding-left:20px}.steps li{margin:8px 0}
code,.copy{font-family:var(--mono);font-size:13px}.copy{display:inline-flex;align-items:center;gap:6px;background:#0a0d12;border:1px solid var(--border);border-radius:6px;padding:3px 4px 3px 8px;max-width:100%;overflow:hidden}
.copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.copy button{padding:2px 8px;font-size:12px}
.facts{font-size:14px;color:var(--muted);margin-top:6px}.facts b{color:var(--text);font-weight:600}
.msg{font-size:14px;margin-top:8px;min-height:1px}.msg.ok{color:var(--green)}.msg.bad{color:var(--red)}
.warn{color:var(--yellow);font-size:13px;margin-top:8px}
.big{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:6px 0 4px}
.bigbtn{font-size:16px;padding:12px 22px;border-radius:10px}
details.more{border:0;background:none;margin-top:14px}details.more>summary{color:var(--muted);font-weight:500;font-size:14px;padding:6px 0}
details.more details{margin-top:10px}
a{color:var(--blue)}
</style></head><body>
<header><a href="/"><img src="/brand/litti-logo.svg" alt="Litti"></a><nav><a href="/">Inbox</a><a href="/changes">Changes</a><a href="/integrations" style="color:var(--text)">Integrations</a><a href="/dashboard.html">Dashboard</a><a href="/docs">Docs</a></nav></header>
<div class="wrap">
<h1>Integrations</h1>
<p class="sub">Connect where your team hears about approvals. Reviewers still approve on the Litti review page, never in chat. Only metadata is sent; your code never leaves this server.</p>
<div class="banner" id="banner"></div>
<div id="cards">Loading…</div>
</div>
<script>
const H={'content-type':'application/json','x-litti-ui':'1'};
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e;};
const post=async(u,b)=>{try{const r=await fetch(u,{method:'POST',headers:H,body:JSON.stringify(b||{})});return await r.json();}catch(e){return{ok:false,message:'Network error.'};}};
function copyBox(v){const b=el('span','copy');b.append(el('span','',v));const c=el('button','','Copy');c.onclick=()=>{navigator.clipboard.writeText(v).then(()=>{c.textContent='Copied';setTimeout(()=>c.textContent='Copy',1500);}).catch(()=>{c.textContent='Select and copy';});};b.append(c);return b;}
function li(parts){const l=el('li');for(const p of parts)l.append(typeof p==='string'?document.createTextNode(p):p);return l;}
function link(href,text){const a=el('a','',text);a.href=href;a.target='_blank';a.rel='noopener';return a;}
function msgLine(){return el('div','msg');}
function show(m,r){m.className='msg '+(r.ok?'ok':'bad');m.textContent=r.message||(r.ok?'Done.':'Something went wrong.');}

const META={
  slack:{name:'Slack',color:'#4A154B',letter:'S',what:'Approval cards in a channel with a Review button. Reviews, warnings and results arrive as thread replies.'},
  discord:{name:'Discord',color:'#5865F2',letter:'D',what:'Colour-coded approval cards in a channel, updated when the action is approved.'},
  jira:{name:'Jira',color:'#0052CC',letter:'J',what:'A Jira issue for every risky action, with a comment for every review step, closed on approval.'},
};

function appForm(p,s,after){
  const box=el('div','');
  const f=el('div','row');const id=el('input');id.placeholder='Client ID';const sec=el('input');sec.placeholder='Client Secret';sec.type='password';
  const save=el('button','primary','Save');const m=msgLine();
  save.onclick=async()=>{save.disabled=true;const r=await post('/api/integrations/'+p+'/app',{clientId:id.value,clientSecret:sec.value});show(m,r);save.disabled=false;if(r.ok)load();};
  f.append(id,sec,save);box.append(f,m);
  if(s.appSource==='env'){box.textContent='';box.append(el('div','facts','App credentials come from .env.'));}
  return box;
}

function connectBtn(p,s){const a=el('a','btn primary','Connect '+META[p].name);a.href='/connect/'+p;if(!s.appReady){a.removeAttribute('href');a.className='btn';a.style.opacity='.5';a.title='Finish the one-time setup first';}return a;}

function slackGuide(s,info){
  const d=el('details');d.open=false;
  const sm=el('summary','','Use your own Slack app');sm.append(el('span','tag','advanced'));d.append(sm);
  const st=el('div','steps');const ol=el('ol');
  const manifest={display_information:{name:'Litti'},features:{bot_user:{display_name:'Litti',always_online:true}},oauth_config:{redirect_urls:[info.redirectUris.slack],scopes:{bot:['chat:write','incoming-webhook']}},settings:{org_deploy_enabled:false,socket_mode_enabled:false,token_rotation_enabled:false}};
  const create='https://api.slack.com/apps?new_app=1&manifest_json='+encodeURIComponent(JSON.stringify(manifest));
  ol.append(
    li(['Create the app (pre-filled for you): ',link(create,'Create Litti app in Slack ↗'),'. Pick your workspace, click Next, then Create. If the form comes up empty, choose “From scratch” and add the redirect URL and scopes below.']),
    li(['Redirect URL (already filled in if you used the button): ',copyBox(info.redirectUris.slack)]),
    li(['Bot scopes: ',copyBox('chat:write'),' ',copyBox('incoming-webhook')]),
    li(['On the app’s Basic Information page, copy Client ID and Client Secret here:']),
  );
  st.append(ol,appForm('slack',s));
  if(!info.https)st.append(el('div','warn','Slack only sends people back to https addresses. Run Litti behind https (set PUBLIC_URL), or use the quick option below for now.'));
  const r=el('div','row');r.append(connectBtn('slack',s),el('span','facts','You’ll pick the channel on Slack’s page.'));st.append(r);d.append(st);return d;
}
function discordGuide(s,info){
  const d=el('details');d.open=false;
  const sm=el('summary','','Use your own Discord app');sm.append(el('span','tag','advanced'));d.append(sm);
  const st=el('div','steps');const ol=el('ol');
  ol.append(
    li(['Open the ',link('https://discord.com/developers/applications','Discord Developer Portal ↗'),' → New Application → name it Litti.']),
    li(['OAuth2 → Redirects → Add Redirect → paste: ',copyBox(info.redirectUris.discord),' → Save Changes.']),
    li(['On the same OAuth2 page copy Client ID, click Reset Secret and copy the Client Secret, then paste both here:']),
  );
  st.append(ol,appForm('discord',s));const r=el('div','row');r.append(connectBtn('discord',s));st.append(r);d.append(st);return d;
}
function jiraGuide(s,info){
  const d=el('details');d.open=false;
  const sm=el('summary','','Use your own Atlassian app');sm.append(el('span','tag','advanced'));d.append(sm);
  const st=el('div','steps');const ol=el('ol');
  ol.append(
    li(['Open the ',link('https://developer.atlassian.com/console/myapps/','Atlassian developer console ↗'),' → Create → OAuth 2.0 integration → name it Litti → agree → Create.']),
    li(['Permissions → Jira API → Add, then Configure → Edit Scopes → tick ',copyBox('read:jira-work'),' ',copyBox('write:jira-work'),' ',copyBox('read:jira-user'),' → Save.']),
    li(['Authorization → OAuth 2.0 (3LO) → Configure → Callback URL: ',copyBox(info.redirectUris.jira),' → Save changes.']),
    li(['Settings → copy Client ID and Secret, paste them here:']),
  );
  st.append(ol,appForm('jira',s));d.append(st);return d;
}
function quick(p,label,steps,placeholder){
  const d=el('details');const sm=el('summary','',label);sm.append(el('span','tag','fastest · no app needed'));d.append(sm);
  const st=el('div','steps');const ol=el('ol');for(const s of steps)ol.append(li(s));st.append(ol);
  const r=el('div','row');const inp=el('input');inp.placeholder=placeholder;const b=el('button','primary','Connect');const m=msgLine();
  b.onclick=async()=>{b.disabled=true;const res=await post('/api/integrations/'+p+'/webhook',{url:inp.value.trim()});show(m,res);b.disabled=false;if(res.ok)load();};
  r.append(inp,b);st.append(r,m);d.append(st);return d;
}

async function jiraProjectPicker(s,box){
  const r=el('div','row');const sel=el('select');sel.append(el('option','','Loading projects…'));
  const tier=el('select');[['1','Every reviewed action (Tier 1+)'],['2','High risk only (Tier 2+)'],['3','Critical only (Tier 3)']].forEach(([v,t])=>{const o=el('option','',t);o.value=v;tier.append(o);});tier.value=String(s.details.minTier||2);
  const done=el('input');done.placeholder='Move issue on approval to… (e.g. Done, optional)';done.value=s.details.doneTransition||'';
  const save=el('button','primary','Save');const m=msgLine();
  r.append(sel,tier);const r2=el('div','row');r2.append(done,save);box.append(el('div','facts','Create issues in:'),r,r2,m);
  const res=await fetch('/api/integrations/jira/projects').then(x=>x.json()).catch(()=>({ok:false}));
  sel.textContent='';
  if(!res.ok||!res.projects.length){sel.append(el('option','',res.ok?'No projects you can create issues in':'Could not load projects'));return;}
  for(const p of res.projects){const o=el('option','',p.name+' ('+p.key+')');o.value=p.key;o.dataset.name=p.name;sel.append(o);}
  if(s.details.projectKey)sel.value=s.details.projectKey;
  save.onclick=async()=>{const o=sel.selectedOptions[0];const r=await post('/api/integrations/jira/settings',{projectKey:sel.value,projectName:o&&o.dataset.name,minTier:Number(tier.value),doneTransition:done.value});show(m,r.ok?{ok:true,message:'Saved. New risky actions will open issues in '+sel.value+'.'}:r);if(r.ok)setTimeout(load,1200);};
}

function card(p,s,info){
  const c=el('section','card');const meta=META[p];
  const top=el('div','top');const logo=el('div','logo',meta.letter);logo.style.background=meta.color;
  top.append(logo,el('h2','',meta.name),el('span','pill '+(s.connected?'on':'off'),s.connected?'Connected':'Not connected'));
  c.append(top,el('div','what',meta.what));
  if(s.connected){
    const d=s.details||{};const f=el('div','facts');
    const add=(k,v)=>{if(v){f.append(el('b','',k+': '),document.createTextNode(String(v)+'   '));}};
    add('How',d.how);add('Workspace',d.team);add('Channel',d.channel?'#'+d.channel:null);add('Server',d.server);add('Site',d.site);add('Project',d.projectKey?(d.projectName||d.projectKey)+' ('+d.projectKey+')':null);
    add('Connected by',d.connectedBy);c.append(f);
    if(p==='jira')jiraProjectPicker(s,c);
    const r=el('div','row');const t=el('button','','Send test');const x=el('button','danger','Disconnect');const m=msgLine();
    t.onclick=async()=>{t.disabled=true;show(m,await post('/api/integrations/'+p+'/test'));t.disabled=false;};
    x.onclick=async()=>{x.disabled=true;await post('/api/integrations/'+p+'/disconnect');load();};
    r.append(t,x);c.append(r,m);
    if(p==='jira'&&!d.projectKey)c.append(el('div','warn','Pick a project and Save to start creating issues.'));
    return c;
  }
  // One button. The provider asks you to pick the workspace/channel/project, then you're back here.
  const big=el('div','big');
  if(s.oneClick){
    const a=el('a','btn primary bigbtn','Connect '+meta.name);a.href='/connect/'+p;
    big.append(a,el('span','facts',{slack:'Pick your workspace and channel on Slack, click Allow. Done.',discord:'Pick your server and channel on Discord, click Authorize. Done.',jira:'Sign in to Atlassian, pick your site, click Accept. Done.'}[p]));
  }else{
    const b=el('button','bigbtn','Connect '+meta.name);b.disabled=true;
    big.append(b,el('span','facts','One-click connect isn’t switched on for this Litti. Use “Other ways to connect” below.'));
  }
  c.append(big);
  const more=el('details','more');more.append(el('summary','','Other ways to connect'));
  const inner=el('div','');more.append(inner);
  if(p==='slack'){
    inner.append(quick('slack','Paste a Slack webhook link',[
      ['Go to ',link('https://api.slack.com/apps?new_app=1','Slack apps ↗'),' → Create New App → From scratch → name it Litti, pick your workspace.'],
      ['Incoming Webhooks → switch On → Add New Webhook to Workspace → pick the channel → Allow.'],
      ['Copy the Webhook URL and paste it here.'],
    ],'https://hooks.slack.com/services/...'));
    inner.append(slackGuide(s,info));
  }
  if(p==='discord'){
    inner.append(quick('discord','Paste a Discord webhook link',[
      ['In Discord, open the channel’s settings (gear icon) → Integrations → Webhooks → New Webhook.'],
      ['Click the webhook, then Copy Webhook URL, and paste it here.'],
    ],'https://discord.com/api/webhooks/...'));
    inner.append(discordGuide(s,info));
  }
  if(p==='jira'){
    inner.append(jiraGuide(s,info));
    const r=el('div','row');r.append(connectBtn('jira',s),el('span','facts','Uses your own Atlassian app.'));inner.append(r);
  }
  if(!s.oneClick)more.open=true;
  c.append(more);
  return c;
}

async function load(){
  const box=document.getElementById('cards');
  const info=await fetch('/api/integrations').then(r=>r.json()).catch(()=>null);
  if(!info||!info.ok){box.textContent=(info&&info.message)||'Could not load integrations.';return;}
  box.textContent='';
  for(const p of ['slack','discord','jira'])box.append(card(p,info.providers[p],info));
}
const q=new URLSearchParams(location.search);const b=document.getElementById('banner');
if(q.get('connected')){b.className='banner ok';b.style.display='block';b.textContent='✅ '+(META[q.get('connected')]||{name:'Integration'}).name+' connected. Click “Send test” to check it.';}
if(q.get('error')){b.className='banner bad';b.style.display='block';b.textContent='Could not connect: '+q.get('error');}
if(q.get('connected')||q.get('error'))history.replaceState(null,'','/integrations');
load();
</script></body></html>`;
}
