/**
 * Litti Connect: the small hosted service behind the one-click Connect buttons.
 *
 * Slack, Discord and Atlassian only let *registered* apps connect, and Slack only
 * redirects to https. This service holds Litti's registered apps so that every Litti
 * install — on a laptop at http://127.0.0.1 or on a server — gets one button:
 *
 *   Litti ──► /start/:p ──► provider sign-in ──► /callback/:p ──► (form POST) ──► Litti /connect/:p/done
 *
 * It is stateless and stores nothing: the round-trip state is signed with
 * LITTI_BROKER_SECRET, tokens are handed straight back to the Litti that asked, and the
 * only thing it does later is refresh Jira tokens (Atlassian needs the app secret for that).
 *
 * Where results may be sent: loopback addresses (any port) by default, plus the https
 * origins listed in LITTI_BROKER_ALLOWED_RETURNS for self-hosted team servers.
 *
 * Env: LITTI_BROKER_URL (this service's public https URL), LITTI_BROKER_SECRET (32+ chars),
 *      SLACK_CLIENT_ID/_SECRET, DISCORD_CLIENT_ID/_SECRET, ATLASSIAN_CLIENT_ID/_SECRET, PORT.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { authorizeUrl, exchange, refreshJira } from '../connect/providers.js';
import type { AppCreds, Provider } from '../connect/store.js';

const PROVIDERS: Provider[] = ['slack', 'discord', 'jira'];
const NAMES: Record<Provider, string> = { slack: 'Slack', discord: 'Discord', jira: 'Jira' };
const ENV: Record<Provider, [string, string]> = {
  slack: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  discord: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
  jira: ['ATLASSIAN_CLIENT_ID', 'ATLASSIAN_CLIENT_SECRET'],
};

export interface BrokerOptions {
  publicUrl: string;
  secret: string;
  apps: Partial<Record<Provider, AppCreds>>;
  allowedReturnOrigins?: string[];
}

export function brokerOptionsFromEnv(env = process.env): BrokerOptions {
  const apps: Partial<Record<Provider, AppCreds>> = {};
  for (const p of PROVIDERS) {
    const [id, secret] = ENV[p];
    if (env[id] && env[secret]) apps[p] = { clientId: env[id]!, clientSecret: env[secret]! };
  }
  return {
    publicUrl: (env.LITTI_BROKER_URL || '').replace(/\/$/, ''),
    secret: env.LITTI_BROKER_SECRET || '',
    apps,
    allowedReturnOrigins: (env.LITTI_BROKER_ALLOWED_RETURNS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean),
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isProvider = (p: string): p is Provider => (PROVIDERS as string[]).includes(p);

/** Results only go back to a Litti on this computer, or to an origin the operator allowed. */
export function returnAllowed(raw: string, p: Provider, allowed: string[] = []): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.pathname !== `/connect/${p}/done` || u.search || u.hash || u.username || u.password) return false;
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (loopback && (u.protocol === 'http:' || u.protocol === 'https:')) return true;
  return u.protocol === 'https:' && allowed.includes(u.origin);
}

function sign(secret: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
function unsign<T>(secret: string, token: unknown): T | null {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T; } catch { return null; }
}

/** HTML page that POSTs the result back to the Litti that asked (keeps tokens out of URLs and history). */
function postBack(action: string, fields: Record<string, string>, title: string): string {
  const inputs = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0d12;color:#e6edf3;display:grid;place-items:center;min-height:100vh;margin:0}main{text-align:center}button{font:inherit;background:#F5B942;border:0;border-radius:8px;padding:10px 18px;font-weight:700;cursor:pointer}</style></head>
<body><main><p>${esc(title)}</p><form id="f" method="post" action="${esc(action)}">${inputs}<noscript><button type="submit">Continue to Litti</button></noscript></form></main>
<script>document.getElementById('f').submit();</script></body></html>`;
}

function infoPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Litti Connect</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0d12;color:#e6edf3;max-width:640px;margin:0 auto;padding:48px 20px;line-height:1.6}code{background:#161b22;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>${esc(title)}</h1>${body}</body></html>`;
}

export function buildBroker(opts: BrokerOptions): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: true });
  const cb = (p: Provider) => `${opts.publicUrl}/callback/${p}`;

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('cache-control', 'no-store');
    return payload;
  });

  app.get('/', (_req, reply) => {
    const list = PROVIDERS.map(p => `<li>${NAMES[p]}: ${opts.apps[p] ? '✅ ready' : '— not configured'}</li>`).join('');
    reply.type('text/html').send(infoPage('Litti Connect', `<p>This service lets Litti connect to Slack, Discord and Jira with one button. It stores nothing.</p><ul>${list}</ul><p>Open Litti and use <b>Integrations → Connect</b>.</p>`));
  });
  app.get('/health', () => ({ ok: true, providers: PROVIDERS.filter(p => opts.apps[p]) }));

  app.get<{ Params: { p: string }; Querystring: { state?: string; return?: string } }>('/start/:p', (req, reply) => {
    const p = req.params.p;
    if (!isProvider(p)) return reply.code(404).type('text/html').send(infoPage('Unknown service', '<p>Litti Connect supports Slack, Discord and Jira.</p>'));
    const creds = opts.apps[p];
    if (!creds) return reply.code(503).type('text/html').send(infoPage(`${NAMES[p]} isn't set up here`, '<p>This Litti Connect service has no app for it yet.</p>'));
    const ret = String(req.query.return ?? '');
    if (!returnAllowed(ret, p, opts.allowedReturnOrigins)) {
      return reply.code(400).type('text/html').send(infoPage('Not allowed', '<p>Litti Connect only returns to a Litti running on this computer, or to a team server its operator approved.</p>'));
    }
    const state = String(req.query.state ?? '');
    if (!/^[\w.-]{10,300}$/.test(state)) return reply.code(400).type('text/html').send(infoPage('Bad request', '<p>Missing state. Start again from Litti.</p>'));
    const bstate = sign(opts.secret, { p, s: state, r: ret, exp: Date.now() + 10 * 60 * 1000 });
    return reply.redirect(authorizeUrl(p, creds, cb(p), bstate));
  });

  app.get<{ Params: { p: string }; Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>('/callback/:p', async (req, reply) => {
    const p = req.params.p;
    const st = unsign<{ p: string; s: string; r: string; exp: number }>(opts.secret, req.query.state);
    if (!isProvider(p) || !st || st.p !== p || st.exp < Date.now() || !returnAllowed(st.r, p, opts.allowedReturnOrigins)) {
      return reply.code(400).type('text/html').send(infoPage('This link expired', '<p>Go back to Litti and click Connect again.</p>'));
    }
    const back = (fields: Record<string, string>, title: string) => reply.type('text/html').send(postBack(st.r, { state: st.s, ...fields }, title));
    if (req.query.error || !req.query.code) {
      return back({ error: `${NAMES[p]}: ${String(req.query.error_description || req.query.error || 'no authorization code').slice(0, 160)}` }, 'Returning to Litti…');
    }
    try {
      const conn = await exchange(p, req.query.code, cb(p), opts.apps[p]);
      return back({ conn: JSON.stringify(conn) }, `${NAMES[p]} connected. Returning to Litti…`);
    } catch (err) {
      return back({ error: (err as Error).message.slice(0, 160) }, 'Returning to Litti…');
    }
  });

  // Jira access tokens last an hour; refreshing needs the app secret, which only this service has.
  app.post<{ Body: { refreshToken?: unknown } }>('/refresh/jira', async (req, reply) => {
    const creds = opts.apps.jira;
    const rt = req.body?.refreshToken;
    if (!creds) return reply.code(503).send({ ok: false, error: 'jira not configured' });
    if (typeof rt !== 'string' || rt.length < 10 || rt.length > 5000) return reply.code(400).send({ ok: false, error: 'refreshToken required' });
    const r = await refreshJira(creds, rt);
    if (!r.ok || !r.body?.access_token) return reply.code(r.status >= 400 && r.status < 500 ? 401 : 502).send({ ok: false, error: 'refresh failed' });
    return { access_token: r.body.access_token, refresh_token: r.body.refresh_token, expires_in: r.body.expires_in };
  });

  return app;
}

const isMain = process.argv[1] && /broker[\\/]server\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  const opts = brokerOptionsFromEnv();
  const problems: string[] = [];
  if (!/^https:\/\//.test(opts.publicUrl)) problems.push('LITTI_BROKER_URL must be this service\'s public https URL.');
  if (opts.secret.length < 32) problems.push('LITTI_BROKER_SECRET must be at least 32 random characters.');
  if (!Object.keys(opts.apps).length) problems.push('Set at least one app: SLACK_CLIENT_ID/_SECRET, DISCORD_CLIENT_ID/_SECRET or ATLASSIAN_CLIENT_ID/_SECRET.');
  if (problems.length) { for (const p of problems) console.error(`❌ ${p}`); process.exit(1); }
  const port = Number(process.env.PORT) || 3850;
  buildBroker(opts).listen({ port, host: '0.0.0.0' }).then(() => {
    console.log(`🔌 Litti Connect on :${port} (${opts.publicUrl}) · apps: ${Object.keys(opts.apps).join(', ')}`);
  });
}
