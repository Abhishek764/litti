/**
 * Notifiers tell the team when an action needs review, when a review is
 * blocked, and when an action ran. Delivery is best-effort: a failed
 * notification never blocks or fails an approval.
 *
 *  - console (always on): prints to the terminal
 *  - webhook (LITTI_NOTIFY_WEBHOOK): POSTs {text, content} as JSON, which
 *    Slack and Discord incoming webhooks both accept. Comma-separate several URLs.
 */
import type { ActionCard, Notifier, RiskAssessment } from '../types.js';

const TIER_LABEL = ['🟢 Tier 0 · auto', '🟡 Tier 1 · 1 reviewer', '🟠 Tier 2 · 2 reviewers', '🔴 Tier 3 · 3 reviewers'];

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
        body: JSON.stringify({ text, content: text.slice(0, 2000) }),
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
    async postCard(card, a, url) { await Promise.allSettled(list.map(n => Promise.resolve(n.postCard(card, a, url)))); },
    async postMessage(message) { await Promise.allSettled(list.map(n => Promise.resolve(n.postMessage(message)))); },
  };
}

/** Console plus any webhooks configured in LITTI_NOTIFY_WEBHOOK. */
export function notifierFromEnv(): Notifier {
  // Operator-set config only (never from requests). Still, accept http(s) URLs only.
  const hooks = (process.env.LITTI_NOTIFY_WEBHOOK || '').split(',').map(s => s.trim()).filter(u => {
    if (!u) return false;
    try { if (['http:', 'https:'].includes(new URL(u).protocol)) return true; } catch { /* invalid */ }
    console.warn(`⚠️  Ignoring LITTI_NOTIFY_WEBHOOK entry that is not an http(s) URL: ${u.slice(0, 60)}`);
    return false;
  });
  return multiNotifier([consoleNotifier(), ...hooks.map(webhookNotifier)]);
}
