/**
 * Encrypted storage for connected integrations (Slack, Discord, Jira).
 *
 * Secrets (OAuth tokens, client secrets, webhook URLs) are sealed with AES-256-GCM
 * under a key derived from SECRET_KEY before they touch the database, so a copied
 * litti.db file alone doesn't leak your Slack or Jira access.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSetting, setSetting, getDb } from '../chain/db.js';

export type Provider = 'slack' | 'discord' | 'jira';
export const PROVIDERS: Provider[] = ['slack', 'discord', 'jira'];

function key(): Buffer {
  const secret = process.env.SECRET_KEY;
  if (!secret) throw new Error('SECRET_KEY must be set to store integration credentials');
  return createHash('sha256').update(`litti-connect:${secret}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
}

export function unseal(sealed: string): string | null {
  try {
    const [v, iv, tag, body] = sealed.split('.');
    if (v !== 'v1') return null;
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}

function getSealed<T>(k: string): T | null {
  const raw = getSetting(k);
  if (!raw) return null;
  const plain = unseal(raw);
  try { return plain ? JSON.parse(plain) as T : null; } catch { return null; }
}
const putSealed = (k: string, v: unknown) => setSetting(k, seal(JSON.stringify(v)));
const remove = (k: string) => { getDb().prepare('DELETE FROM settings WHERE key = ?').run(k); };

/** The OAuth app an admin registered with the provider (one-time setup). */
export interface AppCreds { clientId: string; clientSecret: string }

const ENV_APP: Record<Provider, [string, string]> = {
  slack: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  discord: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
  jira: ['ATLASSIAN_CLIENT_ID', 'ATLASSIAN_CLIENT_SECRET'],
};

/** App credentials: environment first, then what was saved on the Integrations page. */
export function getAppCreds(p: Provider, env = process.env): (AppCreds & { source: 'env' | 'saved' }) | null {
  const [idVar, secretVar] = ENV_APP[p];
  if (env[idVar] && env[secretVar]) return { clientId: env[idVar]!, clientSecret: env[secretVar]!, source: 'env' };
  const saved = getSealed<AppCreds>(`connect:app:${p}`);
  return saved ? { ...saved, source: 'saved' } : null;
}
export const saveAppCreds = (p: Provider, c: AppCreds) => putSealed(`connect:app:${p}`, c);

/** A live connection. */
export interface SlackConn { kind: 'oauth' | 'webhook'; token?: string; channelId?: string; channelName?: string; team?: string; webhookUrl?: string }
export interface DiscordConn { webhookUrl: string; channelId?: string; guildName?: string; webhookName?: string; via: 'oauth' | 'webhook' }
export interface JiraConn {
  cloudId: string; siteUrl: string; siteName: string;
  accessToken: string; refreshToken?: string; expiresAt: number;
  projectKey?: string; projectName?: string; minTier?: number; doneTransition?: string;
  /** Set when connected through a Litti Connect service: token refreshes go through it. */
  broker?: string;
}
export type ConnFor<P extends Provider> = P extends 'slack' ? SlackConn : P extends 'discord' ? DiscordConn : JiraConn;

export function getConnection<P extends Provider>(p: P): (ConnFor<P> & { connectedAt: string; connectedBy: string }) | null {
  return getSealed(`connect:conn:${p}`);
}
export function saveConnection<P extends Provider>(p: P, c: ConnFor<P>, by: string): void {
  const prev = getConnection(p);
  putSealed(`connect:conn:${p}`, { ...c, connectedAt: prev && 'connectedAt' in prev ? prev.connectedAt : new Date().toISOString(), connectedBy: prev?.connectedBy ?? by });
  bump();
}
export function updateConnection<P extends Provider>(p: P, patch: Partial<ConnFor<P>>): void {
  const prev = getConnection(p);
  if (!prev) return;
  putSealed(`connect:conn:${p}`, { ...prev, ...patch });
  bump();
}
export function deleteConnection(p: Provider): void { remove(`connect:conn:${p}`); bump(); }

/** Changes whenever a connection changes, so the live notifier rebuilds. */
let version = 0;
const bump = () => { version++; };
export const connectionsVersion = () => version;

/**
 * OAuth `state`: signed, single-use, 10-minute nonce. Stops a third party from finishing a
 * connect flow they didn't start (e.g. linking your Litti to *their* Slack).
 */
export function issueState(p: Provider): string {
  const nonce = randomBytes(16).toString('base64url');
  const exp = Date.now() + 10 * 60 * 1000;
  setSetting(`connect:state:${nonce}`, `${p}:${exp}`);
  const sig = createHmac('sha256', key()).update(`${p}.${nonce}.${exp}`).digest('base64url');
  return `${nonce}.${exp}.${sig}`;
}

export function consumeState(p: Provider, state: unknown): boolean {
  if (typeof state !== 'string') return false;
  const [nonce, exp, sig] = state.split('.');
  if (!nonce || !exp || !sig) return false;
  const want = createHmac('sha256', key()).update(`${p}.${nonce}.${exp}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const stored = getSetting(`connect:state:${nonce}`);
  remove(`connect:state:${nonce}`); // single use
  return stored === `${p}:${exp}` && Number(exp) > Date.now();
}
