/** Notifier tests: Slack app, Discord, Jira and env wiring, against a fake fetch. */
import assert from 'node:assert/strict';
import { initDb } from '../src/chain/db.js';
import type { ActionCard, ActionEvent, RiskAssessment } from '../src/types.js';
import { slackNotifier } from '../src/notify/slack.js';
import { discordNotifier } from '../src/notify/discord.js';
import { jiraNotifier } from '../src/notify/jira.js';
import { integrationsFromEnv, multiNotifier } from '../src/notify/index.js';

initDb(':memory:');

interface Call { method: string; url: string; headers: Record<string, string>; body: any }
function fakeFetch(reply: (c: Call) => unknown) {
  const calls: Call[] = [];
  const impl = async (url: string, init: RequestInit) => {
    const c: Call = { method: String(init.method), url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    return new Response(JSON.stringify(reply(c) ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, impl };
}

const SECRET_LINE = 'const apiKey = "sk-super-secret-code-line";';
const card = (id: string): ActionCard => ({
  id, agent: 'coder-bot', action: 'migrate', description: 'Drop users table <!channel> @everyone',
  diff: `--- a/x.sql\n+++ b/x.sql\n@@ -1 +1 @@\n+${SECRET_LINE}\n+DROP TABLE users;`,
  diffHash: 'a'.repeat(64), touchedPaths: ['migrations/x.sql'], reversible: false, rollbackPlan: 'restore backup',
  timestamp: new Date().toISOString(),
});
const risk: RiskAssessment = { tier: 3, reasons: ['Destructive SQL'], requiredApprovers: 3 };
const event = (c: ActionCard, kind: ActionEvent['kind']): ActionEvent => ({
  kind, card: c, message: `${kind} on ${c.description}`, approvers: ['ana', 'bo', 'cy'], requiredApprovers: 3, attentionScore: 88,
});
const noDiff = (calls: Call[]) => calls.forEach(c => assert.ok(!JSON.stringify(c.body ?? '').includes('sk-super-secret'), `diff leaked to ${c.url}`));

let passed = 0;
async function step(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`  ✓ ${name}`); }

await step('slack: card with review button, thread replies, card closed in place', async () => {
  const f = fakeFetch(c => ({ ok: true, ts: '111.222', channel: 'C1', echo: c.url }));
  const n = slackNotifier({ token: 'xoxb-test', channel: '#reviews', fetchImpl: f.impl });
  const c = card('act_slack');
  await n.postCard(c, risk, 'https://litti.example/approve/act_slack');
  const post = f.calls[0];
  assert.equal(post.url, 'https://slack.com/api/chat.postMessage');
  assert.equal(post.headers.authorization, 'Bearer xoxb-test');
  const blocks = JSON.stringify(post.body.blocks);
  assert.ok(blocks.includes('https://litti.example/approve/act_slack'), 'review button links to page');
  assert.ok(!blocks.includes('<!channel>') && blocks.includes('&lt;!channel&gt;'), 'agent text is escaped');

  await n.postUpdate!(event(c, 'rubber-stamped'));
  assert.equal(f.calls[1].body.thread_ts, '111.222');
  assert.equal(f.calls[1].body.reply_broadcast, true);

  await n.postUpdate!(event(c, 'approved'));
  const update = f.calls.find(x => x.url.endsWith('chat.update'))!;
  assert.ok(update, 'card edited when approved');
  assert.ok(!JSON.stringify(update.body.blocks).includes('litti_review'), 'button removed after approval');
  noDiff(f.calls);
});

await step('slack: update before card ever posted falls back to a channel message', async () => {
  const f = fakeFetch(() => ({ ok: true, ts: '1.1' }));
  const n = slackNotifier({ token: 'xoxb-t', channel: 'C9', fetchImpl: f.impl });
  await n.postUpdate!(event(card('act_unknown'), 'countersigned'));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.thread_ts, undefined);
});

await step('discord: embed with link, no pings, original edited on approval', async () => {
  const f = fakeFetch(() => ({ id: '987654321' }));
  const hook = 'https://discord.com/api/webhooks/123/abc';
  const n = discordNotifier({ webhookUrl: hook, fetchImpl: f.impl });
  const c = card('act_discord');
  await n.postCard(c, risk, 'https://litti.example/approve/act_discord');
  assert.equal(f.calls[0].url, `${hook}?wait=true`);
  assert.deepEqual(f.calls[0].body.allowed_mentions, { parse: [] });
  assert.equal(f.calls[0].body.embeds[0].url, 'https://litti.example/approve/act_discord');

  await n.postUpdate!(event(c, 'approved'));
  const patch = f.calls.find(x => x.method === 'PATCH')!;
  assert.equal(patch.url, `${hook}/messages/987654321`);
  assert.ok(f.calls.every(x => x.body.allowed_mentions?.parse?.length === 0), 'every message disables mentions');
  noDiff(f.calls);
});

await step('discord: refuses non-Discord webhook URLs', async () => {
  assert.throws(() => discordNotifier({ webhookUrl: 'https://evil.example/api/webhooks/1/2' }));
  assert.throws(() => discordNotifier({ webhookUrl: 'http://discord.com/api/webhooks/1/2' }));
});

await step('jira cloud: issue with ADF + labels, comments, transition on approval', async () => {
  const f = fakeFetch(c => {
    if (c.url.endsWith('/rest/api/3/issue')) return { key: 'SEC-42' };
    if (c.url.endsWith('/transitions') && c.method === 'GET') return { transitions: [{ id: '31', name: 'Done' }] };
    return {};
  });
  const n = jiraNotifier({ baseUrl: 'https://acme.atlassian.net', projectKey: 'SEC', apiToken: 'tok', email: 'bot@acme.test', doneTransition: 'done', fetchImpl: f.impl });
  const c = card('act_jira');
  await n.postCard(c, risk, 'https://litti.example/approve/act_jira');
  const create = f.calls[0];
  assert.match(create.headers.authorization, /^Basic /);
  assert.equal(create.body.fields.project.key, 'SEC');
  assert.deepEqual(create.body.fields.labels, ['litti', 'litti-tier-3']);
  assert.equal(create.body.fields.description.type, 'doc');
  assert.ok(create.body.fields.summary.length <= 250);

  await n.postUpdate!(event(c, 'countersigned'));
  assert.equal(f.calls[1].url, 'https://acme.atlassian.net/rest/api/3/issue/SEC-42/comment');
  await n.postUpdate!(event(c, 'approved'));
  const t = f.calls.find(x => x.method === 'POST' && x.url.endsWith('/transitions'))!;
  assert.deepEqual(t.body, { transition: { id: '31' } });
  noDiff(f.calls);
});

await step('jira data center: bearer PAT + REST v2 plain text; low tiers skipped', async () => {
  const f = fakeFetch(() => ({ key: 'OPS-7' }));
  const n = jiraNotifier({ baseUrl: 'https://jira.acme.internal', projectKey: 'OPS', apiToken: 'pat', minTier: 2, fetchImpl: f.impl });
  await n.postCard(card('act_low'), { tier: 1, reasons: [], requiredApprovers: 1 }, 'https://x/approve/act_low');
  assert.equal(f.calls.length, 0, 'tier 1 below JIRA_MIN_TIER');
  await n.postUpdate!(event(card('act_low'), 'approved'));
  assert.equal(f.calls.length, 0, 'no issue → no comment');
  await n.postCard(card('act_dc'), risk, 'https://x/approve/act_dc');
  assert.equal(f.calls[0].url, 'https://jira.acme.internal/rest/api/2/issue');
  assert.equal(f.calls[0].headers.authorization, 'Bearer pat');
  assert.equal(typeof f.calls[0].body.fields.description, 'string');
});

await step('env: complete configs enable integrations, partial ones are skipped', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(integrationsFromEnv({}).length, 0);
    assert.equal(integrationsFromEnv({ SLACK_BOT_TOKEN: 'xoxb-1', SLACK_CHANNEL: 'C1', LITTI_DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/1/a', JIRA_BASE_URL: 'https://a.atlassian.net', JIRA_PROJECT_KEY: 'sec', JIRA_API_TOKEN: 't' }).length, 3);
    assert.equal(integrationsFromEnv({ SLACK_BOT_TOKEN: 'xoxb-1' }).length, 0);
    assert.equal(integrationsFromEnv({ LITTI_DISCORD_WEBHOOK: 'https://example.com/hook' }).length, 0);
    assert.equal(integrationsFromEnv({ JIRA_BASE_URL: 'http://jira.evil', JIRA_PROJECT_KEY: 'SEC', JIRA_API_TOKEN: 't' }).length, 0);
  } finally { console.warn = warn; }
});

await step('multi: plain notifiers get postMessage, rich ones get postUpdate, failures isolated', async () => {
  const got: string[] = [];
  const m = multiNotifier([
    { postCard() {}, postMessage: (s) => { got.push(`plain:${s}`); } },
    { postCard() {}, postMessage() {}, postUpdate: (e) => { got.push(`rich:${e.kind}`); } },
    { postCard() {}, postMessage() {}, postUpdate: () => { throw new Error('boom'); } },
  ]);
  await m.postUpdate!(event(card('act_multi'), 'countersigned'));
  assert.deepEqual(got.sort(), ['plain:countersigned on Drop users table <!channel> @everyone', 'rich:countersigned']);
});

await step('network failure never throws', async () => {
  const n = slackNotifier({ token: 'xoxb-x', channel: 'C', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  const err = console.error; console.error = () => {};
  try { await n.postCard(card('act_down'), risk, 'https://x'); await n.postUpdate!(event(card('act_down'), 'approved')); }
  finally { console.error = err; }
});

console.log(`\nnotify: ${passed} passed`);
