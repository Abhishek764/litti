/**
 * Token-gated executor. Runs an approved action only with a valid signature,
 * a diff hash that still matches, enough approvers, and an unused token.
 *
 * Where it "runs":
 *  - LITTI_DEPLOY_WEBHOOK set: POSTs the approved action + token to your CI/CD,
 *    signed with HMAC-SHA256 in the `x-litti-signature` header (key: LITTI_WEBHOOK_SECRET,
 *    falling back to SECRET_KEY). Your pipeline verifies the signature, then deploys.
 *  - otherwise: writes a deployment record to LITTI_DEPLOY_DIR (default ./deployments).
 */
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActionCard, ApprovalToken } from '../types.js';
import { validateToken } from '../approval/token.js';
import { consumeToken, releaseToken } from '../chain/db.js';

export interface DeployResult {
  ok: boolean;
  message: string;
  file?: string;
}

/** Sign a webhook body. Exported so receivers (and tests) can verify the same way. */
export function signWebhook(body: string): string {
  const key = process.env.LITTI_WEBHOOK_SECRET || process.env.SECRET_KEY;
  if (!key) throw new Error('LITTI_WEBHOOK_SECRET or SECRET_KEY must be set to sign webhooks');
  return 'sha256=' + createHmac('sha256', key).update(body).digest('hex');
}

async function deliver(card: ActionCard, token: ApprovalToken): Promise<DeployResult> {
  const url = process.env.LITTI_DEPLOY_WEBHOOK;
  if (url) {
    const body = JSON.stringify({ event: 'action.approved', action: card, token });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-litti-signature': signWebhook(body), 'x-litti-action-id': card.id },
      body,
      signal: AbortSignal.timeout(Number(process.env.LITTI_WEBHOOK_TIMEOUT_MS) || 15000),
    });
    if (!res.ok) throw new Error(`deploy webhook returned ${res.status}`);
    return { ok: true, message: '✅ Deploy executed (handed to pipeline)' };
  }
  const dir = process.env.LITTI_DEPLOY_DIR || 'deployments';
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `deployed-${Date.now()}-${card.id.slice(0, 8)}.txt`);
  writeFileSync(file, `# Deployed by Litti\nAction: ${card.action}\nDescription: ${card.description}\nApprovers: ${token.approvers.join(', ')}\nDiff SHA-256: ${token.diffHash}\nToken: ${token.tokenId}\n\n${card.diff}\n`);
  return { ok: true, message: '✅ Deploy executed', file };
}

/** Validate the token, burn it (no replay), then deliver the action. */
export async function execute(
  card: ActionCard,
  token: ApprovalToken | null,
  requiredApprovers: number,
): Promise<DeployResult> {
  if (!token) return { ok: false, message: '🔒 No approval token. Litti engaged.' };

  const check = validateToken(token, card.diff, requiredApprovers);
  if (!check.valid) return { ok: false, message: `🔒 Deploy blocked — ${check.reason}` };

  if (!consumeToken(token.tokenId)) return { ok: false, message: '🔒 Deploy blocked — token already used (replay).' };

  try {
    return await deliver(card, token);
  } catch (err) {
    releaseToken(token.tokenId); // let an operator retry once the pipeline is back
    return { ok: false, message: `⚠️ Approved, but deploy failed: ${(err as Error).message}` };
  }
}
