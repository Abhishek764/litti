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

  // Too fast on a substantial diff.
  if (submission.timeSpentMs < 10000 && lineCount > 50) {
    return { flagged: true, reason: `Approved a ${lineCount}-line diff in ${(submission.timeSpentMs / 1000).toFixed(1)}s. That's not a review.` };
  }

  // Quiz wrong — comprehension not demonstrated.
  if (!quizCorrect) {
    return { flagged: true, reason: 'Comprehension quiz failed.' };
  }

  // Serial rubber-stamper: last 3 by this approver were also flagged.
  const theirLastThree = recentByApprover
    .filter(r => r.approvals.some(a => a.approver === submission.approver))
    .slice(-3);
  if (theirLastThree.length >= 3 && theirLastThree.every(r => r.outcome === 'rubber-stamped')) {
    return { flagged: true, reason: `${submission.approver} rubber-stamped 3+ in a row.` };
  }

  return { flagged: false, reason: '' };
}
