/**
 * Reviewer identity and server-measured review time.
 *
 * Identity, strongest first:
 *  1. Trusted SSO header (LITTI_IDENTITY_HEADER, e.g. x-forwarded-email) set by your auth proxy.
 *  2. Review ticket: a signed, expiring link bound to one action and one reviewer,
 *     issued with `litti review <id> --as <name>` or POST /api/actions/:id/review-link.
 *  3. Self-asserted name: only when LITTI_ALLOW_SELF_ASSERTED=true (demo default).
 *  4. Local mode (no API key, no SSO header, loopback server and request): the OS user,
 *     or LITTI_LOCAL_REVIEWER from ~/.litti/config.env. A solo developer never types a name.
 *
 * Review time is never trusted from the browser: the page carries a signed
 * "opened at" stamp, and the server measures elapsed time itself.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { userInfo } from 'node:os';

const TICKET_TTL_MS = 30 * 60 * 1000;
const VIEW_TTL_MS = 2 * 60 * 60 * 1000;

function secret(): string {
  const key = process.env.SECRET_KEY;
  if (!key) throw new Error('SECRET_KEY is not set');
  return key;
}

function sign(kind: string, data: object): string {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  const mac = createHmac('sha256', secret()).update(`${kind}.${body}`).digest('base64url');
  return `${body}.${mac}`;
}

function unsign<T>(kind: string, token: unknown): T | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret()).update(`${kind}.${body}`).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T; } catch { return null; }
}

interface Ticket { a: string; r: string; u: string; e: number }
interface View { a: string; t: number; n: string; r?: string }

/** Latin look-alikes in Cyrillic and Greek (lowercase, after case folding). */
const CONFUSABLES: Record<string, string> = {
  а: 'a', в: 'b', г: 'r', д: 'd', е: 'e', ё: 'e', з: '3', и: 'u', к: 'k', м: 'm', н: 'h', о: 'o', п: 'n', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  ѕ: 's', і: 'i', ї: 'i', ј: 'j', ԁ: 'd', ԛ: 'q', ԝ: 'w', һ: 'h', ӏ: 'l', ү: 'y', ь: 'b',
  α: 'a', β: 'b', γ: 'y', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ω: 'w', ϲ: 'c', ϳ: 'j',
  ı: 'i', ɑ: 'a', ɡ: 'g', ℓ: 'l',
};

/**
 * One stable key per person, however the name is spelled: Unicode-normalised, case-folded,
 * without invisible/format characters, accents or spaces, and with Cyrillic/Greek look-alikes
 * mapped to Latin. "Bob", "bob​", "Bоb" (Cyrillic о) and " B o b " are all "bob".
 */
export function reviewerKey(name: string): string {
  const folded = name.normalize('NFKD').replace(/[\p{M}\p{Cf}\p{Zs}\s]/gu, '').toLowerCase().normalize('NFKC');
  let out = '';
  for (const ch of folded) out += CONFUSABLES[ch] ?? ch;
  return out.slice(0, 128);
}

/** Issue a review ticket for one reviewer on one action. */
export function issueTicket(actionId: string, reviewerName: string, reviewerId: string, now = Date.now()): string {
  return sign('ticket', { a: actionId, r: reviewerName.slice(0, 64), u: reviewerId.slice(0, 128), e: now + TICKET_TTL_MS } satisfies Ticket);
}

/** Verify a review ticket for this action. Returns the reviewer, or null. */
export function verifyTicket(token: unknown, actionId: string, now = Date.now()): { name: string; id: string } | null {
  const t = unsign<Ticket>('ticket', token);
  if (!t || t.a !== actionId || t.e < now) return null;
  return { name: t.r, id: t.u };
}

/**
 * Stamp the moment the review page was served. Bound to the reviewer when the page knows who
 * it is, and carrying a nonce so the server can accept it exactly once.
 */
export function issueViewStamp(actionId: string, now = Date.now(), reviewerId?: string): string {
  return sign('view', { a: actionId, t: now, n: randomBytes(12).toString('base64url'), ...(reviewerId ? { r: reviewerId } : {}) } satisfies View);
}

/** Read a view stamp: server-measured ms since the page was served, its nonce and reviewer. */
export function readViewStamp(token: unknown, actionId: string, now = Date.now()): { elapsedMs: number; nonce: string; reviewerId?: string } | null {
  const v = unsign<View>('view', token);
  if (!v || v.a !== actionId || typeof v.n !== 'string' || v.t > now || now - v.t > VIEW_TTL_MS) return null;
  return { elapsedMs: now - v.t, nonce: v.n, ...(v.r ? { reviewerId: v.r } : {}) };
}

/** Server-measured ms since the page was served, or null if the stamp is bad. */
export function elapsedSinceView(token: unknown, actionId: string, now = Date.now()): number | null {
  return readViewStamp(token, actionId, now)?.elapsedMs ?? null;
}

export type IdentitySource = 'sso' | 'ticket' | 'self-asserted' | 'local';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const LOOPBACK_IPS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

/** Personal setup: no agent key, no SSO header, listening only on this machine. */
export function localMode(env = process.env): boolean {
  return !env.LITTI_API_KEY && !env.LITTI_API_KEYS && !env.LITTI_IDENTITY_HEADER && LOOPBACK_HOSTS.includes(env.HOST || '127.0.0.1');
}

/** The person at this machine: LITTI_LOCAL_REVIEWER, else the OS user name. */
export function localReviewerName(env = process.env): string {
  const set = env.LITTI_LOCAL_REVIEWER?.trim();
  if (set) return set.slice(0, 64);
  try { return userInfo().username.slice(0, 64) || 'local-user'; } catch { return 'local-user'; }
}

/** Local sign-in applies only in local mode and only to requests from this machine. */
export function localReviewer(ip: string | undefined, env = process.env): string | null {
  return localMode(env) && ip !== undefined && LOOPBACK_IPS.includes(ip) ? localReviewerName(env) : null;
}

/** Resolve who is reviewing, from headers / ticket / typed name, per configuration. */
export function resolveReviewer(
  headers: Record<string, string | string[] | undefined>,
  ticket: unknown,
  typedName: unknown,
  actionId: string,
  ip?: string,
): { name: string; id: string; source: IdentitySource } | { error: string } {
  const header = process.env.LITTI_IDENTITY_HEADER?.toLowerCase();
  if (header) {
    const v = headers[header];
    const name = (Array.isArray(v) ? v[0] : v)?.trim();
    if (name) return { name: name.slice(0, 128), id: reviewerKey(name), source: 'sso' };
  }
  const t = verifyTicket(ticket, actionId);
  if (t) return { name: t.name, id: reviewerKey(t.id || t.name), source: 'ticket' };
  if (ticket) return { error: 'Your review link expired or is for a different action. Ask for a new one (`litti review <id> --as <you>`).' };
  if (allowSelfAsserted() && typeof typedName === 'string' && typedName.trim()) {
    const name = typedName.trim().slice(0, 64);
    return { name, id: reviewerKey(name), source: 'self-asserted' };
  }
  const local = localReviewer(ip);
  if (local) return { name: local, id: reviewerKey(local), source: 'local' };
  return { error: 'Reviewer identity required. Get your personal review link with `litti review <id> --as <you>`.' };
}

/** Whether typed-in reviewer names are accepted (demo convenience, off in production). */
export function allowSelfAsserted(): boolean {
  return process.env.LITTI_ALLOW_SELF_ASSERTED === 'true';
}
