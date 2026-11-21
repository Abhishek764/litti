/** Connect-button tests: encrypted store, OAuth state, admin guard, Slack/Discord/Jira flows, live notifier. */
import assert from 'node:assert/strict';
process.env.SECRET_KEY = 'connect-test-secret-'.repeat(3);
delete process.env.LITTI_API_KEY;
delete process.env.LITTI_IDENTITY_HEADER;
import { initDb, getDb } from '../src/chain/db.js';
import { buildServer, setNotifier } from '../src/approval/server.js';
import { seal, unseal, issueState, consumeState, getConnection, saveConnection, updateConnection } from '../src/connect/store.js';
import { setConnectFetch, jiraAuthHeader } from '../src/connect/providers.js';
import { adminIdentity } from '../src/connect/routes.js';
import { liveConnectedNotifier } from '../src/connect/notifier.js';

initDb(':memory:');
setNotifier(null);
const app = buildServer();
const ui = { 'x-litti-ui': '1' };

const calls: Array<{ url: string; body: string }> = [];
let replies: Record<string, unknown> = {};
const fake = async (url: string, init: RequestInit) => {
  calls.push({ url, body: String(init.body ?? '') });
  const key = Object.keys(replies).find(k => url.startsWith(k));
  return new Response(JSON.stringify(key ? replies[key] : {}), { status: key ? 200 : 404, headers: { 'content-type': 'application/json' } });
};
setConnectFetch(fake);

let passed = 0;
async function step(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`  ✓ ${name}`); }

const stateFrom = (location: string) => new URL(location).searchParams.get('state')!;

try {
  await step('seal/unseal: round trip, tamper-proof, bound to SECRET_KEY', () => {
    const s = seal('xoxb-secret');
    assert.equal(unseal(s), 'xoxb-secret');
    assert.ok(!s.includes('xoxb'));
    assert.equal(unseal(s.slice(0, -2) + 'AA'), null);
    const prev = process.env.SECRET_KEY;
    process.env.SECRET_KEY = 'another-secret-key-that-is-long-enough-123';
    assert.equal(unseal(s), null);
    process.env.SECRET_KEY = prev;
  });

  await step('OAuth state: single use, provider-bound, unforgeable', () => {
    const s = issueState('slack');
    assert.equal(consumeState('discord', s), false, 'wrong provider');
    const s2 = issueState('slack');
    assert.equal(consumeState('slack', s2), true);
    assert.equal(consumeState('slack', s2), false, 'single use');
    assert.equal(consumeState('slack', s2.replace(/.$/, 'x')), false);
    assert.equal(consumeState('slack', undefined), false);
  });

  await step('admin guard: local open; production needs SSO + LITTI_ADMINS', () => {
    assert.equal(adminIdentity({}, {}).ok, true);
    assert.equal(adminIdentity({}, { LITTI_API_KEY: 'k' }).ok, false);
    const env = { LITTI_API_KEY: 'k', LITTI_IDENTITY_HEADER: 'x-email', LITTI_ADMINS: 'boss@acme.test' };
    assert.equal(adminIdentity({ 'x-email': 'dev@acme.test' }, env).ok, false);
    assert.equal(adminIdentity({ 'x-email': 'Boss@acme.test' }, env).ok, true);
  });

  await step('page renders and its script parses; status lists redirect URLs', async () => {
    const page = await app.inject({ method: 'GET', url: '/integrations' });
    assert.equal(page.statusCode, 200);
    for (const m of page.body.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
    const s = (await app.inject({ method: 'GET', url: '/api/integrations', headers: { host: 'localhost:4000' } })).json();
    assert.equal(s.redirectUris.jira, 'http://localhost:4000/connect/jira/callback');
    assert.equal(s.providers.slack.connected, false);
  });

  await step('one-time app setup: needs the UI header, validated, never echoed back', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/api/integrations/slack/app', payload: { clientId: '123.456', clientSecret: 'shh-secret-1' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/integrations/slack/app', headers: ui, payload: { clientId: '', clientSecret: 'x' } })).statusCode, 400);
    for (const p of ['slack', 'discord', 'jira']) {
      const r = await app.inject({ method: 'POST', url: `/api/integrations/${p}/app`, headers: ui, payload: { clientId: `${p}-client-1`, clientSecret: `${p}-very-secret` } });
      assert.equal(r.statusCode, 200);
    }
    const s = (await app.inject({ method: 'GET', url: '/api/integrations' })).body;
    assert.ok(!s.includes('very-secret'), 'secret never returned');
    assert.ok(s.includes('"appReady":true'));
  });

  await step('Connect button redirects to the provider with client id, redirect URL and state', async () => {
    const r = await app.inject({ method: 'GET', url: '/connect/slack', headers: { host: 'localhost:4000' } });
    assert.equal(r.statusCode, 302);
    const u = new URL(r.headers.location as string);
    assert.equal(u.origin + u.pathname, 'https://slack.com/oauth/v2/authorize');
    assert.equal(u.searchParams.get('client_id'), 'slack-client-1');
    assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:4000/connect/slack/callback');
    assert.match(u.searchParams.get('scope')!, /chat:write/);
    const j = new URL((await app.inject({ method: 'GET', url: '/connect/jira' })).headers.location as string);
    assert.equal(j.hostname, 'auth.atlassian.com');
    assert.match(j.searchParams.get('scope')!, /offline_access/);
  });

  await step('callback with a bad or replayed state is refused', async () => {
    const r = await app.inject({ method: 'GET', url: '/connect/slack/callback?code=abc&state=forged.1.x' });
    assert.match(String(r.headers.location), /error=/);
    assert.equal(getConnection('slack'), null);
  });

  await step('Slack: callback stores bot token + chosen channel, encrypted at rest', async () => {
    replies = { 'https://slack.com/api/oauth.v2.access': { ok: true, access_token: 'xoxb-live-token', team: { name: 'Acme' }, incoming_webhook: { channel: 'reviews', channel_id: 'C123', url: 'https://hooks.slack.com/services/T/B/x' } } };
    const loc = (await app.inject({ method: 'GET', url: '/connect/slack' })).headers.location as string;
    const r = await app.inject({ method: 'GET', url: `/connect/slack/callback?code=good&state=${encodeURIComponent(stateFrom(loc))}` });
    assert.equal(r.headers.location, '/integrations?connected=slack');
    const c = getConnection('slack')!;
    assert.equal(c.token, 'xoxb-live-token');
    assert.equal(c.channelId, 'C123');
    const rows = JSON.stringify(getDb().prepare('SELECT value FROM settings').all());
    assert.ok(!rows.includes('xoxb-live-token') && !rows.includes('very-secret'), 'no plaintext secrets in the database');
    const s = (await app.inject({ method: 'GET', url: '/api/integrations' })).body;
    assert.ok(!s.includes('xoxb') && !s.includes('hooks.slack.com'), 'status hides tokens and webhook URLs');
    assert.match(s, /"channel":"reviews"/);
  });

  await step('provider error (user clicked Cancel) is shown, nothing saved', async () => {
    const loc = (await app.inject({ method: 'GET', url: '/connect/discord' })).headers.location as string;
    const r = await app.inject({ method: 'GET', url: `/connect/discord/callback?error=access_denied&state=${encodeURIComponent(stateFrom(loc))}` });
    assert.match(String(r.headers.location), /error=Discord/);
    assert.equal(getConnection('discord'), null);
  });

  await step('Discord: OAuth returns a webhook; quick connect validates pasted links', async () => {
    replies = { 'https://discord.com/api/oauth2/token': { access_token: 'a', webhook: { id: '111', token: 'tok', url: 'https://discord.com/api/webhooks/111/tok', channel_id: '9' }, guild: { name: 'Acme HQ' } } };
    const loc = (await app.inject({ method: 'GET', url: '/connect/discord' })).headers.location as string;
    await app.inject({ method: 'GET', url: `/connect/discord/callback?code=c&state=${encodeURIComponent(stateFrom(loc))}` });
    assert.equal(getConnection('discord')!.webhookUrl, 'https://discord.com/api/webhooks/111/tok');
    assert.equal((await app.inject({ method: 'POST', url: '/api/integrations/discord/webhook', headers: ui, payload: { url: 'https://evil.test/api/webhooks/1/2' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/integrations/slack/webhook', headers: ui, payload: { url: 'https://example.com/x' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/integrations/discord/webhook', headers: ui, payload: { url: 'https://discord.com/api/webhooks/222/abc' } })).statusCode, 200);
    assert.equal(getConnection('discord')!.via, 'webhook');
  });

  await step('Jira: site found, projects listed, project saved; tokens refresh and rotate', async () => {
    replies = {
      'https://auth.atlassian.com/oauth/token': { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 },
      'https://api.atlassian.com/oauth/token/accessible-resources': [{ id: 'cloud-1', url: 'https://acme.atlassian.net', name: 'acme', scopes: ['read:jira-work'] }],
      'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/project/search': { values: [{ key: 'SEC', name: 'Security' }, { key: 'OPS', name: 'Ops' }] },
    };
    const loc = (await app.inject({ method: 'GET', url: '/connect/jira' })).headers.location as string;
    await app.inject({ method: 'GET', url: `/connect/jira/callback?code=c&state=${encodeURIComponent(stateFrom(loc))}` });
    const c = getConnection('jira')!;
    assert.equal(c.cloudId, 'cloud-1');
    const projects = (await app.inject({ method: 'GET', url: '/api/integrations/jira/projects' })).json().projects;
    assert.deepEqual(projects.map((p: any) => p.key), ['SEC', 'OPS']);
    assert.equal((await app.inject({ method: 'POST', url: '/api/integrations/jira/settings', headers: ui, payload: { projectKey: 'SEC', projectName: 'Security', minTier: 2 } })).statusCode, 200);
    assert.equal(getConnection('jira')!.projectKey, 'SEC');

    assert.equal(await jiraAuthHeader(), 'Bearer at-1', 'fresh token used as is');
    updateConnection('jira', { expiresAt: Date.now() - 1000 });
    replies['https://auth.atlassian.com/oauth/token'] = { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 };
    assert.equal(await jiraAuthHeader(), 'Bearer at-2');
    assert.equal(getConnection('jira')!.refreshToken, 'rt-2', 'rotated refresh token kept');
    assert.match(calls.filter(x => x.url === 'https://auth.atlassian.com/oauth/token').pop()!.body, /"refresh_token":"rt-1"/);
  });

  await step('live notifier: connected services get cards without a restart; disconnect stops them', async () => {
    const realFetch = globalThis.fetch;
    const hits: string[] = [];
    globalThis.fetch = (async (url: string) => { hits.push(String(url)); return new Response('{"ok":true,"ts":"1","id":"5","key":"SEC-1"}', { status: 200 }); }) as typeof fetch;
    try {
      const n = liveConnectedNotifier();
      const card = { id: 'act_1', agent: 'bot', action: 'deploy', description: 'Ship it', diff: '+x', diffHash: 'h'.repeat(64), touchedPaths: ['a'], reversible: false, rollbackPlan: '', timestamp: '' } as any;
      await n.postCard(card, { tier: 3, reasons: ['r'], requiredApprovers: 3 }, 'https://litti/approve/act_1');
      assert.ok(hits.some(h => h.includes('slack.com/api/chat.postMessage')), 'slack');
      assert.ok(hits.some(h => h.startsWith('https://discord.com/api/webhooks/222/abc')), 'discord');
      assert.ok(hits.some(h => h.includes('/ex/jira/cloud-1/rest/api/3/issue')), 'jira');
      for (const p of ['slack', 'discord', 'jira']) await app.inject({ method: 'POST', url: `/api/integrations/${p}/disconnect`, headers: ui });
      hits.length = 0;
      await n.postCard({ ...card, id: 'act_2' }, { tier: 3, reasons: [], requiredApprovers: 3 }, 'https://x');
      assert.equal(hits.length, 0, 'nothing sent after disconnect');
    } finally { globalThis.fetch = realFetch; }
  });

  await step('production without admin identity: page and API refuse', async () => {
    process.env.LITTI_API_KEY = 'k';
    try {
      assert.equal((await app.inject({ method: 'GET', url: '/integrations' })).statusCode, 403);
      assert.equal((await app.inject({ method: 'GET', url: '/api/integrations' })).statusCode, 403);
      assert.match(String((await app.inject({ method: 'GET', url: '/connect/slack' })).headers.location), /error=/);
    } finally { delete process.env.LITTI_API_KEY; }
  });

  void saveConnection;
} finally {
  setConnectFetch(null);
  await app.close();
}
console.log(`\nconnect: ${passed} passed`);
