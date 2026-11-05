/** Token-gated deploy. Only runs with a valid signature + matching diff hash. */
import { writeFileSync } from 'node:fs';
import type { ActionCard, ApprovalToken } from '../types.js';
import { validateToken } from '../approval/token.js';
import { consumeToken, releaseToken } from '../chain/db.js';

export interface DeployResult {
  ok: boolean;
  message: string;
  file?: string;
}

/**
 * Attempt a deploy. Refuses without a token, blocks on invalid/changed diff,
 * and burns the token so it cannot be replayed.
 */
export function execute(
  card: ActionCard,
  token: ApprovalToken | null,
  requiredApprovers: number,
): DeployResult {
  if (!token) {
    return { ok: false, message: '🔒 No approval token. Litti engaged.' };
  }

  const check = validateToken(token, card.diff, requiredApprovers);
  if (!check.valid) {
    return { ok: false, message: `🔒 Deploy blocked — ${check.reason}` };
  }

  if (!consumeToken(token.tokenId)) {
    return { ok: false, message: '🔒 Deploy blocked — token already used (replay).' };
  }

  const file = `deployed-${Date.now()}.txt`;
  try {
    writeFileSync(file, `# Deployed by Litti\nAction: ${card.action}\nApprovers: ${token.approvers.join(', ')}\n\n${card.diff}\n`);
  } catch (err) {
    releaseToken(token.tokenId); // undo reservation so a failed deploy can retry
    return { ok: false, message: `🔒 Deploy failed to write: ${(err as Error).message}` };
  }
  return { ok: true, message: '✅ Deploy executed', file };
}
