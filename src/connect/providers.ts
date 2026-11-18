/**
 * OAuth flows behind the Connect buttons.
 *
 *  - Slack:   OAuth v2 with `chat:write` + `incoming-webhook`. Slack asks the user to pick a
 *             channel during install; we keep the bot token and that channel.
 *  - Discord: OAuth2 `webhook.incoming`. Discord asks for a server + channel and returns a webhook.
 *  - Jira:    Atlassian OAuth 2.0 (3LO) with `offline_access`, so tokens refresh on their own.
 */
import { isDiscordWebhook } from '../notify/discord.js';
import type { FetchLike } from '../notify/http.js';
import { getAppCreds, getConnection, updateConnection, type AppCreds, type DiscordConn, type JiraConn, type Provider, type SlackConn } from './store.js';

let fetchImpl: FetchLike = (url, init) => fetch(url, init);
/** Tests swap the network out here. */
export function setConnectFetch(f: FetchLike | null): void { fetchImpl = f ?? ((url, init) => fetch(url, init)); }

export const SLACK_SCOPES = ['chat:write', 'incoming-webhook'];
export const JIRA_SCOPES = ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'];

export function authorizeUrl(p: Provider, app: AppCreds, redirectUri: string, state: string): string {
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  if (p === 'slack') return `https://slack.com/oauth/v2/authorize?${q({ client_id: app.clientId, scope: SLACK_SCOPES.join(','), redirect_uri: redirectUri, state })}`;
  if (p === 'discord') return `https://discord.com/oauth2/authorize?${q({ client_id: app.clientId, response_type: 'code', scope: 'webhook.incoming', redirect_uri: redirectUri, state, prompt: 'consent' })}`;
  return `https://auth.atlassian.com/authorize?${q({ audience: 'api.atlassian.com', client_id: app.clientId, scope: JIRA_SCOPES.join(' '), redirect_uri: redirectUri, state, response_type: 'code', prompt: 'consent' })}`;
}

async function json(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}
const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(o).toString() });

/** Turn the provider's `code` into a stored connection. Throws a user-readable Error on failure. */
export async function exchange(p: Provider, code: string, redirectUri: string, appCreds?: AppCreds | null): Promise<SlackConn | DiscordConn | JiraConn> {
  const app = appCreds ?? getAppCreds(p);
  if (!app) throw new Error('This integration is not set up yet.');

  if (p === 'slack') {
    const r = await json('https://slack.com/api/oauth.v2.access', form({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: redirectUri }));
    if (!r.body?.ok) throw new Error(`Slack said: ${String(r.body?.error ?? `HTTP ${r.status}`).slice(0, 80)}`);
    const hook = r.body.incoming_webhook ?? {};
    return {
      kind: 'oauth', token: r.body.access_token, team: r.body.team?.name,
      channelId: hook.channel_id, channelName: hook.channel, webhookUrl: hook.url,
    };
  }

  if (p === 'discord') {
    const r = await json('https://discord.com/api/oauth2/token', form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: app.clientId, client_secret: app.clientSecret }));
    const url = r.body?.webhook?.url ?? (r.body?.webhook?.id && r.body?.webhook?.token ? `https://discord.com/api/webhooks/${r.body.webhook.id}/${r.body.webhook.token}` : '');
    if (!r.ok || !isDiscordWebhook(url)) throw new Error(`Discord said: ${String(r.body?.error_description ?? r.body?.error ?? `HTTP ${r.status}`).slice(0, 80)}`);
    return { webhookUrl: url, channelId: r.body.webhook.channel_id, guildName: r.body.guild?.name, via: 'oauth' };
  }

  const t = await json('https://auth.atlassian.com/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: redirectUri }),
  });
  if (!t.ok || !t.body?.access_token) throw new Error(`Atlassian said: ${String(t.body?.error_description ?? t.body?.error ?? `HTTP ${t.status}`).slice(0, 80)}`);
  const sites = await json('https://api.atlassian.com/oauth/token/accessible-resources', { headers: { authorization: `Bearer ${t.body.access_token}`, accept: 'application/json' } });
  const site = Array.isArray(sites.body) ? sites.body.find((s: any) => (s.scopes ?? []).some((x: string) => x.includes('jira'))) ?? sites.body[0] : null;
  if (!site?.id) throw new Error('No Jira site found on this Atlassian account.');
  return {
    cloudId: site.id, siteUrl: site.url, siteName: site.name,
    accessToken: t.body.access_token, refreshToken: t.body.refresh_token,
    expiresAt: Date.now() + (Number(t.body.expires_in) || 3600) * 1000,
  };
}

/** Exchange a Jira refresh token for new tokens with the given app (Atlassian rotates refresh tokens). */
export function refreshJira(app: AppCreds, refreshToken: string) {
  return json('https://auth.atlassian.com/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken }),
  });
}

/** A valid Jira bearer header, refreshing the token when it is about to expire. */
export async function jiraAuthHeader(): Promise<string> {
  const c = getConnection('jira');
  if (!c) throw new Error('Jira is not connected');
  if (c.expiresAt - Date.now() > 60_000 || !c.refreshToken) return `Bearer ${c.accessToken}`;
  let r: { ok: boolean; status: number; body: any };
  if (c.broker) {
    // Connected through Litti Connect: only the connect service holds the app secret.
    r = await json(`${c.broker.replace(/\/$/, '')}/refresh/jira`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ refreshToken: c.refreshToken }),
    });
  } else {
    const app = getAppCreds('jira');
    if (!app) return `Bearer ${c.accessToken}`;
    r = await refreshJira(app, c.refreshToken);
  }
  if (!r.ok || !r.body?.access_token) {
    console.error(`⚠️  Jira token refresh failed (HTTP ${r.status}). Reconnect Jira on the Integrations page.`);
    return `Bearer ${c.accessToken}`;
  }
  // Atlassian rotates refresh tokens: always keep the newest one.
  updateConnection('jira', { accessToken: r.body.access_token, refreshToken: r.body.refresh_token ?? c.refreshToken, expiresAt: Date.now() + (Number(r.body.expires_in) || 3600) * 1000 });
  return `Bearer ${r.body.access_token}`;
}

export const jiraApiBase = (c: Pick<JiraConn, 'cloudId'>) => `https://api.atlassian.com/ex/jira/${encodeURIComponent(c.cloudId)}/rest/api/3`;

/** Projects the connected account can create issues in (for the project picker). */
export async function jiraProjects(): Promise<Array<{ key: string; name: string }>> {
  const c = getConnection('jira');
  if (!c) return [];
  const r = await json(`${jiraApiBase(c)}/project/search?maxResults=100&orderBy=name`, { headers: { authorization: await jiraAuthHeader(), accept: 'application/json' } });
  return (r.body?.values ?? []).map((v: any) => ({ key: String(v.key), name: String(v.name) })).filter((v: any) => /^[A-Z][A-Z0-9_]+$/.test(v.key));
}
