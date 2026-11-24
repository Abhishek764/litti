/** Fastify server: review pages, approval flow, agent API, dashboard APIs. */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { ActionCard, ActionSource, ActionEvent, ApprovalSubmission, ApprovalToken, Notifier, PendingAction, QuizResult, Tier } from '../types.js';
import { buildActionCard } from '../agents/builder.js';
import { gatekeep } from '../agents/gatekeeper.js';
import { checkAnswer, chooseChallenge } from '../agents/challenges.js';
import { assessRisk } from '../rules/tiering.js';
import { detectRubberStamp } from '../rules/rubberstamp.js';
import { renderApprovalPage } from './page.js';
import { createToken, validateToken } from './token.js';
import { allowSelfAsserted, issueTicket, issueViewStamp, localMode, localReviewerName, readViewStamp, resolveReviewer, reviewerKey, verifyTicket } from './identity.js';
import { renderInbox } from './inbox.js';
import { registerChangesRoutes } from '../changes/routes.js';
import { registerConnectRoutes } from '../connect/routes.js';
import { registerDocsRoutes } from '../docs/site.js';
import { execute } from '../deploy/executor.js';
import { appendReceipt, attentionScore } from '../chain/receipt.js';
import { verifyChain } from '../chain/verify.js';
import {
  insertPending, getPending, updatePending, allReceipts, corruptReceipt, demoMode, consumeOnce, supersedeOlderGateActions,
  getSetting, setSetting, setApprovalToken, getApprovalToken, listPending, latestByDiffHash, isShipped, markShipped,
} from '../chain/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACTIONS = ['read', 'lint', 'format', 'test', 'edit', 'migrate', 'deploy', 'delete'];
const MAX_DIFF_BYTES = 512 * 1024;

let notifier: Notifier | null = null;

/** Set where approval cards and updates are sent (console, webhook, ...). */
export function setNotifier(n: Notifier | null): void { notifier = n; }

/** Notify the team without ever failing the request. Events let Slack/Discord/Jira thread the update. */
function announce(message: string, event?: Omit<ActionEvent, 'message'>): void {
  try {
    const p = event && notifier?.postUpdate ? notifier.postUpdate({ ...event, message }) : notifier?.postMessage(message);
    void Promise.resolve(p).catch(() => {});
  } catch { /* best-effort */ }
}

/** Public base URL for links. Falls back to the request's host. */
function baseUrlFor(req: { protocol: string; headers: Record<string, unknown> }): string {
  return process.env.PUBLIC_URL || `${req.protocol}://${String(req.headers.host)}`;
}

/** Summary of a pending action, safe to show to agents and reviewers (no quiz answer). */
function summary(p: PendingAction, baseUrl: string) {
  return {
    id: p.id,
    action: p.actionCard.action,
    agent: p.actionCard.agent,
    description: p.actionCard.description,
    tier: p.tier,
    status: p.status,
    approvals: p.currentApprovals.length,
    requiredApprovers: p.requiredApprovers,
    createdAt: p.createdAt,
    approvalUrl: `${baseUrl}/approve/${p.id}`,
  };
}

/** Rubber-stamp penalty for the NEXT action, persisted across restarts. */
function takeTierBump(): number {
  const bump = Number(getSetting('pending_tier_bump') ?? 0);
  if (bump) setSetting('pending_tier_bump', '0');
  return bump;
}

/** Tier-and-quiz an action, apply any pending rubber-stamp bump, persist it, announce it. */
/**
 * How many different reviewers an action needs. Teams: one per tier (Tier 2 → 2, Tier 3 → 3).
 * Local solo mode (no API key, no SSO, you are signed in as your OS user): there is only one human,
 * so every reviewed action needs exactly one review. Higher tiers still get longer minimum times
 * and harder checks; a second made-up name would only fake separation of duties.
 */
export function approversFor(tier: Tier): number {
  if (tier === 0) return 0;
  // LITTI_SOLO=false keeps team quorums on a local install (e.g. a pair sharing one machine).
  return localMode() && process.env.LITTI_SOLO !== 'false' ? 1 : tier;
}

export function registerPending(card: ActionCard, baseUrl: string, source: ActionSource = 'api'): { id: string; url: string; tier: Tier } {
  const { assessment } = gatekeep(card);
  const bump = assessment.tier === 0 ? 0 : takeTierBump();
  const tier = Math.min(assessment.tier + bump, 3) as Tier;
  const reasons = bump ? [...assessment.reasons, 'Tier +1: previous review was rubber-stamped'] : assessment.reasons;
  const requiredApprovers = approversFor(tier);

  // Vary the comprehension check per action: quiz sometimes, other challenges the rest.
  const challenge = chooseChallenge(card, tier, { lastKind: getSetting('last_challenge_kind') });
  if (tier > 0) setSetting('last_challenge_kind', challenge.quiz.kind ?? 'quiz');
  const quiz = challenge.quiz;

  insertPending({
    id: card.id,
    actionCard: card,
    tier,
    requiredApprovers,
    currentApprovals: [],
    quiz,
    quizAnswer: challenge.answer,
    status: 'pending',
    createdAt: new Date().toISOString(),
    source,
  });
  const url = `${baseUrl}/approve/${card.id}`;
  if (tier > 0) {
    try { void Promise.resolve(notifier?.postCard(card, { tier, reasons, requiredApprovers }, url)).catch(() => {}); } catch { /* best-effort */ }
  }
  return { id: card.id, url, tier };
}

/**
 * Can a pipeline ship this diff with this token? The token must be for an approved action
 * we know, match that action's diff, carry a valid v2 signature, and not have shipped before.
 */
function checkShippable(token: ApprovalToken, diff: string): { valid: boolean; reason: string } {
  if (typeof token !== 'object' || token === null) return { valid: false, reason: 'Malformed token.' };
  const p = getPending(String(token.actionId));
  if (!p || p.status !== 'approved') return { valid: false, reason: 'Action is not approved.' };
  // Tier 0 is decided from what the requester declared; it is logged, never a shipping approval.
  if (p.tier === 0 || p.requiredApprovers === 0) return { valid: false, reason: 'Tier 0 actions are logged, not approved by a human: they cannot ship.' };
  if (token.diffHash !== p.actionCard.diffHash) return { valid: false, reason: 'Token is for a different change.' };
  if (isShipped(String(token.tokenId))) return { valid: false, reason: 'Token already used to ship.' };
  try { return validateToken(token, diff, p.requiredApprovers); }
  catch { return { valid: false, reason: 'Malformed token.' }; }
}

/**
 * Deliver an approved action. Success → status approved + 'approved' receipt. Failure → status
 * deploy-failed + 'deploy-failed' receipt: not shippable, the gate stays shut, an admin can retry.
 */
async function deliverApproved(p: PendingAction, approvals: ApprovalSubmission[], token: ApprovalToken): Promise<{ ok: boolean; message: string; attention: number }> {
  const card = p.actionCard;
  const result = await execute(card, token, p.requiredApprovers);
  const attention = Math.round(approvals.reduce((s, a) => s + attentionScore(card, true, a.scrolledToBottom, a.timeSpentMs), 0) / Math.max(approvals.length, 1));
  updatePending(p.id, approvals, result.ok ? 'approved' : 'deploy-failed');
  appendReceipt({ actionCard: card, tier: p.tier, approvals, outcome: result.ok ? 'approved' : 'deploy-failed', attentionScore: attention });
  // A gate action (commit, push, rm -rf…) is run by the agent, not by Litti: say "approved".
  const message = result.ok ? (p.source === 'gate' ? '✅ Approved. Tell the agent to run the same command again; it will be allowed once.' : result.message)
    :`${result.message}. Nothing was shipped and the agent stays blocked. Fix the pipeline, then ask an admin to retry this action (POST /api/actions/${p.id}/retry with the admin key).`;
  return { ok: result.ok, message, attention };
}

/** Retry is an admin power: the admin key in team mode, open only in local mode (no keys at all). */
function retryAllowed(headers: Record<string, unknown>): boolean {
  const admin = process.env.LITTI_ADMIN_KEY;
  if (admin) return keyMatches(headers['x-litti-admin-key'], admin);
  return !agentKeysSet();
}
const retrying = new Set<string>();

/** Minimum review time for a tier. */
export function minTimeMs(tier: Tier): number { return tier >= 2 ? 30000 : 10000; }

function keyMatches(given: unknown, key: string): boolean {
  const g = Buffer.from(String(given ?? ''));
  const k = Buffer.from(key);
  return g.length === k.length && timingSafeEqual(g, k);
}

/** Labelled agent keys: LITTI_API_KEYS=label:key,label2:key2. */
export function parseApiKeys(raw = process.env.LITTI_API_KEYS ?? ''): { label: string; key: string }[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf(':');
    return i > 0 ? { label: s.slice(0, i).trim().slice(0, 64), key: s.slice(i + 1).trim() } : { label: '', key: s };
  }).filter(k => k.key);
}

/** Team mode: some agent key is configured. */
function agentKeysSet(): boolean {
  return Boolean(process.env.LITTI_API_KEY || parseApiKeys().length);
}

/**
 * Who is calling the agent API. With LITTI_API_KEYS the key's label IS the requester, so an agent
 * can't pick a reviewer's name (or "nobody") as its own (SEC-11). LITTI_API_KEY has no label.
 */
function apiPrincipal(given: unknown): { ok: boolean; label?: string } {
  const labelled = parseApiKeys();
  const single = process.env.LITTI_API_KEY;
  if (!labelled.length && !single) return { ok: true };
  for (const k of labelled) if (keyMatches(given, k.key)) return { ok: true, ...(k.label ? { label: k.label } : {}) };
  if (single && keyMatches(given, single)) return { ok: true };
  return { ok: false };
}

/** The requester: the key's label when there is one; the body's `agent` is then only a detail. */
function requesterOf(b: { agent?: unknown }, label?: string): { agent?: string; agentDetail?: string } {
  const named = typeof b.agent === 'string' && b.agent.trim() ? b.agent.trim().slice(0, 64) : undefined;
  if (!label) return { agent: named };
  return { agent: label, ...(named && named !== label ? { agentDetail: named } : {}) };
}
function withDetail(card: ActionCard, detail?: string): void {
  if (detail) card.agentDetail = detail;
}

function apiKeyOk(given: unknown): boolean {
  return apiPrincipal(given).ok;
}

/**
 * Issuing review links is an admin power: whoever holds it can name reviewers. It always needs
 * LITTI_ADMIN_KEY, local mode included (`litti` generates one into ~/.litti/config.env), so an
 * agent calling the API with no key, or with only LITTI_API_KEY, can't mint itself a reviewer.
 */
function adminKeyOk(headers: Record<string, unknown>): boolean {
  const admin = process.env.LITTI_ADMIN_KEY;
  return Boolean(admin) && keyMatches(headers['x-litti-admin-key'], admin!);
}

/** Local sign-in uses the OS user; an agent with that same name could approve itself. */
function localClash(agent: string): string {
  return `🔒 The agent is named "${agent}", which is also the reviewer Litti signs you in as on this machine. ` +
    'The requester can never approve their own action: give the agent another name (LITTI_AGENT_NAME) ' +
    'or set LITTI_LOCAL_REVIEWER in ~/.litti/config.env.';
}
function agentIsLocalReviewer(agent: string): boolean {
  return localMode() && reviewerKey(agent) === reviewerKey(localReviewerName());
}

/** The inbox lists every pending action. Open locally; behind SSO in production. */
function inboxAllowed(headers: Record<string, unknown>): boolean {
  if (!agentKeysSet()) return true;
  const h = process.env.LITTI_IDENTITY_HEADER?.toLowerCase();
  return Boolean(h && headers[h]);
}

const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];

/**
 * DNS rebinding guard. A server listening only on this machine answers only requests addressed
 * to a loopback name (or PUBLIC_URL's host); a web page whose domain was rebound to 127.0.0.1
 * still sends its own name as Host and is refused.
 */
export function hostAllowed(hostHeader: unknown, env = process.env): boolean {
  if (!LOOPBACK.includes(env.HOST || '127.0.0.1')) return true; // network-facing: PUBLIC_URL + keys protect it
  let name: string;
  try { name = new URL(`http://${String(hostHeader ?? '')}`).hostname.toLowerCase(); } catch { return false; }
  if (['127.0.0.1', 'localhost', '[::1]'].includes(name)) return true;
  if (env.PUBLIC_URL) {
    try { return new URL(env.PUBLIC_URL).hostname.toLowerCase() === name; } catch { return false; }
  }
  return false;
}

/**
 * Pass to `app.listen()`: Fastify would otherwise log every interface address of the machine
 * (including local-network IPs when listening on 0.0.0.0). Log the port only.
 */
export const listenTextResolver = (address: string): string => {
  try { return `Litti listening on port ${new URL(address).port}`; } catch { return 'Litti listening'; }
};

/** Build the Fastify app with all routes. */
export function buildServer(opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    // Request logs never contain the client's IP address, port or host, nor the query string
    // (review links carry signed tickets in `?t=`). The IP is only used in memory for the
    // "same computer?" check and is never stored.
    logger: opts.logger ? {
      level: process.env.LOG_LEVEL || 'info',
      base: null, // no machine hostname or pid on every line
      serializers: {
        req: (req: { method?: string; url?: string; id?: string }) => ({ id: req.id, method: req.method, url: String(req.url ?? '').split('?')[0] }),
      },
    } : false,
    bodyLimit: MAX_DIFF_BYTES + 64 * 1024,
    trustProxy: process.env.TRUST_PROXY === 'true',
  });

  app.addHook('onRequest', async (req, reply) => {
    if (!hostAllowed(req.headers.host)) {
      return reply.code(403).type('text/plain').send('Litti: unexpected Host header. Open Litti at http://127.0.0.1:<port>/ (or set PUBLIC_URL).');
    }
  });

  // Security headers on every response. Inline styles/scripts are part of the page itself.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer'); // review links carry signed tickets
    reply.header('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return payload;
  });

  app.register(fastifyStatic, { root: join(__dirname, '..', '..', 'public'), prefix: '/' });

  // Changes workspace: live working-tree diff, line notes with the agent, one-click review.
  registerChangesRoutes(app, {
    apiKeyOk,
    reviewerAllowed: inboxAllowed,
    reviewerName: (headers) => {
      const h = process.env.LITTI_IDENTITY_HEADER?.toLowerCase();
      const v = h ? headers[h] : undefined;
      return typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null;
    },
    baseUrlFor,
    registerPending: (card, baseUrl) => registerPending(card, baseUrl, 'changes'),
  });

  // Integrations page + Connect buttons (Slack, Discord, Jira).
  registerConnectRoutes(app);

  // Documentation site (docs/guide/*.md).
  registerDocsRoutes(app);

  // Liveness only: no counts or versions for anonymous callers.
  app.get('/healthz', () => ({ ok: true }));

  // Review inbox: what's waiting for reviewers.
  app.get('/', (req, reply) => {
    if (!inboxAllowed(req.headers)) {
      reply.code(401).type('text/html').send('<!doctype html><meta charset="utf-8"><title>Litti</title><body style="font-family:system-ui;padding:40px"><h1>🔒 Inbox needs sign-in</h1><p>Put Litti behind your SSO proxy and set <code>LITTI_IDENTITY_HEADER</code>, or list actions with <code>litti pending</code>.</p></body>');
      return;
    }
    reply.type('text/html').header('cache-control', 'no-store').send(renderInbox(listPending(), baseUrlFor(req)));
  });

  // Review page.
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>('/approve/:id', (req, reply) => {
    const pending = getPending(req.params.id);
    if (!pending) { reply.code(404).type('text/html').send('<h1>Action not found</h1>'); return; }
    const who = resolveReviewer(req.headers, req.query.t || undefined, undefined, pending.id, req.ip);
    // Demo mode keeps typed names; everywhere else a known reviewer is locked in.
    const known = 'name' in who && !(who.source === 'local' && allowSelfAsserted()) ? who.name : '';
    reply.type('text/html').header('cache-control', 'no-store').send(renderApprovalPage({
      card: pending.actionCard,
      tier: pending.tier,
      reasons: assessRisk(pending.actionCard).reasons,
      requiredApprovers: pending.requiredApprovers,
      approvalsSoFar: pending.currentApprovals.length,
      quiz: pending.quiz,
      approver: known,
      identityLocked: Boolean(known),
      allowTyped: allowSelfAsserted(),
      viewStamp: issueViewStamp(pending.id, Date.now(), known && 'id' in who ? who.id : undefined),
      ticket: req.query.t && verifyTicket(req.query.t, pending.id) ? req.query.t : '',
    }));
  });

  // Submit a review.
  app.post<{ Params: { id: string }; Body: Partial<ApprovalSubmission> & { viewStamp?: string; ticket?: string } }>('/approve/:id/submit', async (req, reply) => {
    const pending = getPending(req.params.id);
    if (!pending) return reply.code(404).send({ ok: false, message: 'Unknown action.' });
    if (pending.status !== 'pending') return reply.code(409).send({ ok: false, message: `🔒 Action is not pending (it is ${pending.status}).` });
    const body = req.body ?? {};
    const card = pending.actionCard;

    const who = resolveReviewer(req.headers, body.ticket || undefined, body.approver, pending.id, req.ip);
    if ('error' in who) return reply.code(401).send({ ok: false, message: `🔐 ${who.error.replace('<id>', pending.id)}` });

    // Review time is measured by the server from the signed page-open stamp. A stamp is used up
    // by any submit, pass or fail, and is bound to the reviewer the page was opened for.
    const view = readViewStamp(body.viewStamp, pending.id);
    if (!view) return reply.code(400).send({ ok: false, message: 'This review page expired. Reload it and review again.' });
    if (!consumeOnce(`view:${view.nonce}`)) return reply.code(409).send({ ok: false, message: 'This review page was already submitted once. Reload it and review again.' });
    if (who.source !== 'self-asserted' ? view.reviewerId !== who.id : view.reviewerId !== undefined && view.reviewerId !== who.id) {
      return reply.code(403).send({ ok: false, message: '🔒 This review page was opened for a different reviewer. Open your own review link.' });
    }
    const serverMs = view.elapsedMs;
    const clientMs = Number(body.timeSpentMs);
    const sub: ApprovalSubmission = {
      actionId: pending.id,
      approver: who.name,
      quizAnswer: String(body.quizAnswer ?? '').slice(0, 600),
      timeSpentMs: Number.isFinite(clientMs) && clientMs >= 0 ? Math.min(clientMs, serverMs) : serverMs,
      scrolledToBottom: body.scrolledToBottom === true,
      timestamp: new Date().toISOString(),
      identitySource: who.source,
      reviewerId: who.id,
    };
    const quizCorrect = checkAnswer(pending.quiz.kind, pending.quizAnswer, sub.quizAnswer, card);
    // Separation of duties: the requester can't approve, and nobody counts twice (normalised ids,
    // so "Bob", "bob​" and a Cyrillic "Bоb" are one person).
    if (who.id === reviewerKey(card.agent)) {
      return reply.code(403).send({ ok: false, message: who.source === 'local' ? localClash(card.agent) : '🔒 The requester cannot approve their own action.' });
    }
    if (pending.currentApprovals.some(a => (a.reviewerId ?? reviewerKey(a.approver)) === who.id)) {
      return reply.code(409).send({ ok: false, message: `🔒 ${sub.approver} already countersigned. Tier ${pending.tier} needs ${pending.requiredApprovers} different reviewers.` });
    }

    // Rubber-stamp detection first — the serious signal.
    const rs = detectRubberStamp(sub, card, quizCorrect, allReceipts());
    if (rs.flagged) {
      const score = attentionScore(card, quizCorrect, sub.scrolledToBottom, sub.timeSpentMs);
      appendReceipt({ actionCard: card, tier: pending.tier, approvals: [sub], outcome: 'rubber-stamped', attentionScore: score });
      // The flagged attempt never counts, and earlier approvals are wiped: everyone re-reviews.
      updatePending(pending.id, [], 'pending');
      setSetting('pending_tier_bump', '1');
      announce(`⚠️ @${sub.approver} ${rs.reason} Blocked. All reviews on "${card.description}" reset, and the next action's tier is bumped +1.`,
        { kind: 'rubber-stamped', card, approvers: [sub.approver], requiredApprovers: pending.requiredApprovers, attentionScore: score });
      return reply.code(422).send({ ok: false, message: `⚠️ Rubber-stamp blocked: ${rs.reason}` });
    }

    if (sub.timeSpentMs < minTimeMs(pending.tier)) {
      return reply.code(422).send({ ok: false, message: `Please review more carefully — Tier ${pending.tier} needs at least ${minTimeMs(pending.tier) / 1000}s.` });
    }
    if (card.diff.split('\n').length > 20 && !sub.scrolledToBottom) {
      return reply.code(422).send({ ok: false, message: 'Please scroll through the entire diff first.' });
    }
    if (!quizCorrect) return reply.code(422).send({ ok: false, message: 'Please review the diff more carefully — your answer to the comprehension check is wrong.' });

    const approvals = [...pending.currentApprovals, sub];
    if (approvals.length < pending.requiredApprovers) {
      updatePending(pending.id, approvals, 'pending');
      announce(`✍️ ${sub.approver} countersigned "${card.description}" (${approvals.length}/${pending.requiredApprovers}). Waiting for ${pending.requiredApprovers - approvals.length} more reviewer(s).`,
        { kind: 'countersigned', card, approvers: approvals.map(a => a.approver), requiredApprovers: pending.requiredApprovers });
      return { ok: true, message: `✅ Countersigned. ${approvals.length}/${pending.requiredApprovers} approvers — waiting for the rest.` };
    }

    // Threshold met: lock the action first so a concurrent submit can't double-deploy.
    updatePending(pending.id, approvals, 'approved');
    const quizResults: QuizResult[] = approvals.map(a => ({ approver: a.approver, correct: true, timeMs: a.timeSpentMs }));
    const diffHash = createHash('sha256').update(card.diff).digest('hex');
    const token = createToken(card.id, diffHash, quizResults);
    setApprovalToken(pending.id, token);
    const result = await deliverApproved(pending, approvals, token);
    const avgAttention = result.attention;
    announce(`${result.message} — "${card.description}"\nReviewed by ${approvals.map(a => a.approver).join(', ')} · attention ${avgAttention}/100 · diff ${diffHash.slice(0, 12)}… · receipt chained.`,
      { kind: result.ok ? 'approved' : 'execution-failed', card, approvers: approvals.map(a => a.approver), requiredApprovers: pending.requiredApprovers, attentionScore: avgAttention });
    return reply.code(result.ok ? 200 : 502).send({ ok: result.ok, message: result.message });
  });

  // Agent API: propose an action.
  app.post<{ Body: Partial<ActionCard> }>('/api/actions', (req, reply) => {
    const who = apiPrincipal(req.headers['x-litti-key']);
    if (!who.ok) return reply.code(401).send({ ok: false, message: 'Invalid or missing x-litti-key header.' });
    const b = req.body ?? {};
    if (b.reversible !== undefined && typeof b.reversible !== 'boolean') return reply.code(400).send({ ok: false, message: 'reversible must be true or false (a JSON boolean).' });
    if (!b.action || !ACTIONS.includes(b.action) || !b.description || typeof b.diff !== 'string' || !Array.isArray(b.touchedPaths)) {
      return reply.code(400).send({ ok: false, message: `Required: action (${ACTIONS.join('|')}), description, diff, touchedPaths[]. Optional: agent, reversible, rollbackPlan.` });
    }
    if (Buffer.byteLength(b.diff) > MAX_DIFF_BYTES) return reply.code(413).send({ ok: false, message: 'Diff too large (max 512 KB).' });
    const card = buildActionCard({
      agent: requesterOf(b, who.label).agent,
      action: b.action,
      description: String(b.description).slice(0, 300),
      diff: b.diff,
      touchedPaths: b.touchedPaths.map(String).slice(0, 500),
      reversible: b.reversible ?? true,
      rollbackPlan: String(b.rollbackPlan ?? '').slice(0, 2000),
    });
    withDetail(card, requesterOf(b, who.label).agentDetail);
    if (agentIsLocalReviewer(card.agent)) return reply.code(400).send({ ok: false, message: localClash(card.agent) });
    const { id, url, tier } = registerPending(card, baseUrlFor(req));

    // Tier 0 (read-only) is auto-approved: logged and chained, no reviewers.
    if (tier === 0) {
      const token = createToken(card.id, card.diffHash, []);
      setApprovalToken(id, token);
      updatePending(id, [], 'approved');
      appendReceipt({ actionCard: card, tier, approvals: [], outcome: 'auto-approved', attentionScore: 100 });
      return { ok: true, id, tier, status: 'approved', token };
    }
    return { ok: true, id, tier, status: 'pending', approvalUrl: url, requiredApprovers: approversFor(tier) };
  });

  // Agent hooks (Claude Code, Codex, OpenCode): may this risky command run now?
  // Same diff + command → same action, so a retry after approval is allowed exactly once.
  app.post<{ Body: Partial<ActionCard> & { command?: string } }>('/api/gate', (req, reply) => {
    const who = apiPrincipal(req.headers['x-litti-key']);
    if (!who.ok) return reply.code(401).send({ ok: false, decision: 'deny', message: '🔒 Litti: invalid or missing x-litti-key. Set LITTI_API_KEY for the agent hook.' });
    const b = req.body ?? {};
    if (!b.action || !ACTIONS.includes(b.action) || typeof b.diff !== 'string' || !b.description) {
      return reply.code(400).send({ ok: false, decision: 'deny', message: '🔒 Litti: malformed gate request.' });
    }
    if (b.reversible !== undefined && typeof b.reversible !== 'boolean') return reply.code(400).send({ ok: false, decision: 'deny', message: '🔒 Litti: reversible must be a JSON boolean.' });
    if (Buffer.byteLength(b.diff) > MAX_DIFF_BYTES) {
      return reply.code(413).send({ ok: false, decision: 'deny', message: '🔒 Litti: the change is over 512 KB — too large to review in one go. Split it into smaller commits.' });
    }
    const card = buildActionCard({
      agent: requesterOf(b, who.label).agent,
      action: b.action,
      description: String(b.description).slice(0, 300),
      diff: b.diff,
      touchedPaths: Array.isArray(b.touchedPaths) ? b.touchedPaths.map(String).slice(0, 500) : [],
      reversible: b.reversible ?? false,
      rollbackPlan: String(b.rollbackPlan ?? '').slice(0, 2000),
    });
    withDetail(card, requesterOf(b, who.label).agentDetail);
    if (agentIsLocalReviewer(card.agent)) return reply.code(400).send({ ok: false, decision: 'deny', message: localClash(card.agent) });
    const base = baseUrlFor(req);
    const denyMsg = (p: { id: string; tier: number; requiredApprovers: number; approvals: number }, url: string, fresh: boolean) => [
      `🔒 Litti: this command needs human review before it runs (Tier ${p.tier} · ${p.approvals}/${p.requiredApprovers} reviewer(s) so far).`,
      `Review link: ${url}`,
      fresh ? 'A review request was just created.' : 'It is still waiting for review.',
      'Tell the user to open the link and review it. Do NOT retry, rephrase, split or work around this command until they confirm it is approved;',
      'then run exactly the same command again with no further file changes (any change starts a new review).',
      `Status: litti status ${p.id}`,
    ].join('\n');

    const prev = latestByDiffHash(card.diffHash, 'gate');
    if (prev?.status === 'pending') {
      return { ok: true, decision: 'deny', id: prev.id, tier: prev.tier, approvalUrl: `${base}/approve/${prev.id}`,
        message: denyMsg({ id: prev.id, tier: prev.tier, requiredApprovers: prev.requiredApprovers, approvals: prev.currentApprovals.length }, `${base}/approve/${prev.id}`, false) };
    }
    if (prev?.status === 'deploy-failed') {
      return { ok: true, decision: 'deny', id: prev.id, tier: prev.tier,
        message: `🔒 Litti: this change was approved, but delivering it failed, so it may not run yet. Ask the user to fix the pipeline and retry it (POST /api/actions/${prev.id}/retry), then run exactly the same command again. Status: litti status ${prev.id}` };
    }
    if (prev?.status === 'approved' && !getSetting(`gate_used:${prev.id}`)) {
      setSetting(`gate_used:${prev.id}`, new Date().toISOString());
      const who = prev.currentApprovals.map(a => a.approver).join(', ') || 'policy (Tier 0)';
      announce(`▶️ ${card.agent} ran the approved command for "${prev.actionCard.description}" (approved by ${who}).`);
      return { ok: true, decision: 'allow', id: prev.id, tier: prev.tier, message: `✅ Litti: approved by ${who}. Running once.` };
    }

    const { id, url, tier } = registerPending(card, base, 'gate');
    // Inbox hygiene (FIELD-11): an earlier, still-pending request for the same command in the same
    // repository is replaced by this one; reviewing the old diff would approve nothing.
    const command = typeof b.command === 'string' && b.command ? b.command : String(b.description);
    const repoName = typeof (b as { repo?: unknown }).repo === 'string' ? String((b as { repo?: unknown }).repo) : '';
    supersedeOlderGateActions(id, createHash('sha256').update(`${who.label ?? ''}\0${repoName}\0${command}`).digest('hex'));
    if (tier === 0) {
      const token = createToken(card.id, card.diffHash, []);
      setApprovalToken(id, token);
      updatePending(id, [], 'approved');
      setSetting(`gate_used:${id}`, new Date().toISOString());
      appendReceipt({ actionCard: card, tier, approvals: [], outcome: 'auto-approved', attentionScore: 100 });
      return { ok: true, decision: 'allow', id, tier, message: '✅ Litti: Tier 0, allowed.' };
    }
    const required = approversFor(tier);
    return { ok: true, decision: 'deny', id, tier, approvalUrl: url, message: denyMsg({ id, tier, requiredApprovers: required, approvals: 0 }, url, true) };
  });

  // Agent API: action status. Includes the signed token once approved; never the quiz answer.
  app.get<{ Params: { id: string } }>('/api/actions/:id', (req, reply) => {
    if (!apiKeyOk(req.headers['x-litti-key'])) return reply.code(401).send({ ok: false, message: 'Invalid or missing x-litti-key header.' });
    const p = getPending(req.params.id);
    if (!p) return reply.code(404).send({ ok: false, message: 'Unknown action.' });
    const token = p.status === 'approved' ? getApprovalToken(p.id) : null;
    return { ok: true, id: p.id, tier: p.tier, status: p.status, approvals: p.currentApprovals.length, requiredApprovers: p.requiredApprovers, ...(token ? { token } : {}) };
  });

  // Admin API: re-run the executor for an approved action whose delivery failed.
  app.post<{ Params: { id: string } }>('/api/actions/:id/retry', async (req, reply) => {
    if (!retryAllowed(req.headers)) return reply.code(401).send({ ok: false, message: 'Retry needs the x-litti-admin-key header.' });
    const p = getPending(req.params.id);
    if (!p) return reply.code(404).send({ ok: false, message: 'Unknown action.' });
    if (p.status !== 'deploy-failed' || retrying.has(p.id)) return reply.code(409).send({ ok: false, message: `Nothing to retry: the action is ${retrying.has(p.id) ? 'being retried' : p.status}.` });
    const token = getApprovalToken(p.id) as ApprovalToken | null;
    if (!token) return reply.code(409).send({ ok: false, message: 'No approval token stored for this action.' });
    retrying.add(p.id);
    try {
      const r = await deliverApproved(p, p.currentApprovals, token);
      announce(`${r.ok ? '🔁 Retried' : '⚠️ Retry failed'}: ${r.message} — "${p.actionCard.description}"`);
      return reply.code(r.ok ? 200 : 502).send({ ok: r.ok, message: r.message });
    } finally { retrying.delete(p.id); }
  });

  // Agent/CLI API: actions waiting for reviewers.
  app.get('/api/pending', (req, reply) => {
    if (!apiKeyOk(req.headers['x-litti-key'])) return reply.code(401).send({ ok: false, message: 'Invalid or missing x-litti-key header.' });
    const base = baseUrlFor(req);
    return { ok: true, pending: listPending().map(p => summary(p, base)) };
  });

  // Admin/CLI API: issue a personal, signed review link for one reviewer.
  app.post<{ Params: { id: string }; Body: { reviewer?: string } }>('/api/actions/:id/review-link', (req, reply) => {
    if (!adminKeyOk(req.headers)) {
      return reply.code(401).send({ ok: false, message: process.env.LITTI_ADMIN_KEY
        ? 'Invalid or missing x-litti-admin-key header. `litti review` sends it from ~/.litti/config.env.'
        : 'Review links need LITTI_ADMIN_KEY on the server (`litti` creates one in ~/.litti/config.env).' });
    }
    const p = getPending(req.params.id);
    if (!p) return reply.code(404).send({ ok: false, message: 'Unknown action.' });
    if (p.status !== 'pending') return reply.code(409).send({ ok: false, message: `Action is already ${p.status}.` });
    const reviewer = typeof req.body?.reviewer === 'string' ? req.body.reviewer.trim().slice(0, 64) : '';
    if (!reviewer) return reply.code(400).send({ ok: false, message: 'Required: reviewer.' });
    if (reviewerKey(reviewer) === reviewerKey(p.actionCard.agent)) {
      return reply.code(403).send({ ok: false, message: 'The requester cannot review their own action.' });
    }
    const t = issueTicket(p.id, reviewer, reviewerKey(reviewer));
    return { ok: true, reviewer, expiresInMinutes: 30, url: `${baseUrlFor(req)}/approve/${p.id}?t=${encodeURIComponent(t)}` };
  });

  // Pipeline API: check a token against the diff you are about to ship.
  app.post<{ Body: { token?: ApprovalToken; diff?: string } }>('/api/tokens/verify', (req, reply) => {
    if (!apiKeyOk(req.headers['x-litti-key'])) return reply.code(401).send({ ok: false, message: 'Invalid or missing x-litti-key header.' });
    const { token, diff } = req.body ?? {};
    if (!token || typeof diff !== 'string') return reply.code(400).send({ valid: false, reason: 'Required: token, diff.' });
    return checkShippable(token, diff);
  });

  // Pipeline API: verify and use a token exactly once, right before shipping.
  app.post<{ Body: { token?: ApprovalToken; diff?: string } }>('/api/tokens/consume', (req, reply) => {
    if (!apiKeyOk(req.headers['x-litti-key'])) return reply.code(401).send({ ok: false, message: 'Invalid or missing x-litti-key header.' });
    const { token, diff } = req.body ?? {};
    if (!token || typeof diff !== 'string') return reply.code(400).send({ valid: false, reason: 'Required: token, diff.' });
    const check = checkShippable(token, diff);
    if (!check.valid) return reply.code(409).send(check);
    if (!markShipped(String(token.tokenId))) return reply.code(409).send({ valid: false, reason: 'Token already used to ship.' });
    return { valid: true, reason: 'Valid — consumed. Ship this exact diff now.' };
  });

  // Dashboard data.
  // Receipts contain full diffs: only agents with the API key, or people allowed into the inbox.
  const evidenceAllowed = (h: Record<string, unknown>) =>
    (agentKeysSet() && h['x-litti-key'] !== undefined ? apiKeyOk(h['x-litti-key']) : false) || inboxAllowed(h);
  const denyEvidence = (reply: any) => reply.code(401).send({ ok: false, message: 'Sign in (SSO) or send x-litti-key to read receipts.' });
  app.get('/api/receipts', (req, reply) => (evidenceAllowed(req.headers) ? allReceipts().slice().reverse() : denyEvidence(reply)));
  app.get('/api/chain/verify', (req, reply) => (evidenceAllowed(req.headers) ? verifyChain() : denyEvidence(reply)));
  app.get('/api/stats', (req, reply) => (evidenceAllowed(req.headers) ? computeStats() : denyEvidence(reply)));
  app.get('/api/meta', () => ({ demo: demoMode() }));

  // DEMO-ONLY: corrupt a receipt so Verify Chain visibly breaks. Disabled unless demo mode.
  app.post<{ Body: { id?: string } }>('/api/demo/break-chain', (req, reply) => {
    if (!demoMode()) return reply.code(404).send({ ok: false, message: 'Not found.' });
    const receipts = allReceipts();
    const target = req.body?.id ?? receipts[Math.floor(receipts.length / 2)]?.id;
    if (!target) return reply.code(409).send({ ok: false, message: 'No receipts to corrupt.' });
    try { corruptReceipt(target, createHash('sha256').update('tampered-' + Date.now()).digest('hex')); }
    catch { return reply.code(403).send({ ok: false, message: 'Tamper disabled — only available in demo mode.' }); }
    return { ok: true, message: `Corrupted receipt ${target}` };
  });

  return app;
}

/** Per-reviewer stats for the dashboard and `litti stats`. */
export function computeStats() {
  const byApprover: Record<string, { scores: number[]; rubberStamps: number; total: number }> = {};
  for (const r of allReceipts()) {
    for (const a of r.approvals) {
      const s = (byApprover[a.approver] ??= { scores: [], rubberStamps: 0, total: 0 });
      s.scores.push(r.attentionScore);
      s.total++;
      if (r.outcome === 'rubber-stamped') s.rubberStamps++;
    }
  }
  return Object.entries(byApprover).map(([approver, s]) => ({
    approver,
    avgAttention: Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length),
    rubberStampCount: s.rubberStamps,
    approvalRate: Math.round(((s.total - s.rubberStamps) / s.total) * 100),
  }));
}
