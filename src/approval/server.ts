/** Fastify approval server: approval page, submit flow, and dashboard APIs. */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { buildActionCard } from '../agents/builder.js';
import type { ActionCard, ApprovalSubmission, QuizResult, Tier } from '../types.js';
import { gatekeep } from '../agents/gatekeeper.js';
import { assessRisk } from '../rules/tiering.js';
import { renderApprovalPage } from './page.js';
import { createToken } from './token.js';
import { execute } from '../deploy/executor.js';
import { appendReceipt, attentionScore } from '../chain/receipt.js';
import { verifyChain } from '../chain/verify.js';
import {
  insertPending, getPending, updatePending, allReceipts, corruptReceipt,
} from '../chain/db.js';
import { detectRubberStamp } from '../rules/rubberstamp.js';
import type { SwitchClient } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Shared runtime state.
let switchClient: SwitchClient | null = null;
let pendingTierBump = 0; // rubber-stamp penalty applied to the NEXT action

/** Inject the Switch client (stub or real). */
export function setSwitchClient(c: SwitchClient): void { switchClient = c; }

function bumpTier(t: Tier): Tier { return Math.min(t + pendingTierBump, 3) as Tier; }

/** Tier-and-quiz an action, apply any pending rubber-stamp bump, persist it. */
export function registerPending(card: ActionCard, baseUrl: string): { id: string; url: string; tier: Tier } {
  const { assessment, quiz } = gatekeep(card);
  const tier = bumpTier(assessment.tier);
  if (pendingTierBump > 0) pendingTierBump = 0; // consume the penalty
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
  return { id: card.id, url: `${baseUrl}/approve/${card.id}`, tier };
}

/** Minimum dwell time on the page for a given tier. */
function minTimeMs(tier: Tier): number { return tier >= 2 ? 30000 : 10000; }

/** Build the Fastify app with all routes. */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(fastifyStatic, { root: join(__dirname, '..', '..', 'public'), prefix: '/' });

  // Approval page.
  app.get<{ Params: { id: string }; Querystring: { approver?: string } }>('/approve/:id', (req, reply) => {
    const pending = getPending(req.params.id);
    if (!pending) { reply.code(404).type('text/html').send('<h1>Action not found</h1>'); return; }
    const assessment = assessRisk(pending.actionCard);
    const html = renderApprovalPage({
      card: pending.actionCard,
      tier: pending.tier,
      reasons: assessment.reasons,
      requiredApprovers: pending.requiredApprovers,
      approvalsSoFar: pending.currentApprovals.length,
      quiz: pending.quiz,
      approver: req.query.approver ?? '',
    });
    reply.type('text/html').send(html);
  });

  // Submit an approval.
  app.post<{ Params: { id: string }; Body: ApprovalSubmission }>('/approve/:id/submit', (req, reply) => {
    const pending = getPending(req.params.id);
    if (!pending || pending.status !== 'pending') {
      reply.send({ ok: false, message: '🔒 Action not pending.' }); return;
    }
    const sub = req.body;
    const card = pending.actionCard;
    const quizCorrect = sub.quizAnswer === pending.quizAnswer;
    const recent = allReceipts();

    // Rubber-stamp detection first — serious signal.
    const rs = detectRubberStamp(sub, card, quizCorrect, recent);
    if (rs.flagged) {
      const score = attentionScore(card, quizCorrect, sub.scrolledToBottom, sub.timeSpentMs);
      appendReceipt({ actionCard: card, tier: pending.tier, approvals: [sub], outcome: 'rubber-stamped', attentionScore: score });
      // Flagged attempt never counts. Wipe prior approvals too, forcing a full
      // fresh review; action stays open so it can still be reviewed properly.
      updatePending(pending.id, [], 'pending');
      pendingTierBump = 1;
      switchClient?.postMessage(`⚠️ @${sub.approver} ${rs.reason} Next action tier bumped +1.`);
      reply.send({ ok: false, message: `⚠️ Rubber-stamp blocked: ${rs.reason}` }); return;
    }

    // Soft gates: timing + scroll.
    if (sub.timeSpentMs < minTimeMs(pending.tier)) {
      reply.send({ ok: false, message: 'Please review the diff more carefully — too fast.' }); return;
    }
    if (card.diff.split('\n').length > 20 && !sub.scrolledToBottom) {
      reply.send({ ok: false, message: 'Please scroll through the entire diff first.' }); return;
    }

    // Explicit comprehension gate. Guarantees every recorded approval (and thus
    // every quizResult marked correct below) actually passed the quiz.
    if (!quizCorrect) {
      reply.send({ ok: false, message: 'Please review the diff more carefully — quiz answer is wrong.' }); return;
    }

    // Record the passing approval.
    const approvals = [...pending.currentApprovals, sub];
    if (approvals.length < pending.requiredApprovers) {
      updatePending(pending.id, approvals, 'pending');
      reply.send({ ok: true, message: `✅ Countersigned. ${approvals.length}/${pending.requiredApprovers} approvers — waiting for the rest.` });
      return;
    }

    // Threshold met — issue token, deploy, append receipt.
    const quizResults: QuizResult[] = approvals.map(a => ({ approver: a.approver, correct: true, timeMs: a.timeSpentMs }));
    const diffHash = createHash('sha256').update(card.diff).digest('hex');
    const token = createToken(card.id, diffHash, quizResults);
    const result = execute(card, token, pending.requiredApprovers);

    const avgAttention = Math.round(
      approvals.reduce((s, a) => s + attentionScore(card, true, a.scrolledToBottom, a.timeSpentMs), 0) / approvals.length,
    );
    appendReceipt({ actionCard: card, tier: pending.tier, approvals, outcome: 'approved', attentionScore: avgAttention });
    updatePending(pending.id, approvals, 'approved');
    switchClient?.postMessage(result.message);
    reply.send({ ok: result.ok, message: result.message });
  });

  // Agent API: propose an action. Optional shared key via LITTI_API_KEY.
  app.post<{ Body: Partial<ActionCard> }>('/api/actions', (req, reply) => {
    const key = process.env.LITTI_API_KEY;
    const given = String(req.headers['x-litti-key'] ?? '');
    if (key && (given.length !== key.length || !timingSafeEqual(Buffer.from(given), Buffer.from(key)))) {
      reply.code(401).send({ ok: false, message: 'Invalid or missing x-litti-key header.' }); return;
    }
    const b = req.body ?? {};
    if (!b.action || !b.description || typeof b.diff !== 'string' || !Array.isArray(b.touchedPaths)) {
      reply.code(400).send({ ok: false, message: 'Required: action, description, diff, touchedPaths[]. Optional: agent, reversible, rollbackPlan.' }); return;
    }
    const card = buildActionCard({
      agent: b.agent, action: b.action, description: b.description, diff: b.diff,
      touchedPaths: b.touchedPaths, reversible: b.reversible ?? true, rollbackPlan: b.rollbackPlan ?? '',
    });
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`;
    const { id, url, tier } = registerPending(card, baseUrl);

    // Tier 0 (read-only) auto-approves and executes immediately.
    if (tier === 0) {
      const token = createToken(card.id, card.diffHash, []);
      const result = execute(card, token, 0);
      appendReceipt({ actionCard: card, tier, approvals: [], outcome: 'auto-approved', attentionScore: 100 });
      updatePending(id, [], 'approved');
      reply.send({ ok: true, id, tier, status: 'approved', message: result.message }); return;
    }
    switchClient?.postMessage(`🔒 Tier ${tier} action needs review: ${card.description} → ${url}`);
    reply.send({ ok: true, id, tier, status: 'pending', approvalUrl: url });
  });

  // Agent API: poll an action's status. Never exposes the quiz answer.
  app.get<{ Params: { id: string } }>('/api/actions/:id', (req, reply) => {
    const p = getPending(req.params.id);
    if (!p) { reply.code(404).send({ ok: false, message: 'Unknown action.' }); return; }
    reply.send({ ok: true, id: p.id, tier: p.tier, status: p.status, approvals: p.currentApprovals.length, requiredApprovers: p.requiredApprovers });
  });

  // Dashboard data APIs.
  app.get('/api/receipts', () => allReceipts().slice().reverse());
  app.get('/api/chain/verify', () => verifyChain());
  app.get('/api/stats', () => computeStats());

  // DEMO-ONLY: corrupt a receipt so Verify Chain visibly breaks.
  app.post<{ Body: { id?: string } }>('/api/demo/break-chain', (req, reply) => {
    const receipts = allReceipts();
    const target = req.body?.id ?? receipts[Math.floor(receipts.length / 2)]?.id;
    if (!target) { reply.send({ ok: false, message: 'No receipts to corrupt.' }); return; }
    try {
      // corruptReceipt throws unless enableDemoTamper() was called by the entrypoint.
      corruptReceipt(target, createHash('sha256').update('tampered-' + Date.now()).digest('hex'));
    } catch {
      reply.send({ ok: false, message: 'Tamper disabled — start in demo mode.' }); return;
    }
    reply.send({ ok: true, message: `Corrupted receipt ${target}` });
  });

  return app;
}

/** Per-reviewer stats for the dashboard. */
function computeStats() {
  const receipts = allReceipts();
  const byApprover: Record<string, { scores: number[]; rubberStamps: number; total: number }> = {};
  for (const r of receipts) {
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
