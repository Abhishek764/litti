/** Fastify server: review pages, approval flow, agent API, dashboard APIs. */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { ActionCard, ApprovalSubmission, ApprovalToken, QuizResult, SwitchClient, Tier } from '../types.js';
import { buildActionCard } from '../agents/builder.js';
import { gatekeep } from '../agents/gatekeeper.js';
import { assessRisk } from '../rules/tiering.js';
import { detectRubberStamp } from '../rules/rubberstamp.js';
import { renderApprovalPage } from './page.js';
import { createToken, validateToken } from './token.js';
import { allowSelfAsserted, elapsedSinceView, issueViewStamp, resolveReviewer, verifyTicket } from './identity.js';
import { execute } from '../deploy/executor.js';
import { appendReceipt, attentionScore } from '../chain/receipt.js';
import { verifyChain } from '../chain/verify.js';
import {
  insertPending, getPending, updatePending, allReceipts, corruptReceipt,
  getSetting, setSetting, setApprovalToken, getApprovalToken,
} from '../chain/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACTIONS = ['read', 'lint', 'format', 'test', 'edit', 'migrate', 'deploy', 'delete'];
const MAX_DIFF_BYTES = 512 * 1024;

let switchClient: SwitchClient | null = null;

/** Inject the Switch client (live or offline stub). */
export function setSwitchClient(c: SwitchClient | null): void { switchClient = c; }

/** Post to the room without ever failing the request. */
function announce(message: string): void {
  try { void Promise.resolve(switchClient?.postMessage(message)).catch(() => {}); } catch { /* room is best-effort */ }
}

/** Rubber-stamp penalty for the NEXT action, persisted across restarts. */
function takeTierBump(): number {
  const bump = Number(getSetting('pending_tier_bump') ?? 0);
  if (bump) setSetting('pending_tier_bump', '0');
  return bump;
}

/** Tier-and-quiz an action, apply any pending rubber-stamp bump, persist it, announce it. */
export function registerPending(card: ActionCard, baseUrl: string): { id: string; url: string; tier: Tier } {
  const { assessment, quiz } = gatekeep(card);
  const bump = assessment.tier === 0 ? 0 : takeTierBump();
  const tier = Math.min(assessment.tier + bump, 3) as Tier;
  const reasons = bump ? [...assessment.reasons, 'Tier +1: previous review was rubber-stamped'] : assessment.reasons;
  const requiredApprovers = tier === 0 ? 0 : tier === 1 ? 1 : tier === 2 ? 2 : 3;

  insertPending({
    id: card.id,
    actionCard: card,
    tier,
    requiredApprovers,
    currentApprovals: [],
    quiz,
    quizAnswer: quiz.options[quiz.correctIndex],
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  const url = `${baseUrl}/approve/${card.id}`;
  if (tier > 0) {
    try { void Promise.resolve(switchClient?.postCard(card, { tier, reasons, requiredApprovers }, url)).catch(() => {}); } catch { /* best-effort */ }
  }
  return { id: card.id, url, tier };
}

/** Minimum review time for a tier. */
export function minTimeMs(tier: Tier): number { return tier >= 2 ? 30000 : 10000; }

function apiKeyOk(given: unknown): boolean {
  const key = process.env.LITTI_API_KEY;
  if (!key) return true;
  const g = Buffer.from(String(given ?? ''));
  const k = Buffer.from(key);
  return g.length === k.length && timingSafeEqual(g, k);
}

/** Build the Fastify app with all routes. */
export function buildServer(opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ? { level: process.env.LOG_LEVEL || 'info' } : false,
    bodyLimit: MAX_DIFF_BYTES + 64 * 1024,
    trustProxy: process.env.TRUST_PROXY === 'true',
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

  app.get('/healthz', () => ({ ok: true, switch: switchClient && 'agentId' in switchClient ? 'connected' : 'offline', receipts: allReceipts().length }));

  // Review page.
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>('/approve/:id', (req, reply) => {
    const pending = getPending(req.params.id);
    if (!pending) { reply.code(404).type('text/html').send('<h1>Action not found</h1>'); return; }
    const who = resolveReviewer(req.headers, req.query.t || undefined, undefined, pending.id);
    const known = 'name' in who ? who.name : '';
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
      viewStamp: issueViewStamp(pending.id),
      ticket: req.query.t && verifyTicket(req.query.t, pending.id) ? req.query.t : '',
    }));
  });

  // Submit a review.
  app.post<{ Params: { id: string }; Body: Partial<ApprovalSubmission> & { viewStamp?: string; ticket?: string } }>('/approve/:id/submit', async (req, reply) => {
    const pending = getPending(req.params.id);
    if (!pending || pending.status !== 'pending') return { ok: false, message: '🔒 Action is not pending.' };
    const body = req.body ?? {};
    const card = pending.actionCard;

    const who = resolveReviewer(req.headers, body.ticket || undefined, body.approver, pending.id);
    if ('error' in who) return reply.code(401).send({ ok: false, message: `🔐 ${who.error.replace('<id>', pending.id)}` });

    // Review time is measured by the server from the signed page-open stamp.
    const serverMs = elapsedSinceView(body.viewStamp, pending.id);
    if (serverMs === null) return reply.code(400).send({ ok: false, message: 'This review page expired. Reload it and review again.' });
    const clientMs = Number(body.timeSpentMs);
    const sub: ApprovalSubmission = {
      actionId: pending.id,
      approver: who.name,
      quizAnswer: String(body.quizAnswer ?? ''),
      timeSpentMs: Number.isFinite(clientMs) && clientMs >= 0 ? Math.min(clientMs, serverMs) : serverMs,
      scrolledToBottom: body.scrolledToBottom === true,
      timestamp: new Date().toISOString(),
      identitySource: who.source,
    };
    const quizCorrect = sub.quizAnswer === pending.quizAnswer;
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

    // Separation of duties: the requester can't approve, and nobody counts twice.
    if (same(sub.approver, card.agent)) return { ok: false, message: '🔒 The requester cannot approve their own action.' };
    if (pending.currentApprovals.some(a => same(a.approver, sub.approver))) {
      return { ok: false, message: `🔒 ${sub.approver} already countersigned. Tier ${pending.tier} needs ${pending.requiredApprovers} different reviewers.` };
    }

    // Rubber-stamp detection first — the serious signal.
    const rs = detectRubberStamp(sub, card, quizCorrect, allReceipts());
    if (rs.flagged) {
      const score = attentionScore(card, quizCorrect, sub.scrolledToBottom, sub.timeSpentMs);
      appendReceipt({ actionCard: card, tier: pending.tier, approvals: [sub], outcome: 'rubber-stamped', attentionScore: score });
      // The flagged attempt never counts, and earlier approvals are wiped: everyone re-reviews.
      updatePending(pending.id, [], 'pending');
      setSetting('pending_tier_bump', '1');
      announce(`⚠️ @${sub.approver} ${rs.reason} Blocked. All reviews on "${card.description}" reset, and the next action's tier is bumped +1.`);
      return { ok: false, message: `⚠️ Rubber-stamp blocked: ${rs.reason}` };
    }

    if (sub.timeSpentMs < minTimeMs(pending.tier)) {
      return { ok: false, message: `Please review more carefully — Tier ${pending.tier} needs at least ${minTimeMs(pending.tier) / 1000}s.` };
    }
    if (card.diff.split('\n').length > 20 && !sub.scrolledToBottom) {
      return { ok: false, message: 'Please scroll through the entire diff first.' };
    }
    if (!quizCorrect) return { ok: false, message: 'Please review the diff more carefully — quiz answer is wrong.' };

    const approvals = [...pending.currentApprovals, sub];
    if (approvals.length < pending.requiredApprovers) {
      updatePending(pending.id, approvals, 'pending');
      announce(`✍️ ${sub.approver} countersigned "${card.description}" (${approvals.length}/${pending.requiredApprovers}). Waiting for ${pending.requiredApprovers - approvals.length} more reviewer(s).`);
      return { ok: true, message: `✅ Countersigned. ${approvals.length}/${pending.requiredApprovers} approvers — waiting for the rest.` };
    }

    // Threshold met: lock the action first so a concurrent submit can't double-deploy.
    updatePending(pending.id, approvals, 'approved');
    const quizResults: QuizResult[] = approvals.map(a => ({ approver: a.approver, correct: true, timeMs: a.timeSpentMs }));
    const diffHash = createHash('sha256').update(card.diff).digest('hex');
    const token = createToken(card.id, diffHash, quizResults);
    setApprovalToken(pending.id, token);
    const result = await execute(card, token, pending.requiredApprovers);

    const avgAttention = Math.round(approvals.reduce((s, a) => s + attentionScore(card, true, a.scrolledToBottom, a.timeSpentMs), 0) / approvals.length);
    appendReceipt({ actionCard: card, tier: pending.tier, approvals, outcome: 'approved', attentionScore: avgAttention });
    announce(`${result.message} — "${card.description}"\nReviewed by ${approvals.map(a => a.approver).join(', ')} · attention ${avgAttention}/100 · diff ${diffHash.slice(0, 12)}… · receipt chained.`);
    return { ok: result.ok, message: result.message };
  });

  // Agent API: propose an action.
  app.post<{ Body: Partial<ActionCard> }>('/api/actions', (req, reply) => {
    if (!apiKeyOk(req.headers['x-litti-key'])) return reply.code(401).send({ ok: false, message: 'Invalid or missing x-litti-key header.' });
    const b = req.body ?? {};
    if (!b.action || !ACTIONS.includes(b.action) || !b.description || typeof b.diff !== 'string' || !Array.isArray(b.touchedPaths)) {
      return reply.code(400).send({ ok: false, message: `Required: action (${ACTIONS.join('|')}), description, diff, touchedPaths[]. Optional: agent, reversible, rollbackPlan.` });
    }
    if (Buffer.byteLength(b.diff) > MAX_DIFF_BYTES) return reply.code(413).send({ ok: false, message: 'Diff too large (max 512 KB).' });
    const card = buildActionCard({
      agent: typeof b.agent === 'string' && b.agent ? b.agent.slice(0, 64) : undefined,
      action: b.action,
      description: String(b.description).slice(0, 300),
      diff: b.diff,
      touchedPaths: b.touchedPaths.map(String).slice(0, 500),
      reversible: b.reversible ?? true,
      rollbackPlan: String(b.rollbackPlan ?? '').slice(0, 2000),
    });
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`;
    const { id, url, tier } = registerPending(card, baseUrl);

    // Tier 0 (read-only) is auto-approved: logged and chained, no reviewers.
    if (tier === 0) {
      const token = createToken(card.id, card.diffHash, []);
      setApprovalToken(id, token);
      updatePending(id, [], 'approved');
      appendReceipt({ actionCard: card, tier, approvals: [], outcome: 'auto-approved', attentionScore: 100 });
      return { ok: true, id, tier, status: 'approved', token };
    }
    return { ok: true, id, tier, status: 'pending', approvalUrl: url, requiredApprovers: tier === 1 ? 1 : tier === 2 ? 2 : 3 };
  });

  // Agent API: action status. Includes the signed token once approved; never the quiz answer.
  app.get<{ Params: { id: string } }>('/api/actions/:id', (req, reply) => {
    if (!apiKeyOk(req.headers['x-litti-key'])) return reply.code(401).send({ ok: false, message: 'Invalid or missing x-litti-key header.' });
    const p = getPending(req.params.id);
    if (!p) return reply.code(404).send({ ok: false, message: 'Unknown action.' });
    const token = p.status === 'approved' ? getApprovalToken(p.id) : null;
    return { ok: true, id: p.id, tier: p.tier, status: p.status, approvals: p.currentApprovals.length, requiredApprovers: p.requiredApprovers, ...(token ? { token } : {}) };
  });

  // Pipeline API: check a token against the diff you are about to ship.
  app.post<{ Body: { token?: ApprovalToken; diff?: string } }>('/api/tokens/verify', (req, reply) => {
    if (!apiKeyOk(req.headers['x-litti-key'])) return reply.code(401).send({ ok: false, message: 'Invalid or missing x-litti-key header.' });
    const { token, diff } = req.body ?? {};
    if (!token || typeof diff !== 'string') return reply.code(400).send({ valid: false, reason: 'Required: token, diff.' });
    const p = getPending(String(token.actionId));
    if (!p || p.status !== 'approved') return { valid: false, reason: 'Action is not approved.' };
    try { return validateToken(token, diff, p.requiredApprovers); }
    catch { return { valid: false, reason: 'Malformed token.' }; }
  });

  // Dashboard data.
  app.get('/api/receipts', () => allReceipts().slice().reverse());
  app.get('/api/chain/verify', () => verifyChain());
  app.get('/api/stats', () => computeStats());

  // DEMO-ONLY: corrupt a receipt so Verify Chain visibly breaks. Disabled unless demo mode.
  app.post<{ Body: { id?: string } }>('/api/demo/break-chain', (req) => {
    const receipts = allReceipts();
    const target = req.body?.id ?? receipts[Math.floor(receipts.length / 2)]?.id;
    if (!target) return { ok: false, message: 'No receipts to corrupt.' };
    try { corruptReceipt(target, createHash('sha256').update('tampered-' + Date.now()).digest('hex')); }
    catch { return { ok: false, message: 'Tamper disabled — only available in demo mode.' }; }
    return { ok: true, message: `Corrupted receipt ${target}` };
  });

  return app;
}

/** Per-reviewer stats for the dashboard and `@litti stats`. */
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
