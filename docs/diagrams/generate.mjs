// Regenerate: node docs/diagrams/generate.mjs docs/diagrams/litti-system.excalidraw  — open at https://excalidraw.com (File → Open) or the VS Code Excalidraw extension.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const out = process.argv[2];
const els = [];
let n = 0;
const id = (p) => `${p}-${++n}`;
const seed = () => Math.floor(Math.random() * 2 ** 31);
const base = (o) => ({
  angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2,
  strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null,
  seed: seed(), version: 1, versionNonce: seed(), isDeleted: false, boundElements: [], updated: 1, link: null, locked: false, ...o,
});

const C = {
  brass: '#ffec99', ink: '#1e1e1e', red: '#ffc9c9', green: '#b2f2bb', blue: '#a5d8ff', violet: '#d0bfff',
  orange: '#ffd8a8', gray: '#e9ecef', teal: '#96f2d7', pink: '#fcc2d7', white: '#ffffff',
};

function text(x, y, s, { size = 20, color = C.ink, align = 'left', w, family = 2 } = {}) {
  const lines = String(s).split('\n');
  const width = w ?? Math.max(...lines.map(l => l.length)) * size * 0.55;
  const height = lines.length * size * 1.25;
  const t = base({ id: id('t'), type: 'text', x, y, width, height, strokeColor: color, text: s, originalText: s, fontSize: size, fontFamily: family, textAlign: align, verticalAlign: 'top', containerId: null, lineHeight: 1.25, autoResize: true });
  els.push(t);
  return t;
}

/** Rectangle with centred label inside. */
function box(x, y, w, h, label, { bg = C.white, size = 18, stroke = C.ink, dashed = false, bold = false } = {}) {
  const r = base({ id: id('r'), type: 'rectangle', x, y, width: w, height: h, backgroundColor: bg, strokeColor: stroke, roundness: { type: 3 }, strokeStyle: dashed ? 'dashed' : 'solid', strokeWidth: bold ? 3 : 2 });
  const lines = String(label).split('\n');
  // Shrink the font until every line fits inside the box (Excalidraw does not wrap for us).
  const longest = Math.max(...lines.map(l => [...l].length));
  while (size > 10 && (longest * size * 0.66 > w - 24 || lines.length * size * 1.25 > h - 14)) size--;
  const th = lines.length * size * 1.25;
  const t = base({ id: id('t'), type: 'text', x: x + 8, y: y + (h - th) / 2, width: w - 16, height: th, text: label, originalText: label, fontSize: size, fontFamily: 2, textAlign: 'center', verticalAlign: 'middle', containerId: r.id, lineHeight: 1.25, autoResize: true });
  r.boundElements.push({ type: 'text', id: t.id });
  els.push(r, t);
  return r;
}

/** Big background zone with a title. */
function zone(x, y, w, h, title, bg) {
  const r = base({ id: id('z'), type: 'rectangle', x, y, width: w, height: h, backgroundColor: bg, fillStyle: 'solid', strokeStyle: 'dashed', strokeColor: '#868e96', roundness: { type: 3 }, opacity: 60 });
  els.push(r);
  text(x + 16, y + 10, title, { size: 18, color: '#495057' });
  return r;
}

const cx = (b) => b.x + b.width / 2, cy = (b) => b.y + b.height / 2;
/** Arrow between two boxes (edge to edge), optional label and style. */
function arrow(a, b, label, { dashed = false, color = C.ink, both = false, side } = {}) {
  let x1, y1, x2, y2;
  const horiz = side ? side === 'h' : Math.abs(cx(a) - cx(b)) > Math.abs(cy(a) - cy(b));
  if (horiz) {
    const right = cx(b) > cx(a);
    x1 = right ? a.x + a.width : a.x; y1 = cy(a);
    x2 = right ? b.x : b.x + b.width; y2 = cy(b);
  } else {
    const down = cy(b) > cy(a);
    x1 = cx(a); y1 = down ? a.y + a.height : a.y;
    x2 = cx(b); y2 = down ? b.y : b.y + b.height;
  }
  const ar = base({
    id: id('a'), type: 'arrow', x: x1, y: y1, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
    strokeColor: color, strokeStyle: dashed ? 'dashed' : 'solid', roundness: { type: 2 },
    points: [[0, 0], [x2 - x1, y2 - y1]], lastCommittedPoint: null,
    startBinding: null, endBinding: null,
    startArrowhead: both ? 'arrow' : null, endArrowhead: 'arrow', elbowed: false,
  });


  els.push(ar);
  if (label) {
    const lx = (x1 + x2) / 2, ly = (y1 + y2) / 2;
    text(horiz ? lx - label.length * 3.3 : lx + 8, horiz ? ly - 24 : ly - 8, label, { size: 13, color: '#495057' });
  }
  return ar;
}

// ─────────────────────────────── BOARD 1: SECURITY ───────────────────────────────
let X = 0, Y = 0;
text(X, Y, '1 · How Litti keeps users safe', { size: 34 });
text(X, Y + 46, 'Every risky agent action passes these gates. 🔒 = security control.  Dashed = trust boundary.', { size: 16, color: '#495057' });

const zA = zone(X, Y + 90, 330, 600, "Developer's machine (untrusted agent)", C.gray);
const agent = box(X + 30, Y + 140, 270, 70, 'AI coding agent\nClaude Code · Codex · OpenCode', { bg: C.white });
const hook = box(X + 30, Y + 260, 270, 110, 'Litti hook (PreToolUse)\n🔒 classify command\n🔒 deny at once · fail CLOSED', { bg: C.orange });
const cli = box(X + 30, Y + 420, 270, 70, 'litti CLI / HTTP API\n🔒 x-litti-key per agent', { bg: C.white });
const diffbox = box(X + 30, Y + 540, 270, 110, 'What gets reviewed\ncommand + working-tree diff\n(SHA-256 diff hash)', { bg: C.white });
arrow(agent, hook, 'git push / deploy / rm -rf');
arrow(hook, cli, '');
arrow(cli, diffbox, '');

const zB = zone(X + 380, Y + 90, 760, 600, 'Litti server (trusted) · Node + Fastify + SQLite', '#fff9db');
const gate = box(X + 410, Y + 140, 220, 90, 'Gate API\n🔒 API key · 512 KB cap\n🔒 dedupe by diff hash', { bg: C.brass });
const tier = box(X + 670, Y + 140, 220, 90, 'Risk tiering 0–3\n🔒 rules, no AI\n🔒 rubber-stamp bump', { bg: C.brass });
const chal = box(X + 910, Y + 140, 210, 90, 'Comprehension check\n6 kinds, varied\n🔒 answer kept server-side', { bg: C.brass });
const page = box(X + 410, Y + 290, 300, 150, 'Review page\n🔒 identity: SSO header / signed\n    ticket / typed (demo only)\n🔒 server-measured time (signed stamp)\n🔒 scroll · requester ≠ approver\n🔒 CSP · no-store · x-frame DENY', { bg: C.white, size: 15 });
const rs = box(X + 760, Y + 290, 360, 150, 'Rubber-stamp detector\n🔒 wrong / too fast → BLOCKED\n🔒 all reviews reset\n🔒 next action tier +1 (persisted)\n🔒 team notified', { bg: C.red, size: 16 });
const token = box(X + 410, Y + 500, 300, 160, 'Approval token (format v2)\n🔒 HMAC-SHA256 signs action id,\n    diff hash, approvers, time\n🔒 bound to exact diff\n🔒 single use (deliver + ship)', { bg: C.green, size: 15 });
const chain = box(X + 760, Y + 500, 360, 160, 'Receipt chain (format v2)\n🔒 hash links every decision\n🔒 covers tier, approvals, time\n🔒 litti verify finds first broken link\n🔒 evidence API needs key / SSO', { bg: C.green, size: 15 });
arrow(diffbox, gate, 'POST /api/gate', { side: 'h' });
arrow(gate, tier, '');
arrow(tier, chal, '');
arrow(chal, page, 'link', { side: 'v' });
arrow(page, rs, 'submit');
arrow(page, token, 'N reviewers passed');
arrow(token, chain, '');

const zC = zone(X + 1190, Y + 90, 380, 600, 'Outside world', C.gray);
const reviewer = box(X + 1220, Y + 130, 320, 90, '👩‍💻 Human reviewer(s)\nclick the link → open the review page\nsigned in via SSO proxy (prod)', { bg: C.white });
const notif = box(X + 1220, Y + 250, 320, 130, 'Slack · Discord · Jira\n🔒 metadata only — never code\n🔒 tokens AES-256-GCM at rest\n🔒 no approving from chat\n🔒 mentions/markup escaped', { bg: C.blue, size: 15 });
const broker = box(X + 1220, Y + 420, 320, 110, 'Litti Connect (hosted)\n🔒 stateless · signed OAuth state\n🔒 returns only to loopback /\n    approved origins', { bg: C.violet, size: 15 });
const ci = box(X + 1220, Y + 570, 320, 90, 'Your CI/CD\n🔒 signed webhook (HMAC)\n🔒 /api/tokens/consume once', { bg: C.white, size: 15 });
arrow(chal, notif, 'card + link', { dashed: true });
arrow(notif, reviewer, 'link', { dashed: true, side: 'v' });
arrow(notif, broker, 'one-click OAuth', { dashed: true, both: true });
arrow(chain, ci, 'token + signed webhook', { dashed: true, side: 'h' });

// ─────────────────────────────── BOARD 2: STACK ───────────────────────────────
X = 0; Y = 800;
text(X, Y, '2 · Tech stack', { size: 34 });
text(X, Y + 46, 'Small, boring, auditable. One process + one SQLite file. No AI in the trust path.', { size: 16, color: '#495057' });
const cols = [
  ['Runtime', C.brass, ['Node.js 20.10+', 'TypeScript (strict)', 'ESM modules', 'npm package: litti (bin: litti)']],
  ['Server', C.orange, ['Fastify 5', 'better-sqlite3 (WAL)', 'dotenv · open', 'Docker (2-stage) · Render']],
  ['Security', C.green, ['Node crypto only', 'HMAC-SHA256 tokens/stamps', 'AES-256-GCM secrets', 'SHA-256 hash chain']],
  ['UI', C.blue, ['Plain HTML/CSS/JS', 'No framework, no build', 'Inbox · Review · Changes', 'Integrations · Docs · Dashboard']],
  ['Integrations', C.violet, ['Claude Code / Codex hooks', 'OpenCode plugin', 'Slack · Discord · Jira APIs', 'OAuth via Litti Connect']],
  ['Quality', C.teal, ['tsx test suites (12)', '~120 checks', 'GitHub Actions CI', 'Node 20 + 22']],
];
cols.forEach(([title, bg, items], i) => {
  const cx0 = X + i * 260;
  box(cx0, Y + 90, 240, 56, title, { bg, size: 22, bold: true });
  items.forEach((it, j) => box(cx0, Y + 160 + j * 66, 240, 54, it, { bg: C.white, size: 15 }));
});

// ─────────────────────────────── BOARD 3: SWARM ORG ───────────────────────────────
X = 0; Y = 1290;
text(X, Y, '3 · Agent swarm (proposed) — who does what', { size: 34 });
text(X, Y + 46, 'You set goals and approve. The CEO agent plans, assigns, decides and reports. Specialists only talk through the CEO + shared memory.', { size: 16, color: '#495057' });
const you = box(X + 560, Y + 100, 340, 80, '👤 YOU (founder)\nsets goals · approves plans · merges', { bg: C.pink, bold: true });
const ceo = box(X + 560, Y + 240, 340, 110, '🧭 CEO agent (orchestrator)\nmain Claude Code session\nplans · assigns · triages · decides\nkeeps board + decision log', { bg: C.brass, bold: true, size: 16 });
arrow(you, ceo, 'goals / approval', { both: true });
const sec = box(X + 0, Y + 430, 330, 170, '🛡️ Security Auditor\nREAD-ONLY\nthreat model · OWASP · auth/CSRF/\nSSRF/crypto/injection · supply chain\n→ findings w/ severity + repro', { bg: C.red, size: 15 });
const slop = box(X + 370, Y + 430, 330, 170, '🧹 Slop Hunter\nREAD-ONLY\ndead code · duplication · AI-slop\nwording · misleading docs ·\nover-engineering · naming\n→ findings w/ file:line', { bg: C.orange, size: 15 });
const user = box(X + 740, Y + 430, 330, 170, '🧪 Real-User Tester\ninstalls from npm tarball in sandbox\nfollows docs like a newcomer\ndrives browser + Claude hook\n→ friction + bugs w/ steps', { bg: C.blue, size: 15 });
const dev = box(X + 1110, Y + 430, 330, 170, '🛠️ Developer\nWRITE (own git worktree)\nfixes approved findings + tests\nnpm test must pass\ncommits gated by Litti itself', { bg: C.green, size: 15 });
[sec, slop, user, dev].forEach(a => arrow(ceo, a, '', { both: true, side: 'v' }));
const mem = box(X + 260, Y + 680, 940, 140, '🧠 Shared memory  (.swarm/ in the repo, git-ignored)\nboard.md — tasks, owner, status       decisions.md — every decision: who, why, alternatives\nmemory/<agent>.md — each agent\'s context, findings, decisions, open questions (survives sessions)\nreports/<run>/<agent>.md — raw output of each run', { bg: C.teal, size: 15, dashed: true });
[sec, slop, user, dev].forEach(a => arrow(a, mem, '', { dashed: true, both: true, side: 'v' }));
arrow(ceo, mem, '', { dashed: true, both: true, side: 'v' });

// ─────────────────────────────── BOARD 4: WORKFLOW ───────────────────────────────
X = 0; Y = 2200;
text(X, Y, '4 · One swarm run — step by step', { size: 34 });
text(X, Y + 46, 'Read-only agents run in parallel. Nothing changes until YOU approve the plan. Every code change still goes through Litti review.', { size: 16, color: '#495057' });
const steps = [
  ['1 Discover', 'Auditor, Slop Hunter\nand Tester run in\nparallel (read-only)', C.gray],
  ['2 Triage', 'CEO merges findings,\nranks by severity,\nlogs decisions', C.brass],
  ['3 YOU approve', 'review the plan:\ncut, reorder, add', C.pink],
  ['4 Build', 'Developer fixes in\na worktree, tests\neach fix, gated commits', C.green],
  ['5 Re-verify', 'Auditor + Tester\ncheck every fix\nfor regressions', C.blue],
  ['6 Release', 'CEO report,\nyou merge,\nnpm publish + push', C.violet],
];
let prev = null;
steps.forEach(([t, d, bg], i) => {
  const b = box(X + i * 265, Y + 100, 235, 170, `${t}\n\n${d}`, { bg, size: 17, bold: i === 2 });
  if (prev) arrow(prev, b, '');
  prev = b;
});
text(X, Y + 300, 'Loop: findings that fail re-verify go back to step 4 (max 2 rounds, then the CEO escalates to you).', { size: 15, color: '#495057' });

const doc = { type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: els, appState: { gridSize: 20, viewBackgroundColor: '#ffffff' }, files: {} };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`wrote ${out} (${els.length} elements)`);
