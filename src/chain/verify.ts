/** Walk the receipt chain and report per-link integrity. */
import type { VerifyResult } from '../types.js';
import { allReceipts } from './db.js';
import { computeChainHash } from './receipt.js';

const GENESIS = '0'.repeat(64);

/** Verify every link. A link is valid if its stored hash recomputes AND its
 *  previousHash matches the prior link's stored hash. */
export function verifyChain(): VerifyResult[] {
  const receipts = allReceipts();
  const results: VerifyResult[] = [];
  let expectedPrev = GENESIS;

  for (const r of receipts) {
    const recomputed = computeChainHash({
      id: r.id,
      previousHash: r.previousHash,
      actionCard: r.actionCard,
      tier: r.tier,
      approvals: r.approvals,
      outcome: r.outcome,
      attentionScore: r.attentionScore,
      timestamp: r.timestamp,
    });
    const linkOk = r.previousHash === expectedPrev;
    const hashOk = recomputed === r.chainHash;
    results.push({
      id: r.id,
      valid: linkOk && hashOk,
      expected: linkOk ? recomputed : expectedPrev,
      actual: r.chainHash,
    });
    expectedPrev = r.chainHash;
  }
  return results;
}

/** True only if the whole chain verifies. */
export function chainIntact(): boolean {
  return verifyChain().every(r => r.valid);
}
