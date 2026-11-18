/** One-click Connect via Litti Connect (broker): full round trip and the attacks it must refuse. */
import assert from 'node:assert/strict';
process.env.SECRET_KEY = 'broker-test-secret-'.repeat(3);
process.env.LITTI_CONNECT_BROKER = 'https://connect.litti.test';
delete process.env.LITTI_API_KEY;
import { initDb, getDb } from '../src/chain/db.js';
import { buildServer, setNotifier } from '../src/approval/server.js';
import { getConnection, updateConnection } from '../src/connect/store.js';
import { setConnectFetch, jiraAuthHeader } from '../src/connect/providers.js';
import { buildBroker, returnAllowed } from '../src/broker/server.js';

initDb(':memory:');
setNotifier(null);
const litti = buildServer();
const broker = buildBroker({
  publicUrl: 'https://connect.litti.test',
  secret: 'broker-hmac-secret-'.repeat(3),
  apps: {
    slack: { clientId: 'b-slack', clientSecret: 'b-slack-secret' },
    discord: { clientId: 'b-discord', clientSecret: 'b-discord-secret' },
    jira: { clientId: 'b-jira', clientSecret: 'b-jira-secret' },
  },
});

let replies: Record<string, unknown> = {};
const calls: Array<{ url: string; body: string }> = [];
setConnectFetch(async (url, init) => {
  calls.push({ url, body: String(init.body ?? '') });
  // The Litti side refreshes Jira through the broker: route that into the broker app.
  if (url.startsWith('https://connect.litti.test/')) {
    const r = await broker.inject({ method: 'POST', url: url.replace('https://connect.litti.test', ''), headers: { 'content-type': 'application/json' }, payload: String(init.body) });
    return new Response(r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } });
  }
  const k = Object.keys(replies).find(x => url.startsWith(x));
  return new Response(JSON.stringify(k ? replies[k] : {}), { status: k ? 200 : 404 });
});

let passed = 0;
async function step(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`  ✓ ${name}`); }

/** Click Connect in Litti → broker /start → provider → broker /callback → POST back to Litti. */
async function connect(p: string, opts: { tamperConn?: (c: any) => any; providerError?: string } = {}) {
  const start = await litti.inject({ method: 'GET', url: `/connect/${p}`, headers: { host: '127.0.0.1:3847' } });
  const toBroker = new URL(start.headers.location as string);
  assert.equal(toBroker.origin, 'https://connect.litti.test');
  const s = await broker.inject({ method: 'GET', url: toBroker.pathname + toBroker.search });
  assert.equal(s.statusCode, 302, s.body);
  const toProvider = new URL(s.headers.location as string);
  assert.equal(toProvider.searchParams.get('redirect_uri'), `https://connect.litti.test/callback/${p}`);
  const bstate = toProvider.searchParams.get('state')!;
  const cbq = opts.providerError ? `error=${opts.providerError}` : 'code=good-code';
  const cb = await broker.inject({ method: 'GET', url: `/callback/${p}?${cbq}&state=${encodeURIComponent(bstate)}` });
  assert.equal(cb.statusCode, 200);
  const action = cb.body.match(/action="([^"]+)"/)![1].replace(/&amp;/g, '&');
  const fields: Record<string, string> = {};
  for (const m of cb.body.matchAll(/name="([^"]+)" value="([^"]*)"/g)) fields[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  if (opts.tamperConn && fields.conn) fields.conn = JSON.stringify(opts.tamperConn(JSON.parse(fields.conn)));
  const done = await litti.inject({
    method: 'POST', url: new URL(action).pathname,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(fields).toString(),
  });
  return { action, fields, done, location: String(done.headers.location) };
}

try {
  await step('page shows one Connect button per service when Litti Connect is available', async () => {
    const s = (await litti.inject({ method: 'GET', url: '/api/integrations' })).json();
    for (const p of ['slack', 'discord', 'jira']) assert.equal(s.providers[p].oneClick, true, p);
    const html = (await litti.inject({ method: 'GET', url: '/integrations' })).body;
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
  });

  await step('Slack: one click → channel picked on Slack → connected', async () => {
    replies = { 'https://slack.com/api/oauth.v2.access': { ok: true, access_token: 'xoxb-via-broker', team: { name: 'Acme' }, incoming_webhook: { channel: 'reviews', channel_id: 'C42', url: 'https://hooks.slack.com/services/T/B/x' } } };
    const r = await connect('slack');
    assert.equal(r.action, 'http://127.0.0.1:3847/connect/slack/done');
    assert.equal(r.done.statusCode, 303);
    assert.equal(r.location, '/integrations?connected=slack');
    assert.equal(getConnection('slack')!.token, 'xoxb-via-broker');
    assert.ok(calls.some(c => c.url.includes('oauth.v2.access') && c.body.includes('b-slack-secret')), 'broker used its own app secret');
  });

  await step('Discord: one click → webhook saved', async () => {
    replies = { 'https://discord.com/api/oauth2/token': { webhook: { id: '7', token: 't', url: 'https://discord.com/api/webhooks/7/t', channel_id: '1' }, guild: { name: 'HQ' } } };
    const r = await connect('discord');
    assert.equal(r.location, '/integrations?connected=discord');
    assert.equal(getConnection('discord')!.webhookUrl, 'https://discord.com/api/webhooks/7/t');
  });

  await step('Jira: one click → connected; token refresh goes through Litti Connect', async () => {
    replies = {
      'https://auth.atlassian.com/oauth/token': { access_token: 'at-1', refresh_token: 'rt-1-long-enough', expires_in: 3600 },
      'https://api.atlassian.com/oauth/token/accessible-resources': [{ id: 'cloud-9', url: 'https://acme.atlassian.net', name: 'acme', scopes: ['read:jira-work'] }],
    };
    const r = await connect('jira');
    assert.equal(r.location, '/integrations?connected=jira');
    const c = getConnection('jira')!;
    assert.equal(c.broker, 'https://connect.litti.test', 'broker URL comes from our config');
    updateConnection('jira', { expiresAt: Date.now() - 1 });
    replies['https://auth.atlassian.com/oauth/token'] = { access_token: 'at-2', refresh_token: 'rt-2-long-enough', expires_in: 3600 };
    assert.equal(await jiraAuthHeader(), 'Bearer at-2');
    assert.equal(getConnection('jira')!.refreshToken, 'rt-2-long-enough');
    assert.ok(calls.some(x => x.url === 'https://auth.atlassian.com/oauth/token' && x.body.includes('b-jira-secret') && x.body.includes('rt-1-long-enough')));
  });

  await step('tokens never stored in plain text', () => {
    const rows = JSON.stringify(getDb().prepare('SELECT value FROM settings').all());
    assert.ok(!rows.includes('xoxb-via-broker') && !rows.includes('at-2') && !rows.includes('discord.com/api/webhooks'));
  });

  await step('returned data is checked: junk, wrong shapes and a smuggled broker URL are refused or ignored', async () => {
    replies = { 'https://slack.com/api/oauth.v2.access': { ok: true, access_token: 'xoxb-2', incoming_webhook: { channel: 'x', channel_id: 'C1' } } };
    const bad = await connect('slack', { tamperConn: c => ({ ...c, token: 'not-a-slack-token' }) });
    assert.match(bad.location, /error=/);
    replies = {
      'https://auth.atlassian.com/oauth/token': { access_token: 'at-3', refresh_token: 'rt-3-long-enough', expires_in: 3600 },
      'https://api.atlassian.com/oauth/token/accessible-resources': [{ id: 'c', url: 'https://acme.atlassian.net', name: 'acme' }],
    };
    await connect('jira', { tamperConn: c => ({ ...c, broker: 'https://evil.test' }) });
    assert.equal(getConnection('jira')!.broker, 'https://connect.litti.test');
  });

  await step('user clicks Cancel on the provider: error shown, nothing changes', async () => {
    const before = getConnection('discord')!.webhookUrl;
    const r = await connect('discord', { providerError: 'access_denied' });
    assert.match(r.location, /error=Discord/);
    assert.equal(getConnection('discord')!.webhookUrl, before);
  });

  await step('replayed or forged results are refused', async () => {
    replies = { 'https://slack.com/api/oauth.v2.access': { ok: true, access_token: 'xoxb-3', incoming_webhook: { channel: 'x', channel_id: 'C9' } } };
    const r = await connect('slack');
    assert.equal(r.location, '/integrations?connected=slack');
    const replay = await litti.inject({ method: 'POST', url: '/connect/slack/done', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(r.fields).toString() });
    assert.match(String(replay.headers.location), /expired/);
    const forged = await litti.inject({ method: 'POST', url: '/connect/slack/done', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ state: 'x.1.y', conn: '{}' }).toString() });
    assert.match(String(forged.headers.location), /error=/);
  });

  await step('broker only returns to loopback or approved origins; tampered state refused', async () => {
    assert.equal(returnAllowed('http://127.0.0.1:3847/connect/slack/done', 'slack'), true);
    assert.equal(returnAllowed('http://localhost:9999/connect/jira/done', 'jira'), true);
    assert.equal(returnAllowed('https://evil.test/connect/slack/done', 'slack'), false);
    assert.equal(returnAllowed('http://127.0.0.1:3847/connect/slack/done', 'discord'), false, 'path must match the provider');
    assert.equal(returnAllowed('http://127.0.0.1:3847/connect/slack/done?x=1', 'slack'), false);
    assert.equal(returnAllowed('https://litti.acme.test/connect/slack/done', 'slack', ['https://litti.acme.test']), true);
    const bad = await broker.inject({ method: 'GET', url: '/start/slack?state=abcdefghijk&return=' + encodeURIComponent('https://evil.test/connect/slack/done') });
    assert.equal(bad.statusCode, 400);
    const cb = await broker.inject({ method: 'GET', url: '/callback/slack?code=x&state=eyJwIjoic2xhY2sifQ.forged' });
    assert.equal(cb.statusCode, 400);
  });

  await step('the broker refresh endpoint validates input', async () => {
    assert.equal((await broker.inject({ method: 'POST', url: '/refresh/jira', payload: {} })).statusCode, 400);
    replies['https://auth.atlassian.com/oauth/token'] = {};
    const r = await broker.inject({ method: 'POST', url: '/refresh/jira', payload: { refreshToken: 'bad-refresh-token' } });
    assert.ok(r.statusCode >= 400);
  });

  await step('without Litti Connect or an own app, the button explains instead of failing', async () => {
    process.env.LITTI_CONNECT_BROKER = 'off';
    try {
      const s = (await litti.inject({ method: 'GET', url: '/api/integrations' })).json();
      assert.equal(s.providers.slack.oneClick, false);
      assert.match(String((await litti.inject({ method: 'GET', url: '/connect/slack' })).headers.location), /One-click/);
    } finally { process.env.LITTI_CONNECT_BROKER = 'https://connect.litti.test'; }
  });
} finally {
  setConnectFetch(null);
  await litti.close();
  await broker.close();
}
console.log(`\nbroker: ${passed} passed`);
