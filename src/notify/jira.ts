/**
 * Jira notifier: every action at or above JIRA_MIN_TIER becomes a Jira issue.
 *
 *  - Issue: summary, risk reasons, paths, review link, labels `litti` + `litti-tier-N`.
 *  - Countersigns, rubber-stamps and the final decision become issue comments.
 *  - On approval the issue moves through JIRA_DONE_TRANSITION (e.g. "Done"), if set.
 *
 * Jira Cloud: JIRA_EMAIL + JIRA_API_TOKEN (basic auth, REST v3, rich-text ADF).
 * Jira Data Center / Server: JIRA_API_TOKEN only (personal access token, REST v2).
 * Only metadata is sent — never the diff.
 */
import type { ActionCard, ActionEvent, Notifier, RiskAssessment } from '../types.js';
import { getSetting, setSetting } from '../chain/db.js';
import { TIER_LABEL, eventTitle, isFinal, oneLine, sendJson, type FetchLike } from './http.js';

export interface JiraOptions {
  baseUrl: string;
  projectKey: string;
  apiToken: string;
  /** Set for Jira Cloud; omit for Data Center personal access tokens. */
  email?: string;
  issueType?: string;
  /** Only open issues for actions at this tier or higher (default 2). */
  minTier?: number;
  /** Workflow transition to run on approval, matched by name (case-insensitive). */
  doneTransition?: string;
  fetchImpl?: FetchLike;
  /**
   * OAuth (Connect button): full REST base, e.g. https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3,
   * and a function returning a fresh "Bearer …" header. Overrides baseUrl/apiToken/email.
   */
  oauth?: { apiBase: string; authHeader: () => Promise<string> };
}

/** Atlassian Document Format: one paragraph per line, plain text only (no markup injection). */
export function adf(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: text.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
  };
}

export function jiraDescription(card: ActionCard, a: RiskAssessment, url: string): string {
  return [
    `Litti approval request — ${TIER_LABEL[a.tier] ?? `Tier ${a.tier}`}`,
    `Action: ${card.action} by ${oneLine(card.agent, 80)}`,
    `Description: ${card.description}`,
    `Why: ${a.reasons.join(' · ') || '—'}`,
    `Paths: ${card.touchedPaths.join(', ') || '—'}`,
    `Diff: ${card.diff.split('\n').length} lines · sha256 ${card.diffHash.slice(0, 16)}… · reversible: ${card.reversible ? 'yes' : 'NO'}`,
    `Rollback plan: ${card.rollbackPlan || '—'}`,
    `Review: ${url}`,
    `Nothing runs until ${a.requiredApprovers} reviewer(s) pass the comprehension check in Litti. Approving this issue in Jira does NOT approve the action.`,
    `Litti action id: ${card.id}`,
  ].join('\n');
}

export function jiraNotifier(opts: JiraOptions): Notifier {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, '');
  const cloud = Boolean(opts.email || opts.oauth);
  const api = opts.oauth ? opts.oauth.apiBase.replace(/\/$/, '') : `${base}/rest/api/${cloud ? 3 : 2}`;
  const staticAuth = opts.email
    ? `Basic ${Buffer.from(`${opts.email}:${opts.apiToken}`).toString('base64')}`
    : `Bearer ${opts.apiToken}`;
  // Resolved per call so OAuth tokens can refresh.
  const auth = async () => ({ authorization: opts.oauth ? await opts.oauth.authHeader() : staticAuth });
  const minTier = opts.minTier ?? 2;
  const body = (text: string) => (cloud ? adf(text) : text);
  const inflight = new Map<string, Promise<unknown>>();
  const key = (id: string) => `notify:jira:${id}`;
  const issueKey = (id: string) => {
    const k = getSetting(key(id));
    return k && /^[A-Z][A-Z0-9_]+-\d+$/.test(k) ? k : null;
  };

  const comment = async (k: string, text: string) => sendJson('Jira', fetchImpl, 'POST', `${api}/issue/${k}/comment`, { body: body(text) }, await auth());

  const transition = async (k: string, name: string) => {
    const list = await sendJson('Jira', fetchImpl, 'GET', `${api}/issue/${k}/transitions`, undefined, await auth());
    const t = (list.body?.transitions ?? []).find((x: any) => String(x?.name).toLowerCase() === name.toLowerCase()
      || String(x?.to?.name).toLowerCase() === name.toLowerCase());
    if (!t) { console.error(`⚠️  Jira: no transition named "${oneLine(name, 40)}" on ${k}`); return; }
    await sendJson('Jira', fetchImpl, 'POST', `${api}/issue/${k}/transitions`, { transition: { id: String(t.id) } }, await auth());
  };

  return {
    postCard(card: ActionCard, a: RiskAssessment, approvalUrl: string) {
      if (a.tier < minTier) return;
      const p = (async () => {
        const r = await sendJson('Jira', fetchImpl, 'POST', `${api}/issue`, {
          fields: {
            project: { key: opts.projectKey },
            issuetype: { name: opts.issueType || 'Task' },
            summary: oneLine(`[Litti T${a.tier}] ${card.action}: ${card.description}`, 250),
            description: body(jiraDescription(card, a, approvalUrl)),
            labels: ['litti', `litti-tier-${a.tier}`],
          },
        }, await auth());
        if (r.ok && typeof r.body?.key === 'string') setSetting(key(card.id), r.body.key);
      })();
      inflight.set(card.id, p);
      return p.finally(() => inflight.delete(card.id));
    },

    // Jira tracks actions, not chat: free-form messages without an action are skipped.
    postMessage() {},

    async postUpdate(event: ActionEvent) {
      await inflight.get(event.card.id)?.catch(() => {});
      const k = issueKey(event.card.id);
      if (!k) return;
      await comment(k, `${eventTitle(event.kind)}\n${event.message}\nApprovers so far: ${event.approvers.join(', ') || '—'} (${event.approvers.length}/${event.requiredApprovers})`);
      if (event.kind === 'approved' && opts.doneTransition) await transition(k, opts.doneTransition);
      if (isFinal(event.kind)) setSetting(`${key(event.card.id)}:closed`, new Date().toISOString());
    },
  };
}
