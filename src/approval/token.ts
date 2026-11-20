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

type Signed = Pick<ApprovalToken, 'tokenId' | 'actionId' | 'diffHash' | 'approvers' | 'issuedAt'>;

/**
 * Canonical bytes signed by the token (format v2). Covers which action it approves and when,
 * so a token can't be re-labelled for another action or have its issue time moved.
 */
function payload(t: Signed): string {
  return ['v2', t.tokenId, t.actionId, t.diffHash, t.issuedAt, t.approvers.slice().sort().join(',')].join('|');
}

/** Compute the HMAC signature for a token's core fields. */
function sign(t: Signed): string {
  return createHmac('sha256', secret()).update(payload(t)).digest('hex');
}

/** SHA-256 hex of arbitrary text. Shared diff-hashing helper. */
export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Issue a signed approval token for an approved action. */
export function createToken(actionId: string, diffHash: string, quizResults: QuizResult[]): ApprovalToken {
  const core: Signed = { tokenId: randomUUID(), actionId, diffHash, approvers: quizResults.map(q => q.approver), issuedAt: new Date().toISOString() };
  return { v: 2, ...core, quizResults, signature: sign(core) };
}

/** Validate a token against the current diff. Returns {valid, reason}. */
export function validateToken(
  token: ApprovalToken,
  currentDiff: string,
  requiredApprovers: number,
): { valid: boolean; reason: string } {
  // Tokens from before format v2 didn't sign the action id; they are no longer accepted.
  if (token.v !== 2) return { valid: false, reason: 'Old token format — ask for a new approval' };
  if (typeof token.signature !== 'string' || !Array.isArray(token.approvers)) return { valid: false, reason: 'Malformed token' };
  const expectedSig = sign(token);
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
