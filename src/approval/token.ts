/** HMAC-SHA256 approval tokens bound to the exact approved diff. */
import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ApprovalToken, QuizResult } from '../types.js';

function secret(): string {
  const key = process.env.SECRET_KEY;
  if (!key) throw new Error('SECRET_KEY is not set — refusing to sign/verify with a default key');
  return key;
}

/** Constant-time comparison of two hex strings. */
function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Canonical bytes signed by the token. */
function payload(tokenId: string, diffHash: string, approvers: string[]): string {
  return `${tokenId}|${diffHash}|${approvers.slice().sort().join(',')}`;
}

/** Compute the HMAC signature for a token's core fields. */
function sign(tokenId: string, diffHash: string, approvers: string[]): string {
  return createHmac('sha256', secret()).update(payload(tokenId, diffHash, approvers)).digest('hex');
}

/** SHA-256 hex of arbitrary text. Shared diff-hashing helper. */
export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Issue a signed approval token for an approved action. */
export function createToken(actionId: string, diffHash: string, quizResults: QuizResult[]): ApprovalToken {
  const tokenId = randomUUID();
  const approvers = quizResults.map(q => q.approver);
  return {
    tokenId,
    actionId,
    diffHash,
    approvers,
    quizResults,
    issuedAt: new Date().toISOString(),
    signature: sign(tokenId, diffHash, approvers),
  };
}

/** Validate a token against the current diff. Returns {valid, reason}. */
export function validateToken(
  token: ApprovalToken,
  currentDiff: string,
  requiredApprovers: number,
): { valid: boolean; reason: string } {
  const expectedSig = sign(token.tokenId, token.diffHash, token.approvers);
  if (!safeEqualHex(expectedSig, token.signature)) return { valid: false, reason: 'Signature mismatch' };

  if (!safeEqualHex(sha256(currentDiff), token.diffHash)) {
    return { valid: false, reason: 'Diff changed since approval — token is dead' };
  }
  if (token.approvers.length < requiredApprovers) {
    return { valid: false, reason: `Need ${requiredApprovers} approvers, got ${token.approvers.length}` };
  }
  if (!token.quizResults.every(q => q.correct)) {
    return { valid: false, reason: 'Not all approvers passed the quiz' };
  }
  return { valid: true, reason: 'Valid' };
}
