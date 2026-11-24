/**
 * Integrations page and Connect buttons.
 *
 *   GET  /integrations                         the page
 *   GET  /api/integrations                     status (never returns secrets)
 *   POST /api/integrations/:p/app              one-time app setup {clientId, clientSecret}
 *   GET  /connect/:p                           Connect button → provider sign-in
 *   GET  /connect/:p/callback                  provider sends the user back here
 *   POST /api/integrations/:p/webhook          quick connect with a pasted link (Slack, Discord)
 *   POST /api/integrations/:p/disconnect
 *   POST /api/integrations/:p/test             send a test message
 *   GET  /api/integrations/jira/projects       project picker
 *   POST /api/integrations/jira/settings       {projectKey, minTier, doneTransition}
 *
 * Only admins: locally (no LITTI_API_KEY / LITTI_API_KEYS) anyone at the machine; in production, people
 * listed in LITTI_ADMINS, identified by your SSO header (LITTI_IDENTITY_HEADER).
 * Browser writes need the x-litti-ui header (CSRF guard).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { isDiscordWebhook } from '../notify/discord.js';
import { sendJson } from '../notify/http.js';
import { PROVIDERS, consumeState, deleteConnection, getAppCreds, getConnection, issueState, saveAppCreds, saveConnection, updateConnection, type Provider } from './store.js';
import { authorizeUrl, exchange, jiraApiBase, jiraAuthHeader, jiraProjects } from './providers.js';
import { renderIntegrationsPage } from './page.js';

type Headers = Record<string, unknown>;

export function adminIdentity(headers: Headers, env = process.env): { ok: true; name: string } | { ok: false; why: string } {
  const h = env.LITTI_IDENTITY_HEADER?.toLowerCase();
  if (h) {
    const who = headers[h];
    const admins = (env.LITTI_ADMINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (typeof who !== 'string' || !who) return { ok: false, why: 'Sign in through your SSO proxy first.' };
    if (!admins.includes(who.toLowerCase())) return { ok: false, why: `${who} is not in LITTI_ADMINS.` };
    return { ok: true, name: who };
  }
  if (env.LITTI_API_KEY || env.LITTI_API_KEYS) return { ok: false, why: 'Production mode: set LITTI_IDENTITY_HEADER and LITTI_ADMINS to manage integrations.' };
  return { ok: true, name: 'local admin' };
}

/** A failed Send test says what went wrong; it never claims success. */
const sendFailed = (name: string, status: number) =>
  `${name} did not accept the message (${status ? `HTTP ${status}` : 'no answer'}). The webhook may have been deleted: paste a new link or reconnect.`;

const isProvider = (p: string): p is Provider => (PROVIDERS as string[]).includes(p);
const NAMES: Record<Provider, string> = { slack: 'Slack', discord: 'Discord', jira: 'Jira' };

export function baseUrl(req: { protocol: string; headers: Headers }): string {
  return (process.env.PUBLIC_URL || `${req.protocol}://${String(req.headers.host)}`).replace(/\/$/, '');
}
export const redirectUri = (base: string, p: Provider) => `${base}/connect/${p}/callback`;

/**
 * Litti Connect service used by the one-click buttons. LITTI_CONNECT_BROKER overrides the
 * default; set it to "off" to disable. Only https (or loopback, for local testing).
 */
export const DEFAULT_BROKER = '';
export function brokerUrl(env = process.env): string | null {
  const raw = (env.LITTI_CONNECT_BROKER ?? DEFAULT_BROKER).trim();
  if (!raw || raw === 'off') return null;
  try {
    const u = new URL(raw);
    const loop = ['127.0.0.1', 'localhost'].includes(u.hostname);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && loop)) return u.origin + u.pathname.replace(/\/$/, '');
  } catch { /* invalid */ }
  return null;
}

/**
 * Check what Litti Connect sent back. Only known fields are kept, and the broker URL saved
 * with a Jira connection comes from our own config, never from the incoming data.
 */
export function validateBrokerConn(p: Provider, c: any): Record<string, unknown> | null {
  if (!c || typeof c !== 'object') return null;
  const s = (v: unknown, max = 500) => (typeof v === 'string' && v.length <= max ? v : undefined);
  if (p === 'slack') {
    const token = s(c.token, 300), channelId = s(c.channelId, 40);
    if (!token?.startsWith('xox') || !channelId || !/^[A-Z0-9]+$/.test(channelId)) return null;
    return { kind: 'oauth', token, channelId, channelName: s(c.channelName, 100), team: s(c.team, 100) };
  }
  if (p === 'discord') {
    const url = s(c.webhookUrl);
    if (!url || !isDiscordWebhook(url)) return null;
    return { webhookUrl: url, channelId: s(c.channelId, 40), guildName: s(c.guildName, 100), webhookName: s(c.webhookName, 100), via: 'oauth' };
  }
  const cloudId = s(c.cloudId, 100), siteUrl = s(c.siteUrl, 300), accessToken = s(c.accessToken, 5000);
  if (!cloudId || !accessToken || !siteUrl?.startsWith('https://')) return null;
  return {
    cloudId, siteUrl, siteName: s(c.siteName, 200) ?? siteUrl, accessToken,
    refreshToken: s(c.refreshToken, 5000), expiresAt: Number(c.expiresAt) || Date.now() + 3600_000,
    broker: brokerUrl() ?? undefined,
  };
}

/** Public view of a connection: what the page shows. No tokens, no webhook URLs. */
function status(p: Provider) {
  const app = getAppCreds(p);
  const c = getConnection(p) as any;
  let details: Record<string, unknown> | null = null;
  if (c) {
    if (p === 'slack') details = { how: c.kind === 'oauth' ? 'Slack app' : 'Pasted webhook link', team: c.team ?? null, channel: c.channelName ?? null };
    if (p === 'discord') details = { how: c.via === 'oauth' ? 'Discord sign-in' : 'Pasted webhook link', server: c.guildName ?? null, webhook: c.webhookName ?? null };
    if (p === 'jira') details = { site: c.siteName, siteUrl: c.siteUrl, projectKey: c.projectKey ?? null, projectName: c.projectName ?? null, minTier: c.minTier ?? 2, doneTransition: c.doneTransition ?? '' };
    details = { ...details, connectedAt: c.connectedAt, connectedBy: c.connectedBy };
  }
  return { appReady: Boolean(app), appSource: app?.source ?? null, clientId: app?.clientId ?? null, oneClick: Boolean(app || brokerUrl()), connected: Boolean(c), details };
}

export function registerConnectRoutes(app: FastifyInstance): void {
  const guard = (req: { headers: Headers }, reply: FastifyReply, write: boolean) => {
    const a = adminIdentity(req.headers);
    if (!a.ok) { reply.code(403).send({ ok: false, message: `🔒 ${a.why}` }); return null; }
    if (write && req.headers['x-litti-ui'] !== '1') { reply.code(403).send({ ok: false, message: '🔒 Use the Integrations page.' }); return null; }
    return a;
  };

  app.get<{ Querystring: { connected?: string; error?: string } }>('/integrations', (req, reply) => {
    const a = adminIdentity(req.headers);
    if (!a.ok) {
      reply.code(403).type('text/html').send(`<!doctype html><meta charset="utf-8"><title>Litti</title><body style="font-family:system-ui;padding:40px"><h1>🔒 Integrations are for admins</h1><p>${a.why.replace(/[<>&]/g, '')}</p></body>`);
      return;
    }
    reply.type('text/html').header('cache-control', 'no-store').send(renderIntegrationsPage());
  });

  app.get('/api/integrations', (req, reply) => {
    if (!guard(req, reply, false)) return;
    const base = baseUrl(req);
    return {
      ok: true,
      baseUrl: base,
      https: base.startsWith('https://'),
      redirectUris: Object.fromEntries(PROVIDERS.map(p => [p, redirectUri(base, p)])),
      providers: Object.fromEntries(PROVIDERS.map(p => [p, status(p)])),
    };
  });

  app.post<{ Params: { p: string }; Body: { clientId?: unknown; clientSecret?: unknown } }>('/api/integrations/:p/app', (req, reply) => {
    if (!guard(req, reply, true)) return;
    const p = req.params.p;
    if (!isProvider(p)) return reply.code(404).send({ ok: false, message: 'Unknown integration.' });
    const clientId = String(req.body?.clientId ?? '').trim();
    const clientSecret = String(req.body?.clientSecret ?? '').trim();
    if (!/^[\w.\-:]{4,200}$/.test(clientId) || clientSecret.length < 8 || clientSecret.length > 500) {
      return reply.code(400).send({ ok: false, message: 'Paste both the Client ID and the Client Secret from the app page.' });
    }
    if (getAppCreds(p)?.source === 'env') return reply.code(409).send({ ok: false, message: 'This app is set in .env; change it there.' });
    saveAppCreds(p, { clientId, clientSecret });
    return { ok: true };
  });

  app.get<{ Params: { p: string } }>('/connect/:p', (req, reply) => {
    const a = adminIdentity(req.headers);
    const p = req.params.p;
    if (!a.ok || !isProvider(p)) return reply.redirect('/integrations?error=' + encodeURIComponent(a.ok ? 'Unknown integration.' : a.why));
    const creds = getAppCreds(p);
    // Your own registered app wins; otherwise go through Litti Connect (one button, no setup).
    if (creds) return reply.redirect(authorizeUrl(p, creds, redirectUri(baseUrl(req), p), issueState(p)));
    const broker = brokerUrl();
    if (!broker) return reply.redirect(`/integrations?error=${encodeURIComponent(`One-click connect isn't available on this Litti. Use "Other ways to connect" under ${NAMES[p]}.`)}`);
    const q = new URLSearchParams({ state: issueState(p), return: `${baseUrl(req)}/connect/${p}/done` });
    return reply.redirect(`${broker}/start/${p}?${q}`);
  });

  // Litti Connect posts the result back here (a form POST keeps tokens out of URLs and history).
  // The signed, single-use state proves this browser started the flow on this Litti.
  app.register(async scope => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 },
      (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
    scope.post<{ Params: { p: string }; Body: Record<string, string> }>('/connect/:p/done', (req, reply) => {
      const p = req.params.p;
      const back = (q: string) => reply.redirect(`/integrations?${q}`, 303);
      const a = adminIdentity(req.headers);
      if (!a.ok) return back(`error=${encodeURIComponent(a.why)}`);
      if (!isProvider(p) || !consumeState(p, req.body?.state)) return back(`error=${encodeURIComponent('That connect link expired or was not started here. Click Connect again.')}`);
      if (req.body?.error) return back(`error=${encodeURIComponent(String(req.body.error).slice(0, 200))}`);
      let conn: any;
      try { conn = JSON.parse(String(req.body?.conn ?? '')); } catch { conn = null; }
      const checked = validateBrokerConn(p, conn);
      if (!checked) return back(`error=${encodeURIComponent(`${NAMES[p]} sent back something unexpected. Try again.`)}`);
      saveConnection(p, checked as any, a.name);
      return back(`connected=${p}`);
    });
  });

  app.get<{ Params: { p: string }; Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>('/connect/:p/callback', async (req, reply) => {
    const p = req.params.p;
    const back = (q: string) => reply.redirect(`/integrations?${q}`);
    const a = adminIdentity(req.headers);
    if (!a.ok) return back(`error=${encodeURIComponent(a.why)}`);
    if (!isProvider(p)) return back('error=Unknown%20integration.');
    if (!consumeState(p, req.query.state)) return back(`error=${encodeURIComponent('That sign-in link expired or was not started here. Click Connect again.')}`);
    if (req.query.error) return back(`error=${encodeURIComponent(`${NAMES[p]}: ${String(req.query.error_description || req.query.error).slice(0, 120)}`)}`);
    if (!req.query.code) return back('error=No%20authorization%20code%20came%20back.');
    try {
      const conn = await exchange(p, req.query.code, redirectUri(baseUrl(req), p));
      saveConnection(p, conn as any, a.name);
      return back(`connected=${p}`);
    } catch (err) {
      return back(`error=${encodeURIComponent((err as Error).message)}`);
    }
  });

  app.post<{ Params: { p: string }; Body: { url?: unknown } }>('/api/integrations/:p/webhook', (req, reply) => {
    const a = guard(req, reply, true);
    if (!a) return;
    const url = String(req.body?.url ?? '').trim();
    if (req.params.p === 'discord') {
      if (!isDiscordWebhook(url)) return reply.code(400).send({ ok: false, message: 'That is not a Discord webhook link. It starts with https://discord.com/api/webhooks/' });
      saveConnection('discord', { webhookUrl: url, via: 'webhook' }, a.name);
      return { ok: true };
    }
    if (req.params.p === 'slack') {
      if (!/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url)) return reply.code(400).send({ ok: false, message: 'That is not a Slack webhook link. It starts with https://hooks.slack.com/services/' });
      saveConnection('slack', { kind: 'webhook', webhookUrl: url }, a.name);
      return { ok: true };
    }
    return reply.code(400).send({ ok: false, message: 'Quick connect is only for Slack and Discord.' });
  });

  app.post<{ Params: { p: string } }>('/api/integrations/:p/disconnect', (req, reply) => {
    if (!guard(req, reply, true)) return;
    const p = req.params.p;
    if (!isProvider(p)) return reply.code(404).send({ ok: false, message: 'Unknown integration.' });
    deleteConnection(p);
    return { ok: true };
  });

  app.post<{ Params: { p: string } }>('/api/integrations/:p/test', async (req, reply) => {
    if (!guard(req, reply, true)) return;
    const p = req.params.p;
    const msg = '👋 Litti is connected. Approval requests will show up here.';
    if (p === 'slack') {
      const c = getConnection('slack');
      if (!c) return reply.code(409).send({ ok: false, message: 'Slack is not connected.' });
      if (c.kind === 'oauth' && c.token && c.channelId) {
        const r = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${c.token}` }, body: JSON.stringify({ channel: c.channelId, text: msg }), signal: AbortSignal.timeout(10000) }).then(r => r.json()).catch(() => null) as any;
        return r?.ok ? { ok: true, message: `Sent to #${c.channelName ?? 'channel'}.` } : reply.code(502).send({ ok: false, message: `Slack said: ${String(r?.error ?? 'no answer').slice(0, 60)}` });
      }
      if (!c.webhookUrl) return reply.code(409).send({ ok: false, message: 'Slack is not connected.' });
      const r = await sendJson('Slack', fetch, 'POST', c.webhookUrl, { text: msg });
      return r.ok ? { ok: true, message: 'Sent. Check your Slack channel.' } : reply.code(502).send({ ok: false, message: sendFailed('Slack', r.status) });
    }
    if (p === 'discord') {
      const c = getConnection('discord');
      if (!c) return reply.code(409).send({ ok: false, message: 'Discord is not connected.' });
      const r = await sendJson('Discord', fetch, 'POST', c.webhookUrl.split('?')[0], { username: 'Litti', content: msg, allowed_mentions: { parse: [] } });
      return r.ok ? { ok: true, message: 'Sent. Check your Discord channel.' } : reply.code(502).send({ ok: false, message: sendFailed('Discord', r.status) });
    }
    if (p === 'jira') {
      const c = getConnection('jira');
      if (!c) return reply.code(409).send({ ok: false, message: 'Jira is not connected.' });
      if (!c.projectKey) return reply.code(409).send({ ok: false, message: 'Pick a Jira project first.' });
      const r = await fetch(`${jiraApiBase(c)}/project/${encodeURIComponent(c.projectKey)}`, { headers: { authorization: await jiraAuthHeader(), accept: 'application/json' }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      return r?.ok ? { ok: true, message: `Jira works: Litti can create issues in ${c.projectKey}.` } : reply.code(502).send({ ok: false, message: `Jira answered HTTP ${r?.status ?? 'nothing'}. Try reconnecting.` });
    }
    return reply.code(404).send({ ok: false, message: 'Unknown integration.' });
  });

  app.get('/api/integrations/jira/projects', async (req, reply) => {
    if (!guard(req, reply, false)) return;
    try { return { ok: true, projects: await jiraProjects() }; }
    catch { return reply.code(502).send({ ok: false, message: 'Could not load Jira projects. Try reconnecting.' }); }
  });

  app.post<{ Body: { projectKey?: unknown; projectName?: unknown; minTier?: unknown; doneTransition?: unknown } }>('/api/integrations/jira/settings', (req, reply) => {
    if (!guard(req, reply, true)) return;
    if (!getConnection('jira')) return reply.code(409).send({ ok: false, message: 'Jira is not connected.' });
    const key = String(req.body?.projectKey ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]+$/.test(key)) return reply.code(400).send({ ok: false, message: 'Pick a project.' });
    const minTier = Number(req.body?.minTier ?? 2);
    updateConnection('jira', {
      projectKey: key,
      projectName: String(req.body?.projectName ?? key).slice(0, 120),
      minTier: [1, 2, 3].includes(minTier) ? minTier : 2,
      doneTransition: String(req.body?.doneTransition ?? '').trim().slice(0, 60),
    });
    return { ok: true };
  });
}
