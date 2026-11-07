/** Deterministic risk tiering. No LLM, no randomness. */
import type { ActionCard, RiskAssessment, Tier } from '../types.js';

/** Assess the risk tier of an action card. Highest matching rule wins. */
export function assessRisk(card: ActionCard): RiskAssessment {
  const criticalPaths = ['migration', 'auth', 'security', 'prod', '.env', 'secret', 'password', 'credential'];
  const destructivePatterns = /DROP\s|DROP$|TRUNCATE\s|DELETE\s+FROM|rm\s+-(?:rf|fr)\b|rm\s+-r\s+-f|rmdir|format\s+c:|push\s+(?:--force|-f)\b|chmod\s+-R\s+777/im;
  const touchesCritical = card.touchedPaths.some(p => criticalPaths.some(cp => p.toLowerCase().includes(cp)));

  // Tier 0: read-only actions auto-approve, unless the content says otherwise.
  const readOnly = ['read', 'lint', 'format', 'test'].includes(card.action);
  if (readOnly && !touchesCritical && !destructivePatterns.test(card.diff)) {
    return { tier: 0, reasons: ['Read-only operation'], requiredApprovers: 0 };
  }

  let tier: Tier = 1;
  const reasons: string[] = [readOnly ? `Declared "${card.action}" but touches risky content` : 'Write operation'];

  // Path-based bumps.
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
