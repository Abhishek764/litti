/**
 * Docs site at /docs: renders docs/guide/*.md with sidebar, "On this page",
 * search, copy buttons and previous/next links. Plain HTML + inline CSS/JS.
 * NOTE: the inline script sits in a template string — avoid backslashes in it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { render, type Heading } from './markdown.js';

const GUIDE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'guide');
const REPO = 'https://github.com/Abhishek764/litti';

export const NAV: Array<{ group: string; pages: Array<{ slug: string; title: string }> }> = [
  { group: '', pages: [{ slug: 'index', title: 'Introduction' }] },
  { group: 'Getting started', pages: [
    { slug: 'install', title: 'Install Litti' },
    { slug: 'first-review', title: 'Lesson 1: your first review' },
    { slug: 'connect-agent', title: 'Lesson 2: gate your coding agent' },
    { slug: 'changes', title: 'Lesson 3: talk it through' },
    { slug: 'connect-team', title: 'Lesson 4: Slack, Discord, Jira' },
  ] },
  { group: 'Concepts', pages: [
    { slug: 'how-it-works', title: 'How Litti works' },
    { slug: 'risk-tiers', title: 'Risk tiers' },
    { slug: 'checks', title: 'Comprehension checks' },
    { slug: 'receipts', title: 'Tokens and receipts' },
  ] },
  { group: 'Operate', pages: [
    { slug: 'team-setup', title: 'Run Litti for your team' },
    { slug: 'troubleshooting', title: 'Troubleshooting' },
  ] },
  { group: 'Reference', pages: [
    { slug: 'cli', title: 'CLI' },
    { slug: 'api', title: 'HTTP API' },
    { slug: 'config', title: 'Configuration' },
  ] },
];
export const ORDER = NAV.flatMap(g => g.pages);

interface Page { slug: string; title: string; html: string; headings: Heading[]; text: string }
const cache = new Map<string, { md: string; page: Page }>();

export function loadPage(slug: string, dir = GUIDE_DIR): Page | null {
  if (!ORDER.some(p => p.slug === slug)) return null; // only known pages: no path traversal
  const file = join(dir, `${slug}.md`);
  if (!existsSync(file)) return null;
  const md = readFileSync(file, 'utf8');
  const hit = cache.get(slug);
  if (hit && hit.md === md) return hit.page;
  const r = render(md);
  const text = md.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*`|[\]()_-]/g, ' ').replace(/\s+/g, ' ').trim();
  const page = { slug, title: r.title || ORDER.find(p => p.slug === slug)!.title, html: r.html, headings: r.headings, text };
  cache.set(slug, { md, page });
  return page;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/**
 * Where links point. In the app (default) docs live at /docs/<slug>. For the static site
 * (scripts/build-site.ts) pass `base`, e.g. '/litti/': pages become <base>docs/<slug>/ and
 * every root-relative link (logo, favicon, markdown links) is prefixed with the base.
 */
export interface RenderOptions { base?: string }
const normBase = (b?: string) => (b ? (b.endsWith('/') ? b : b + '/') : '');
function linker(opts: RenderOptions = {}) {
  const base = normBase(opts.base);
  const url = (slug: string) => (!base ? (slug === 'index' ? '/docs' : `/docs/${slug}`) : (slug === 'index' ? `${base}docs/` : `${base}docs/${slug}/`));
  const abs = (path: string) => (base ? base + path.replace(/^\//, '') : path);
  /** Rewrites root-relative hrefs/srcs inside rendered markdown for the static site. */
  const rewrite = (html: string) => !base ? html : html.replace(/(href|src)="\/(?!\/)([^"]*)"/g, (_m, attr: string, rest: string) => {
    const d = /^docs(?:\/([a-z0-9-]+))?(#[^"]*)?$/.exec(rest);
    if (d) return `${attr}="${url(d[1] ?? 'index')}${d[2] ?? ''}"`;
    return `${attr}="${base}${rest}"`;
  });
  return { url, abs, rewrite };
}

function searchIndex(url: (slug: string) => string): string {
  const idx = ORDER.map(p => {
    const page = loadPage(p.slug);
    return { u: url(p.slug), t: p.title, h: page?.headings.filter(h => h.level <= 3).map(h => [h.text.replace(/[`*]/g, ''), h.id]) ?? [], x: (page?.text ?? '').slice(0, 4000).toLowerCase() };
  });
  // Safe inside <script>: no "</" sequences survive.
  return JSON.stringify(idx).replace(/</g, '\\u003c');
}

export function renderDocsPage(page: Page, opts: RenderOptions = {}): string {
  const { url, abs, rewrite } = linker(opts);
  const at = ORDER.findIndex(p => p.slug === page.slug);
  const prev = ORDER[at - 1];
  const next = ORDER[at + 1];
  const side = NAV.map(g => `<div class="grp">${g.group ? `<div class="gt">${esc(g.group)}</div>` : ''}${g.pages.map(p =>
    `<a href="${url(p.slug)}"${p.slug === page.slug ? ' class="on" aria-current="page"' : ''}>${esc(p.title)}</a>`).join('')}</div>`).join('');
  const toc = page.headings.filter(h => h.level <= 3).map(h => `<a class="l${h.level}" href="#${h.id}">${esc(h.text.replace(/[`*]/g, ''))}</a>`).join('');

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title)} · Litti docs</title>
<meta name="description" content="Litti documentation: ${esc(page.title)}">
<link rel="icon" href="${abs('/favicon.svg')}" type="image/svg+xml">
<style>
:root{--bg:#f7f5f0;--surface:#fff;--border:#e4e0d6;--text:#1a1d23;--muted:#5f6670;--accent:#a8700a;--brass:#F5B942;--code:#f1eee6;--link:#8a5a00;
--mono:'SF Mono','Cascadia Code',Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0a0d12;--surface:#11151c;--border:#262c36;--text:#e6edf3;--muted:#8b949e;--accent:#F5B942;--code:#161b22;--link:#F5B942}}
:root[data-theme=dark]{--bg:#0a0d12;--surface:#11151c;--border:#262c36;--text:#e6edf3;--muted:#8b949e;--accent:#F5B942;--code:#161b22;--link:#F5B942}
*{box-sizing:border-box}html{scroll-padding-top:72px}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:16px;line-height:1.65}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;padding:10px 20px;background:var(--bg);border-bottom:1px solid var(--border)}
header .brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);font-weight:700}
header .brand img{height:24px}header .brand span{color:var(--muted);font-weight:500}
.search{position:relative;flex:1;max-width:420px;margin-left:12px}
.search input{width:100%;font:inherit;font-size:14px;padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text)}
.results{position:absolute;top:40px;left:0;right:0;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.18);display:none;max-height:60vh;overflow:auto}
.results a{display:block;padding:8px 12px;text-decoration:none;color:var(--text);font-size:14px;border-bottom:1px solid var(--border)}
.results a small{display:block;color:var(--muted)}.results a:hover,.results a.sel{background:var(--code)}
header nav{margin-left:auto;display:flex;gap:16px;align-items:center;font-size:14px}
header nav a{color:var(--muted);text-decoration:none}header nav a:hover{color:var(--text)}
header button{font:inherit;font-size:13px;background:none;border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:4px 8px;cursor:pointer}
.layout{display:grid;grid-template-columns:250px minmax(0,1fr) 210px;gap:40px;max-width:1280px;margin:0 auto;padding:0 20px}
aside.side{position:sticky;top:56px;align-self:start;max-height:calc(100vh - 56px);overflow:auto;padding:24px 0}
.grp{margin-bottom:18px}.gt{font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);margin:0 0 6px 10px}
aside.side a{display:block;padding:5px 10px;border-radius:6px;color:var(--text);text-decoration:none;font-size:14.5px}
aside.side a:hover{background:var(--code)}aside.side a.on{background:var(--code);color:var(--accent);font-weight:600}
main{padding:32px 0 80px;min-width:0}
main h1{font-size:34px;line-height:1.2;margin:0 0 12px;letter-spacing:-.5px}
main h2{font-size:23px;margin:40px 0 10px;padding-top:6px;letter-spacing:-.2px}main h3{font-size:18px;margin:28px 0 8px}main h4{font-size:16px;margin:22px 0 6px}
.anchor{color:var(--muted);text-decoration:none;margin-left:-20px;width:20px;display:inline-block;opacity:0}h2:hover .anchor,h3:hover .anchor,h4:hover .anchor{opacity:1}
main p,main li{color:var(--text)}main a{color:var(--link)}
code{font-family:var(--mono);font-size:.88em;background:var(--code);padding:1px 5px;border-radius:4px}
.code{position:relative;margin:14px 0}.code pre{margin:0;background:var(--code);border:1px solid var(--border);border-radius:10px;padding:14px 16px;overflow:auto;font-size:13.5px;line-height:1.55}
.code pre code{background:none;padding:0;font-size:inherit}
.code .copy{position:absolute;top:8px;right:8px;font:inherit;font-size:12px;border:1px solid var(--border);background:var(--surface);color:var(--muted);border-radius:6px;padding:2px 8px;cursor:pointer;opacity:.0;transition:opacity .15s}
.code:hover .copy,.code .copy:focus{opacity:1}
.table{overflow-x:auto;margin:14px 0}table{border-collapse:collapse;width:100%;font-size:14.5px}
th,td{border-bottom:1px solid var(--border);padding:8px 10px;text-align:left;vertical-align:top}th{font-weight:600;color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.4px}
blockquote{margin:16px 0;padding:10px 16px;border-left:3px solid var(--brass);background:var(--code);border-radius:0 8px 8px 0}
.pn{display:flex;gap:12px;margin-top:48px;border-top:1px solid var(--border);padding-top:20px}
.pn a{flex:1;border:1px solid var(--border);border-radius:10px;padding:12px 16px;text-decoration:none;color:var(--text)}
.pn a small{display:block;color:var(--muted);font-size:12px}.pn a.next{text-align:right}.pn a:hover{border-color:var(--accent)}
.edit{font-size:13px;margin-top:20px;color:var(--muted)}.edit a{color:var(--muted)}
aside.toc{position:sticky;top:56px;align-self:start;padding:32px 0;font-size:13px;max-height:calc(100vh - 56px);overflow:auto}
aside.toc .gt{margin-left:0}aside.toc a{display:block;color:var(--muted);text-decoration:none;padding:3px 0}aside.toc a.l3{padding-left:12px}aside.toc a:hover,aside.toc a.on{color:var(--accent)}
.menu{display:none}
footer{border-top:1px solid var(--border);padding:24px 20px;color:var(--muted);font-size:13px;text-align:center}
@media (max-width:1100px){.layout{grid-template-columns:230px minmax(0,1fr)}aside.toc{display:none}}
@media (max-width:780px){.layout{grid-template-columns:1fr;gap:0}aside.side{position:static;display:none;max-height:none;padding:8px 0;border-bottom:1px solid var(--border)}aside.side.open{display:block}.menu{display:inline-block}header nav a.hide{display:none}main h1{font-size:28px}}
</style></head><body>
<header>
  <button class="menu" id="menu" aria-label="Menu">☰</button>
  <a class="brand" href="${url('index')}"><img src="${abs('/brand/litti-logo.svg')}" alt="Litti"><span>Docs</span></a>
  <div class="search"><input id="q" type="search" placeholder="Search docs…  ( / )" autocomplete="off" aria-label="Search docs"><div class="results" id="res"></div></div>
  <nav><a class="hide" href="${abs('/')}">${opts.base ? 'Home' : 'Open Litti'}</a><a class="hide" href="${REPO}" target="_blank" rel="noopener">GitHub</a><button id="theme" type="button" title="Toggle theme">◐</button></nav>
</header>
<div class="layout">
  <aside class="side" id="side">${side}</aside>
  <main>
    <h1>${esc(page.title)}</h1>
    ${rewrite(page.html)}
    <div class="pn">${prev ? `<a class="prev" href="${url(prev.slug)}"><small>← Previous</small>${esc(prev.title)}</a>` : '<span style="flex:1"></span>'}${next ? `<a class="next" href="${url(next.slug)}"><small>Next →</small>${esc(next.title)}</a>` : '<span style="flex:1"></span>'}</div>
    <div class="edit"><a href="${REPO}/blob/main/docs/guide/${page.slug}.md" target="_blank" rel="noopener">Edit this page on GitHub</a></div>
  </main>
  <aside class="toc">${toc ? `<div class="gt">On this page</div>${toc}` : ''}</aside>
</div>
<footer>Litti · proof that a human read what they approved · <a href="${REPO}" style="color:inherit">MIT licensed</a></footer>
<script>
const IDX=${searchIndex(url)};
document.querySelectorAll('.code .copy').forEach(b=>b.addEventListener('click',()=>{const t=b.parentElement.querySelector('code').textContent;navigator.clipboard.writeText(t).then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1400);}).catch(()=>{b.textContent='Select to copy';});}));
document.getElementById('menu').onclick=()=>document.getElementById('side').classList.toggle('open');
const root=document.documentElement;try{const t=localStorage.getItem('litti-docs-theme');if(t)root.dataset.theme=t;}catch(e){}
document.getElementById('theme').onclick=()=>{const dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;root.dataset.theme=dark?'light':'dark';try{localStorage.setItem('litti-docs-theme',root.dataset.theme);}catch(e){}};
const q=document.getElementById('q'),res=document.getElementById('res');let sel=-1;
function search(v){
  v=v.trim().toLowerCase();res.textContent='';sel=-1;if(!v){res.style.display='none';return;}
  const words=v.split(' ').filter(Boolean);const hits=[];
  for(const p of IDX){
    for(const h of p.h){const t=h[0].toLowerCase();if(words.every(w=>t.includes(w)))hits.push({u:p.u+'#'+h[1],t:h[0],s:p.t,score:3});}
    const pt=p.t.toLowerCase();if(words.every(w=>pt.includes(w)))hits.push({u:p.u,t:p.t,s:'Page',score:4});
    else if(words.every(w=>p.x.includes(w)))hits.push({u:p.u,t:p.t,s:'Mentions “'+v+'”',score:1});
  }
  hits.sort((a,b)=>b.score-a.score);
  for(const h of hits.slice(0,10)){const a=document.createElement('a');a.href=h.u;a.textContent=h.t;const s=document.createElement('small');s.textContent=h.s;a.append(s);res.append(a);}
  if(!hits.length){const a=document.createElement('a');a.textContent='No results';res.append(a);}
  res.style.display='block';
}
q.addEventListener('input',()=>search(q.value));
q.addEventListener('keydown',e=>{const items=[...res.querySelectorAll('a[href]')];if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();sel=Math.max(0,Math.min(items.length-1,sel+(e.key==='ArrowDown'?1:-1)));items.forEach((a,i)=>a.classList.toggle('sel',i===sel));}if(e.key==='Enter'&&items[Math.max(sel,0)])location.href=items[Math.max(sel,0)].href;if(e.key==='Escape'){q.value='';search('');}});
document.addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}});
document.addEventListener('click',e=>{if(!e.target.closest('.search'))res.style.display='none';});
const tocLinks=[...document.querySelectorAll('aside.toc a')];
if(tocLinks.length){const obs=new IntersectionObserver(es=>{for(const en of es)if(en.isIntersecting){tocLinks.forEach(a=>a.classList.toggle('on',a.getAttribute('href')==='#'+en.target.id));}},{rootMargin:'-70px 0px -70% 0px'});document.querySelectorAll('main h2[id],main h3[id]').forEach(h=>obs.observe(h));}
</script></body></html>`;
}

export function registerDocsRoutes(app: FastifyInstance): void {
  const send = (slug: string, reply: any) => {
    const page = loadPage(slug);
    if (!page) {
      reply.code(404).type('text/html').send(renderDocsPage({ slug: 'index', title: 'Page not found', html: '<p>That page doesn’t exist. <a href="/docs">Back to the docs</a>.</p>', headings: [], text: '' }));
      return;
    }
    reply.type('text/html').header('cache-control', 'no-cache').send(renderDocsPage(page));
  };
  app.get('/docs', (_req, reply) => send('index', reply));
  app.get<{ Params: { slug: string } }>('/docs/:slug', (req, reply) => send(req.params.slug === 'index' ? 'index' : req.params.slug, reply));
}
