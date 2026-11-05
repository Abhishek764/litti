/** Hash-chained receipts + attention scoring. */
import { randomUUID } from 'node:crypto';
import type { ActionCard, ApprovalSubmission, Outcome, Receipt, Tier } from '../types.js';
import { sha256 } from '../approval/token.js';
import { insertReceipt, lastReceipt } from './db.js';

const GENESIS = '0'.repeat(64);

/** Canonical hash of a receipt. Covers every field an attacker might flip. */
export function computeChainHash(r: Omit<Receipt, 'chainHash'>): string {
  // Delimited with a byte that cannot appear in hex/JSON field values, so no
  // field boundary is ambiguous (prevents concatenation collisions).
  return sha256(
    [r.id, r.previousHash, JSON.stringify(r.actionCard), r.outcome, r.attentionScore.toString()].join('\x1f'),
  );
}

/** Attention score 0-100 from quiz, scroll, and time spent. */
export function attentionScore(
  card: ActionCard,
  quizCorrect: boolean,
  scrolledToBottom: boolean,
  timeSpentMs: number,
): number {
  const lineCount = card.diff.split('\n').length;
  const expectedTimeMs = Math.max(10000, lineCount * 500);
  const timeComponent = Math.min(40, (timeSpentMs / expectedTimeMs) * 40);
  const raw = (quizCorrect ? 40 : 0) + (scrolledToBottom ? 20 : 0) + timeComponent;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Build and persist a new receipt linked to the current chain tip. */
export function appendReceipt(args: {
  actionCard: ActionCard;
  tier: Tier;
  approvals: ApprovalSubmission[];
  outcome: Outcome;
  attentionScore: number;
}): Receipt {
  const prev = lastReceipt();
  const base: Omit<Receipt, 'chainHash'> = {
    id: randomUUID(),
    previousHash: prev ? prev.chainHash : GENESIS,
    actionCard: args.actionCard,
    tier: args.tier,
    approvals: args.approvals,
    outcome: args.outcome,
    attentionScore: args.attentionScore,
    timestamp: new Date().toISOString(),
  };
  const receipt: Receipt = { ...base, chainHash: computeChainHash(base) };
  insertReceipt(receipt);
  return receipt;
}
