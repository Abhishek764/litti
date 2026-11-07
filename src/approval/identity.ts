/**
 * Reviewer identity and server-measured review time.
 *
 * Identity, strongest first:
 *  1. Trusted SSO header (LITTI_IDENTITY_HEADER, e.g. x-forwarded-email) set by your auth proxy.
 *  2. Review ticket: a signed, expiring link bound to one action and one reviewer,
 *     issued with `litti review <id> --as <name>` or POST /api/actions/:id/review-link.
 *  3. Self-asserted name: only when LITTI_ALLOW_SELF_ASSERTED=true (demo default).
 *
 * Review time is never trusted from the browser: the page carries a signed
 * "opened at" stamp, and the server measures elapsed time itself.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const TICKET_TTL_MS = 30 * 60 * 1000;
const VIEW_TTL_MS = 6 * 60 * 60 * 1000;

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
interface View { a: string; t: number }

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

/** Stamp the moment the review page was served. */
export function issueViewStamp(actionId: string, now = Date.now()): string {
  return sign('view', { a: actionId, t: now } satisfies View);
}

/** Server-measured ms since the page was served, or null if the stamp is bad. */
export function elapsedSinceView(token: unknown, actionId: string, now = Date.now()): number | null {
  const v = unsign<View>('view', token);
  if (!v || v.a !== actionId || v.t > now || now - v.t > VIEW_TTL_MS) return null;
  return now - v.t;
}

export type IdentitySource = 'sso' | 'ticket' | 'self-asserted';

/** Resolve who is reviewing, from headers / ticket / typed name, per configuration. */
export function resolveReviewer(
  headers: Record<string, string | string[] | undefined>,
  ticket: unknown,
  typedName: unknown,
  actionId: string,
): { name: string; source: IdentitySource } | { error: string } {
  const header = process.env.LITTI_IDENTITY_HEADER?.toLowerCase();
  if (header) {
    const v = headers[header];
    const name = (Array.isArray(v) ? v[0] : v)?.trim();
    if (name) return { name: name.slice(0, 128), source: 'sso' };
  }
  const t = verifyTicket(ticket, actionId);
  if (t) return { name: t.name, source: 'ticket' };
  if (ticket) return { error: 'Your review link expired or is for a different action. Ask for a new one (`litti review <id> --as <you>`).' };
  if (allowSelfAsserted() && typeof typedName === 'string' && typedName.trim()) {
    return { name: typedName.trim().slice(0, 64), source: 'self-asserted' };
  }
  return { error: 'Reviewer identity required. Get your personal review link with `litti review <id> --as <you>`.' };
}

/** Whether typed-in reviewer names are accepted (demo convenience, off in production). */
export function allowSelfAsserted(): boolean {
  return process.env.LITTI_ALLOW_SELF_ASSERTED === 'true';
}
