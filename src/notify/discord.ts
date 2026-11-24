/**
 * Discord notifier (channel webhook, rich embeds).
 *
 *  - Posts an approval embed whose title links to the review page.
 *  - Each later event posts a small follow-up embed.
 *  - When the action closes, the original embed is edited: colour and status change.
 *
 * Mentions are disabled on every message, so agent-supplied text can't ping @everyone.
 * Only metadata is sent — never the diff.
 */
import type { ActionCard, ActionEvent, Notifier, RiskAssessment } from '../types.js';
import { getSetting, setSetting } from '../chain/db.js';
import { TIER_LABEL, eventTitle, isFinal, oneLine, sendJson, type FetchLike } from './http.js';

export interface DiscordOptions {
  webhookUrl: string;
  fetchImpl?: FetchLike;
}

const TIER_COLOR = [0x2ecc71, 0xf5b942, 0xe67e22, 0xe74c3c];
const EVENT_COLOR: Record<ActionEvent['kind'], number> = {
  countersigned: 0x3498db, 'rubber-stamped': 0xe74c3c, approved: 0x2ecc71, 'execution-failed': 0x992d22,
};
const NO_PINGS = { parse: [] as string[] };

/** Is this a Discord webhook URL? Anything else is refused so a typo can't leak cards elsewhere. */
export function isDiscordWebhook(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)$/.test(u.hostname)
      && u.pathname.startsWith('/api/webhooks/');
  } catch { return false; }
}

interface DiscordRef { messageId: string; tier: number; reasons: string[]; required: number; url: string }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Embed for an approval card. With `final`, shows the closing status instead of the call to action. */
export function discordEmbed(card: ActionCard, ref: Omit<DiscordRef, 'messageId'>, final?: ActionEvent) {
  const lines = card.diff.split('\n').length;
  return {
    title: clip(final ? `${eventTitle(final.kind)}: ${oneLine(card.description, 200)}` : `🔒 Approval needed: ${oneLine(card.description, 200)}`, 256),
    url: ref.url,
    description: final
      ? clip(`Reviewed by ${final.approvers.join(', ')}${final.attentionScore !== undefined ? ` · attention ${final.attentionScore}/100` : ''}`, 4096)
      : `**${TIER_LABEL[ref.tier] ?? `Tier ${ref.tier}`}** — [Review in Litti](${ref.url}). Nothing runs until ${ref.required} reviewer(s) pass the comprehension check.`,
    color: final ? EVENT_COLOR[final.kind] : TIER_COLOR[ref.tier] ?? 0xe74c3c,
    fields: [
      { name: 'Action', value: clip(`${card.action} by ${oneLine(card.agent, 80)}`, 1024), inline: true },
      { name: 'Diff', value: `${lines} lines · reversible: ${card.reversible ? 'yes' : '**NO**'}`, inline: true },
      { name: 'Why', value: clip(ref.reasons.join(' · ') || '—', 1024) },
      { name: 'Paths', value: clip(card.touchedPaths.join(', ') || '—', 1024) },
    ],
    footer: { text: `Litti · action ${card.id}` },
    timestamp: new Date().toISOString(),
  };
}

export function discordNotifier(opts: DiscordOptions): Notifier {
  if (!isDiscordWebhook(opts.webhookUrl)) throw new Error('Discord notifier needs a https://discord.com/api/webhooks/... URL');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const hook = opts.webhookUrl.replace(/\/$/, '').split('?')[0];
  const inflight = new Map<string, Promise<unknown>>();
  const key = (id: string) => `notify:discord:${id}`;
  const load = (id: string): DiscordRef | null => {
    const raw = getSetting(key(id));
    try { return raw ? JSON.parse(raw) as DiscordRef : null; } catch { return null; }
  };

  const postMessage = async (message: string) => {
    await sendJson('Discord', fetchImpl, 'POST', hook, { username: 'Litti', content: clip(message, 2000), allowed_mentions: NO_PINGS });
  };

  return {
    postMessage,

    postCard(card: ActionCard, a: RiskAssessment, approvalUrl: string) {
      const ref = { tier: a.tier, reasons: a.reasons, required: a.requiredApprovers, url: approvalUrl };
      const p = (async () => {
        const r = await sendJson('Discord', fetchImpl, 'POST', `${hook}?wait=true`, {
          username: 'Litti', embeds: [discordEmbed(card, ref)], allowed_mentions: NO_PINGS,
        });
        if (r.ok && r.body?.id) setSetting(key(card.id), JSON.stringify({ ...ref, messageId: String(r.body.id) }));
      })();
      inflight.set(card.id, p);
      return p.finally(() => inflight.delete(card.id));
    },

    async postUpdate(event: ActionEvent) {
      await inflight.get(event.card.id)?.catch(() => {});
      const ref = load(event.card.id);
      await sendJson('Discord', fetchImpl, 'POST', hook, {
        username: 'Litti',
        embeds: [{ title: clip(`${eventTitle(event.kind)} — ${oneLine(event.card.description, 200)}`, 256), description: clip(event.message, 4096), color: EVENT_COLOR[event.kind], url: ref?.url }],
        allowed_mentions: NO_PINGS,
      });
      if (ref && isFinal(event.kind) && /^\d+$/.test(ref.messageId)) {
        await sendJson('Discord', fetchImpl, 'PATCH', `${hook}/messages/${ref.messageId}`, { embeds: [discordEmbed(event.card, ref, event)], allowed_mentions: NO_PINGS });
      }
    },
  };
}
