/**
 * `litti` command line. Talks to a running Litti server over HTTP.
 *
 *   litti propose <file.json | ->        ask for approval (JSON action card)
 *   litti review <id> --as <name>        personal, signed review link for one reviewer
 *   litti status <id>                    approved yet? prints the token once approved
 *   litti pending                        actions waiting for reviewers
 *   litti verify                         check the receipt chain for tampering
 *   litti stats                          reviewer attention scores
 *
 * Settings: LITTI_URL (default http://127.0.0.1:3847), LITTI_API_KEY, LITTI_ADMIN_KEY (review links).
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';

const URL_BASE = (process.env.LITTI_URL || `http://127.0.0.1:${process.env.APPROVAL_SERVER_PORT || 3847}`).replace(/\/$/, '');

const HELP = `litti — proof that a human read what they approved

Usage:
  litti propose <file.json | ->       Ask for approval. JSON: action, description, diff, touchedPaths[]
  litti review <id> --as <name>       Get a personal, signed review link for one reviewer
  litti status <id>                   Show whether an action is approved
  litti pending                       List actions waiting for reviewers
  litti verify                        Check the receipt chain for tampering
  litti stats                         Reviewer attention scores and rubber-stamps

Settings: LITTI_URL (default ${URL_BASE}), LITTI_API_KEY, LITTI_ADMIN_KEY (for review)`;

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (process.env.LITTI_API_KEY) headers['x-litti-key'] = process.env.LITTI_API_KEY;
  if (process.env.LITTI_ADMIN_KEY) headers['x-litti-admin-key'] = process.env.LITTI_ADMIN_KEY;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${URL_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error(`Can't reach Litti at ${URL_BASE}. Start it with "npm start" (or "npm run demo"), or set LITTI_URL.`);
  }
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  return { status: res.status, data };
}

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { s += c; });
    process.stdin.on('end', () => resolve(s));
    process.stdin.on('error', reject);
  });
}

/** Value of `--name <value>`; undefined if missing or if the "value" is another flag. */
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : undefined;
}

/** Arguments that are not flags or flag values. */
function positionals(args: string[], flagsWithValues: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (flagsWithValues.includes(args[i])) { i++; continue; }
    if (!args[i].startsWith('--')) out.push(args[i]);
  }
  return out;
}

export async function run(argv: string[]): Promise<void> {
  const [cmd = 'help', ...args] = argv;

  switch (cmd) {
    case 'propose': {
      const src = args[0];
      if (!src) fail('Usage: litti propose <file.json | ->');
      const raw = src === '-' ? await readStdin() : readFileSync(src, 'utf8');
      let card: unknown;
      try { card = JSON.parse(raw); } catch (err) { fail(`Not valid JSON: ${(err as Error).message}`); }
      const { status, data } = await api('POST', '/api/actions', card);
      if (status >= 400) fail(data.message || `HTTP ${status}`);
      if (data.status === 'approved') {
        console.log(`🟢 Tier 0 — auto-approved. Action ${data.id}`);
      } else {
        console.log(`🔒 Tier ${data.tier} — needs ${data.requiredApprovers} reviewer(s). Action ${data.id}`);
        console.log(`   Review: ${data.approvalUrl}`);
        console.log(`   Check:  litti status ${data.id}`);
      }
      return;
    }

    case 'review': {
      const [id] = positionals(args, ['--as']);
      const reviewer = flag(args, '--as');
      if (!id || !reviewer) fail('Usage: litti review <id> --as <name>');
      const { status, data } = await api('POST', `/api/actions/${encodeURIComponent(id)}/review-link`, { reviewer });
      if (status >= 400) fail(data.message || `HTTP ${status}`);
      console.log(`🔐 Review link for ${data.reviewer} (valid ${data.expiresInMinutes} min, signs as ${data.reviewer}):`);
      console.log(data.url);
      return;
    }

    case 'status': {
      const id = args[0];
      if (!id) fail('Usage: litti status <id>');
      const { status, data } = await api('GET', `/api/actions/${encodeURIComponent(id)}`);
      if (status >= 400) fail(data.message || `HTTP ${status}`);
      if (data.status === 'approved') {
        console.log(`✅ APPROVED — Tier ${data.tier}. Run exactly the approved diff.`);
        if (data.token) console.log(JSON.stringify(data.token, null, 2));
      } else {
        console.log(`⏳ ${String(data.status).toUpperCase()} — ${data.approvals}/${data.requiredApprovers} reviewers passed (Tier ${data.tier}).`);
      }
      return;
    }

    case 'pending': {
      const { status, data } = await api('GET', '/api/pending');
      if (status >= 400) fail(data.message || `HTTP ${status}`);
      const list: any[] = Array.isArray(data.pending) ? data.pending : [];
      if (!list.length) { console.log('✅ Nothing waiting for review.'); return; }
      console.log('⏳ Waiting for reviewers');
      for (const p of list) {
        console.log(`  • Tier ${p.tier} · ${p.approvals}/${p.requiredApprovers} · ${p.action} · ${p.description}`);
        console.log(`    ${p.id}  ${p.approvalUrl}`);
      }
      return;
    }

    case 'verify': {
      const { status, data } = await api<any[]>('GET', '/api/chain/verify');
      if (status >= 400) fail((data as any).message || `HTTP ${status}`);
      if (!data.length) { console.log('📭 No receipts yet.'); return; }
      const bad = data.findIndex(l => !l.valid);
      if (bad === -1) { console.log(`✅ Receipt chain intact — ${data.length} receipts, every hash link verified.`); return; }
      console.log(`❌ Chain broken at receipt #${bad + 1} (${data[bad].id}). ${data.length - bad} receipt(s) from there on can't be trusted.`);
      process.exit(2);
    }

    case 'stats': {
      const { status, data } = await api<any[]>('GET', '/api/stats');
      if (status >= 400) fail((data as any).message || `HTTP ${status}`);
      if (!data.length) { console.log('📭 No reviews yet.'); return; }
      console.log('📊 Reviewer attention');
      for (const s of data) console.log(`  • ${s.approver}: avg attention ${s.avgAttention}/100 · rubber-stamps ${s.rubberStampCount} · approval rate ${s.approvalRate}%`);
      return;
    }

    case 'help': case '--help': case '-h':
      console.log(HELP);
      return;

    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

run(process.argv.slice(2)).catch(err => fail(err instanceof Error ? err.message : String(err)));
