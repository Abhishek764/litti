/**
 * Notifier backed by the Integrations page: whatever is connected right now gets the
 * approval cards. Rebuilt when a connection changes, so Connect/Disconnect take effect
 * without a restart.
 */
import type { ActionCard, ActionEvent, Notifier, RiskAssessment } from '../types.js';
import { slackNotifier } from '../notify/slack.js';
import { discordNotifier } from '../notify/discord.js';
import { jiraNotifier } from '../notify/jira.js';
import { multiNotifier, webhookNotifier } from '../notify/index.js';
import { connectionsVersion, getConnection } from './store.js';
import { jiraApiBase, jiraAuthHeader } from './providers.js';

/** Build notifiers for the current connections. */
export function connectedNotifiers(): Notifier[] {
  const out: Notifier[] = [];
  try {
    const s = getConnection('slack');
    if (s?.kind === 'oauth' && s.token && s.channelId) out.push(slackNotifier({ token: s.token, channel: s.channelId }));
    else if (s?.webhookUrl) out.push(webhookNotifier(s.webhookUrl));

    const d = getConnection('discord');
    if (d?.webhookUrl) out.push(discordNotifier({ webhookUrl: d.webhookUrl }));

    const j = getConnection('jira');
    if (j?.projectKey) {
      out.push(jiraNotifier({
        baseUrl: j.siteUrl, projectKey: j.projectKey, apiToken: '',
        minTier: j.minTier ?? 2, doneTransition: j.doneTransition || undefined,
        oauth: { apiBase: jiraApiBase(j), authHeader: jiraAuthHeader },
      }));
    }
  } catch (err) {
    console.error(`⚠️  Could not load connected integrations: ${(err as Error).message}`);
  }
  return out;
}

export function liveConnectedNotifier(): Notifier {
  let built = -1;
  let current: Notifier = multiNotifier([]);
  const now = () => {
    if (built !== connectionsVersion()) { current = multiNotifier(connectedNotifiers()); built = connectionsVersion(); }
    return current;
  };
  return {
    postCard: (card: ActionCard, a: RiskAssessment, url: string) => now().postCard(card, a, url),
    postMessage: (m: string) => now().postMessage(m),
    postUpdate: (e: ActionEvent) => now().postUpdate!(e),
  };
}
