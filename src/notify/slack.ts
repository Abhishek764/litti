/**
 * Slack app notifier (bot token, Block Kit).
 *
 *  - Posts an approval card with a "Review in Litti" button to SLACK_CHANNEL.
 *  - Every later event (countersign, rubber-stamp, approval) is a thread reply.
 *    Rubber-stamps are also broadcast to the channel.
 *  - When the action closes, the card is edited in place: button removed, status shown.
 *
 * Approving inside Slack is deliberately impossible: the button opens the review page,
 * where the comprehension check, timer and scroll checks run. Only metadata is sent — never the diff.
 *
 * Needs a Slack app with the `chat:write` scope, invited to the channel.
 */
import type { ActionCard, ActionEvent, Notifier, RiskAssessment } from '../types.js';
import { getSetting, setSetting } from '../chain/db.js';
import { TIER_LABEL, eventTitle, isFinal, oneLine, sendJson, type FetchLike } from './http.js';

export interface SlackOptions {
  token: string;
  channel: string;
  /** Override for tests or Slack Enterprise Grid proxies. */
  apiBase?: string;
  fetchImpl?: FetchLike;
}

interface SlackRef { channel: string; ts: string; tier: number; reasons: string[]; required: number; url: string }

/** Escape text for Slack mrkdwn so agent-supplied text can't inject <!channel> or links. */
export const slackEscape = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Block Kit layout for an approval card. `status` replaces the button once the action closes. */
export function slackBlocks(card: ActionCard, ref: Omit<SlackRef, 'channel' | 'ts'>, status?: string): unknown[] {
  const lines = card.diff.split('\n').length;
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: clip(`🔒 Approval needed — ${TIER_LABEL[ref.tier] ?? `Tier ${ref.tier}`}`, 150), emoji: true } },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: clip(`*${slackEscape(card.action)}* by \`${slackEscape(oneLine(card.agent, 80))}\`\n${slackEscape(oneLine(card.description, 500))}`, 3000) },
      fields: [
        { type: 'mrkdwn', text: clip(`*Why*\n${slackEscape(ref.reasons.join(' · ') || '—')}`, 2000) },
        { type: 'mrkdwn', text: clip(`*Paths*\n${slackEscape(card.touchedPaths.join(', ') || '—')}`, 2000) },
        { type: 'mrkdwn', text: `*Diff*\n${lines} lines · reversible: ${card.reversible ? 'yes' : '*NO*'}` },
        { type: 'mrkdwn', text: `*Reviewers needed*\n${ref.required}` },
      ],
    },
  ];
  if (status) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: clip(slackEscape(status), 3000) } });
  } else {
    blocks.push({
      type: 'actions',
      elements: [{ type: 'button', action_id: 'litti_review', style: 'primary', text: { type: 'plain_text', text: 'Review in Litti' }, url: ref.url }],
    });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Action \`${slackEscape(card.id)}\` · nothing runs until ${ref.required} reviewer(s) pass the comprehension check` }] });
  return blocks;
}

export function slackNotifier(opts: SlackOptions): Notifier {
  const api = (opts.apiBase ?? 'https://slack.com/api').replace(/\/$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const auth = { authorization: `Bearer ${opts.token}` };
  const inflight = new Map<string, Promise<unknown>>();
  const key = (id: string) => `notify:slack:${id}`;

  const call = async (method: string, body: Record<string, unknown>) => {
    const r = await sendJson('Slack', fetchImpl, 'POST', `${api}/${method}`, body, auth);
    // Slack answers HTTP 200 with {ok:false,error} on failure. The error code is safe to log.
    if (r.ok && r.body && r.body.ok === false) console.error(`⚠️  Slack ${method} failed: ${String(r.body.error).slice(0, 60)}`);
    return r.ok && r.body?.ok ? r.body : null;
  };

  const load = (id: string): SlackRef | null => {
    const raw = getSetting(key(id));
    try { return raw ? JSON.parse(raw) as SlackRef : null; } catch { return null; }
  };

  const postMessage = async (message: string) => {
    await call('chat.postMessage', { channel: opts.channel, text: slackEscape(message.slice(0, 3000)) });
  };

  return {
    postMessage,

    postCard(card: ActionCard, a: RiskAssessment, approvalUrl: string) {
      const ref = { tier: a.tier, reasons: a.reasons, required: a.requiredApprovers, url: approvalUrl };
      const p = (async () => {
        const res = await call('chat.postMessage', {
          channel: opts.channel,
          text: oneLine(`🔒 Approval needed (${TIER_LABEL[a.tier]}): ${card.description}`, 300),
          blocks: slackBlocks(card, ref),
          unfurl_links: false,
        });
        if (res?.ts) setSetting(key(card.id), JSON.stringify({ ...ref, channel: res.channel ?? opts.channel, ts: res.ts }));
      })();
      inflight.set(card.id, p);
      return p.finally(() => inflight.delete(card.id));
    },

    async postUpdate(event: ActionEvent) {
      await inflight.get(event.card.id)?.catch(() => {});
      const ref = load(event.card.id);
      if (!ref) { await postMessage(event.message); return; }
      await call('chat.postMessage', {
        channel: ref.channel,
        thread_ts: ref.ts,
        reply_broadcast: event.kind === 'rubber-stamped',
        text: slackEscape(event.message.slice(0, 3000)),
      });
      if (isFinal(event.kind)) {
        const status = `${eventTitle(event.kind)} · reviewed by ${event.approvers.join(', ')}${event.attentionScore !== undefined ? ` · attention ${event.attentionScore}/100` : ''}`;
        await call('chat.update', { channel: ref.channel, ts: ref.ts, text: oneLine(status, 300), blocks: slackBlocks(event.card, ref, status) });
      }
    },
  };
}
