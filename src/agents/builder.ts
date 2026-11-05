/** Builder agent: turns a diff into an ActionCard. */
import { randomUUID } from 'node:crypto';
import type { ActionCard, ActionKind } from '../types.js';
import { sha256 } from '../approval/token.js';

/** Construct an ActionCard from a proposed change. */
export function buildActionCard(input: {
  agent?: string;
  action: ActionKind;
  description: string;
  diff: string;
  touchedPaths: string[];
  reversible: boolean;
  rollbackPlan: string;
}): ActionCard {
  return {
    id: randomUUID(),
    agent: input.agent ?? 'builder-agent',
    action: input.action,
    description: input.description,
    diff: input.diff,
    diffHash: sha256(input.diff),
    touchedPaths: input.touchedPaths,
    reversible: input.reversible,
    rollbackPlan: input.rollbackPlan,
    timestamp: new Date().toISOString(),
  };
}
