/** Small JSON-over-HTTP helper shared by the Slack, Discord and Jira notifiers. */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface JsonResult {
  ok: boolean;
  status: number;
  body: any;
}

/**
 * Send JSON and parse the JSON reply. Never throws: integrations are best-effort
 * and must not fail an approval. Errors are logged with the service name and status
 * only — never the URL or headers, which carry tokens.
 */
export async function sendJson(
  service: string,
  fetchImpl: FetchLike,
  method: string,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<JsonResult> {
  try {
    const res = await fetchImpl(url, {
      method,
      headers: { 'content-type': 'application/json; charset=utf-8', accept: 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!res.ok) console.error(`⚠️  ${service} notify failed: HTTP ${res.status}`);
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    console.error(`⚠️  ${service} notify failed: ${(err as Error).name}`);
    return { ok: false, status: 0, body: null };
  }
}

/** One line, bounded length — for titles and summaries built from agent-supplied text. */
export function oneLine(s: string, max: number): string {
  const flat = String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Accept only https URLs (http allowed for localhost, for testing). */
export function safeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:') return u.toString().replace(/\/$/, '');
    if (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) return u.toString().replace(/\/$/, '');
  } catch { /* invalid */ }
  return null;
}

export const TIER_LABEL = ['🟢 Tier 0 · auto', '🟡 Tier 1 · 1 reviewer', '🟠 Tier 2 · 2 reviewers', '🔴 Tier 3 · 3 reviewers'];

/** Short status for an event, used in titles and issue comments. */
export function eventTitle(kind: string): string {
  switch (kind) {
    case 'approved': return '✅ Approved and executed';
    case 'execution-failed': return '❌ Approved, but execution failed';
    case 'rubber-stamped': return '⚠️ Rubber-stamp blocked — reviews reset';
    default: return '✍️ Countersigned';
  }
}

/** Whether an event closes the action (no more reviews expected). */
export const isFinal = (kind: string) => kind === 'approved' || kind === 'execution-failed';
