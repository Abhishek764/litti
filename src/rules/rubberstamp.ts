/** Detects approvals too fast or too careless to be a real review. */
import type { ActionCard, ApprovalSubmission, Receipt } from '../types.js';

export interface RubberStampResult {
  flagged: boolean;
  reason: string;
}

/** Inspect a single submission against the action it approves. */
export function detectRubberStamp(
  submission: ApprovalSubmission,
  card: ActionCard,
  quizCorrect: boolean,
  recentByApprover: Receipt[] = [],
): RubberStampResult {
  if (typeof card.diff !== 'string' || !submission.approver) {
    return { flagged: false, reason: '' };
  }
  const lineCount = card.diff.split('\n').length;

  let reason = '';
  if (submission.timeSpentMs < 10000 && lineCount > 50) {
    // Too fast on a substantial diff.
    reason = `Approved a ${lineCount}-line diff in ${(submission.timeSpentMs / 1000).toFixed(1)}s. That's not a review.`;
  } else if (!quizCorrect) {
    // Quiz wrong — comprehension not demonstrated.
    reason = 'Comprehension quiz failed.';
  }
  if (!reason) return { flagged: false, reason: '' };

  // Serial rubber-stamper: this one plus their last 2 were all flagged.
  const theirLastTwo = recentByApprover
    .filter(r => r.approvals.some(a => a.approver === submission.approver))
    .slice(-2);
  if (theirLastTwo.length >= 2 && theirLastTwo.every(r => r.outcome === 'rubber-stamped')) {
    reason += ` ${submission.approver} has rubber-stamped 3+ in a row.`;
  }
  return { flagged: true, reason };
}
