/** Deterministic risk tiering. No LLM, no randomness. */
import type { ActionCard, RiskAssessment, Tier } from '../types.js';

/** Assess the risk tier of an action card. Highest matching rule wins. */
export function assessRisk(card: ActionCard): RiskAssessment {
  // Tier 0: read-only actions auto-approve.
  if (['read', 'lint', 'format', 'test'].includes(card.action)) {
    return { tier: 0, reasons: ['Read-only operation'], requiredApprovers: 0 };
  }

  let tier: Tier = 1;
  const reasons: string[] = ['Write operation'];

  // Path-based bumps.
  const criticalPaths = ['migration', 'auth', 'security', 'prod', '.env', 'secret', 'password', 'credential'];
  for (const p of card.touchedPaths) {
    const lower = p.toLowerCase();
    if (criticalPaths.some(cp => lower.includes(cp))) {
      tier = Math.max(tier, 2) as Tier;
      reasons.push(`Critical path: ${p}`);
    }
  }

  // Size-based bump.
  const lineCount = card.diff.split('\n').length;
  if (lineCount > 200) {
    tier = Math.max(tier, 2) as Tier;
    reasons.push(`Large diff: ${lineCount} lines`);
  }

  // Destructive operation bump.
  const destructivePatterns = /DROP\s|TRUNCATE\s|DELETE\s+FROM|rm\s+-rf|rmdir|format\s+c:/i;
  if (card.action === 'delete' || destructivePatterns.test(card.diff)) {
    tier = 3;
    reasons.push('Destructive operation detected');
  }

  // Irreversible bump (+1, capped at 3).
  if (!card.reversible && tier < 3) {
    tier = Math.min(tier + 1, 3) as Tier;
    reasons.push('Irreversible action');
  }

  const requiredApprovers = tier === 0 ? 0 : tier === 1 ? 1 : tier === 2 ? 2 : 3;
  return { tier, reasons, requiredApprovers };
}
