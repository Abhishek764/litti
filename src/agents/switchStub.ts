/** Console-backed SwitchClient. Standalone demo never depends on real Switch. */
import type { ActionCard, RiskAssessment, SwitchClient } from '../types.js';

/** A SwitchClient that logs to the terminal instead of posting to a room. */
export function createSwitchStub(): SwitchClient {
  return {
    postCard(card: ActionCard, assessment: RiskAssessment, approvalUrl: string) {
      console.log(`\n🔑 [switch] ActionCard ${card.action} — Tier ${assessment.tier} (${assessment.reasons.join('; ')})`);
      console.log(`🔑 [switch] Approve here: ${approvalUrl}`);
    },
    postMessage(message: string) {
      console.log(`🔑 [switch] ${message}`);
    },
  };
}
