/** Litti shared types. Every other module imports from here. */

/** Risk tiers: 0 auto, 1 low, 2 high, 3 critical. */
export type Tier = 0 | 1 | 2 | 3;

/** Action a builder agent proposes. */
export type ActionKind =
  | 'read' | 'lint' | 'format' | 'test'
  | 'edit' | 'deploy' | 'migrate' | 'delete';

/** A proposed action posted by the builder agent. */
export interface ActionCard {
  id: string;
  agent: string;
  action: ActionKind;
  description: string;
  diff: string;
  diffHash: string;
  touchedPaths: string[];
  reversible: boolean;
  rollbackPlan: string;
  timestamp: string;
}

/** Output of deterministic risk tiering. */
export interface RiskAssessment {
  tier: Tier;
  reasons: string[];
  requiredApprovers: number;
}

/** A comprehension quiz generated from a diff. */
export interface Quiz {
  question: string;
  options: string[];
  correctIndex: number;
}

/** What a human submits from the approval page. */
export interface ApprovalSubmission {
  actionId: string;
  approver: string;
  quizAnswer: string;
  timeSpentMs: number;
  scrolledToBottom: boolean;
  timestamp: string;
  /** How the reviewer was identified: SSO header, signed review link, or typed name. */
  identitySource?: 'sso' | 'ticket' | 'self-asserted';
}

/** Per-approver quiz result embedded in a token. */
export interface QuizResult {
  approver: string;
  correct: boolean;
  timeMs: number;
}

/** Cryptographic token bound to the exact approved diff. */
export interface ApprovalToken {
  tokenId: string;
  actionId: string;
  diffHash: string;
  approvers: string[];
  quizResults: QuizResult[];
  issuedAt: string;
  signature: string;
}

export type Outcome = 'approved' | 'rejected' | 'rubber-stamped' | 'auto-approved';

/** A hash-chained decision record. */
export interface Receipt {
  id: string;
  previousHash: string;
  actionCard: ActionCard;
  tier: Tier;
  approvals: ApprovalSubmission[];
  outcome: Outcome;
  attentionScore: number;
  chainHash: string;
  timestamp: string;
}

/** One link's verification result. */
export interface VerifyResult {
  id: string;
  valid: boolean;
  expected: string;
  actual: string;
}

/** A pending action awaiting approval, persisted in SQLite. */
export interface PendingAction {
  id: string;
  actionCard: ActionCard;
  tier: Tier;
  requiredApprovers: number;
  currentApprovals: ApprovalSubmission[];
  quiz: Quiz;
  quizAnswer: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

/** Where Litti tells the team about approvals (console, webhook, ...). Best-effort. */
export interface Notifier {
  postCard(card: ActionCard, assessment: RiskAssessment, approvalUrl: string): Promise<void> | void;
  postMessage(message: string): Promise<void> | void;
}
