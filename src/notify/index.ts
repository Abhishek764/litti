/**
 * Notifiers tell the team when an action needs review, when a review is
 * blocked, and when an action ran. Delivery is best-effort: a failed
 * notification never blocks or fails an approval.
 *
 *  - console (always on): prints to the terminal
 *  - webhook (LITTI_NOTIFY_WEBHOOK): POSTs {text, content} as JSON, which
 *    Slack and Discord incoming webhooks both accept. Comma-separate several URLs.
 *  - Slack app (SLACK_BOT_TOKEN + SLACK_CHANNEL): Block Kit card, threaded updates.
 *  - Discord (LITTI_DISCORD_WEBHOOK): rich embeds, card edited when the action closes.
 *  - Jira (JIRA_BASE_URL + JIRA_PROJECT_KEY + JIRA_API_TOKEN): issue per risky action.
 */
import type { ActionCard, ActionEvent, Notifier, RiskAssessment } from '../types.js';
import { slackNotifier } from './slack.js';
import { discordNotifier, isDiscordWebhook } from './discord.js';
import { jiraNotifier } from './jira.js';
import { TIER_LABEL, safeUrl } from './http.js';

/** Human-readable approval card, shared by every notifier. */
export function formatCard(card: ActionCard, a: RiskAssessment, approvalUrl: string): string {
  const lines = card.diff.split('\n').length;
  return [
    `🔒 Approval needed — ${TIER_LABEL[a.tier]}`,
    `${card.action} by ${card.agent}: ${card.description}`,
    `Why: ${a.reasons.join(' · ')}`,
    `Diff: ${lines} lines · ${card.touchedPaths.join(', ') || 'no paths'} · reversible: ${card.reversible ? 'yes' : 'NO'}`,
    `Review: ${approvalUrl}`,
    `Nothing runs until ${a.requiredApprovers} reviewer(s) pass. Action id: ${card.id}`,
  ].join('\n');
}

/** Prints notifications to the terminal. */
export function consoleNotifier(): Notifier {
  return {
    postCard(card, a, url) { console.log(`\n🔑 [notify] ${formatCard(card, a, url).replace(/\n/g, '\n            ')}`); },
    postMessage(message) { console.log(`🔑 [notify] ${message}`); },
  };
}

/** POSTs notifications to an incoming-webhook URL (Slack, Discord, or your own endpoint). */
export function webhookNotifier(url: string): Notifier {
  const send = async (text: string) => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, content: text.slice(0, 2000), allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) console.error(`⚠️  Webhook notify failed: HTTP ${res.status}`);
    } catch (err) {
      console.error(`⚠️  Webhook notify failed: ${(err as Error).message}`);
    }
  };
  return {
    postCard: (card, a, approvalUrl) => send(formatCard(card, a, approvalUrl)),
    postMessage: (message) => send(message),
  };
}

/** Fan one notification out to several notifiers. */
export function multiNotifier(list: Notifier[]): Notifier {
  return {
    async postCard(card, a, url) { await Promise.allSettled(list.map(async n => n.postCard(card, a, url))); },
    async postMessage(message) { await Promise.allSettled(list.map(async n => n.postMessage(message))); },
    async postUpdate(event: ActionEvent) {
      await Promise.allSettled(list.map(async n => (n.postUpdate ? n.postUpdate(event) : n.postMessage(event.message))));
    },
  };
}

/** Slack, Discord and Jira notifiers from environment variables. Misconfiguration warns, never crashes. */
export function integrationsFromEnv(env = process.env): Notifier[] {
  const out: Notifier[] = [];
  if (env.SLACK_BOT_TOKEN || env.SLACK_CHANNEL) {
    if (!env.SLACK_BOT_TOKEN?.startsWith('xox') || !env.SLACK_CHANNEL) console.warn('⚠️  Slack: set both SLACK_BOT_TOKEN (xoxb-...) and SLACK_CHANNEL. Slack disabled.');
    else out.push(slackNotifier({ token: env.SLACK_BOT_TOKEN, channel: env.SLACK_CHANNEL }));
  }
  if (env.LITTI_DISCORD_WEBHOOK) {
    if (!isDiscordWebhook(env.LITTI_DISCORD_WEBHOOK)) console.warn('⚠️  LITTI_DISCORD_WEBHOOK must be a https://discord.com/api/webhooks/... URL. Discord disabled.');
    else out.push(discordNotifier({ webhookUrl: env.LITTI_DISCORD_WEBHOOK }));
  }
  if (env.JIRA_BASE_URL || env.JIRA_PROJECT_KEY || env.JIRA_API_TOKEN) {
    const base = safeUrl(env.JIRA_BASE_URL);
    const project = env.JIRA_PROJECT_KEY?.trim().toUpperCase();
    if (!base || !project || !/^[A-Z][A-Z0-9_]+$/.test(project) || !env.JIRA_API_TOKEN) {
      console.warn('⚠️  Jira: set JIRA_BASE_URL (https), JIRA_PROJECT_KEY and JIRA_API_TOKEN (+ JIRA_EMAIL for Jira Cloud). Jira disabled.');
    } else {
      const minTier = Number(env.JIRA_MIN_TIER ?? 2);
      out.push(jiraNotifier({
        baseUrl: base, projectKey: project, apiToken: env.JIRA_API_TOKEN, email: env.JIRA_EMAIL || undefined,
        issueType: env.JIRA_ISSUE_TYPE || undefined, doneTransition: env.JIRA_DONE_TRANSITION || undefined,
        minTier: Number.isInteger(minTier) && minTier >= 1 && minTier <= 3 ? minTier : 2,
      }));
    }
  }
  return out;
}

/** Console, any LITTI_NOTIFY_WEBHOOK webhooks, and the Slack / Discord / Jira integrations. */
export function notifierFromEnv(): Notifier {
  // Operator-set config only (never from requests). Still, accept http(s) URLs only.
  const hooks = (process.env.LITTI_NOTIFY_WEBHOOK || '').split(',').map(s => s.trim()).filter(u => {
    if (!u) return false;
    try { if (['http:', 'https:'].includes(new URL(u).protocol)) return true; } catch { /* invalid */ }
    console.warn(`⚠️  Ignoring LITTI_NOTIFY_WEBHOOK entry that is not an http(s) URL: ${u.slice(0, 60)}`);
    return false;
  });
  return multiNotifier([consoleNotifier(), ...hooks.map(webhookNotifier), ...integrationsFromEnv()]);
}
