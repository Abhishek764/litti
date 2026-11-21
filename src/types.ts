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

/**
 * How the reviewer proves they read the diff. The quiz is one of several kinds;
 * Litti varies the kind per action so reviews never become muscle memory.
 */
export type ChallengeKind = 'quiz' | 'spot-line' | 'type-in' | 'canary' | 'count' | 'explain';

/** A comprehension check generated from a diff (multiple choice or another challenge kind). */
export interface Quiz {
  question: string;
  options: string[];
  correctIndex: number;
  /** Challenge kind. Missing means 'quiz' (records from older versions). */
  kind?: ChallengeKind;
  /** Extra content shown with the question, e.g. the line for a canary check. */
  subject?: string;
}

/** What a human submits from the approval page. */
export interface ApprovalSubmission {
  actionId: string;
  approver: string;
  quizAnswer: string;
  timeSpentMs: number;
  scrolledToBottom: boolean;
  timestamp: string;
  /** How the reviewer was identified: SSO header, signed review link, typed name, or local OS user. */
  identitySource?: 'sso' | 'ticket' | 'self-asserted' | 'local';
  /** Normalised reviewer key (see reviewerKey): one person counts once, however the name is spelled. */
  reviewerId?: string;
}

/** Per-approver quiz result embedded in a token. */
export interface QuizResult {
  approver: string;
  correct: boolean;
  timeMs: number;
}

/** Cryptographic token bound to the exact approved diff. */
export interface ApprovalToken {
  /** Token format. 2 = signature also covers actionId and issuedAt. */
  v?: 2;
  tokenId: string;
  actionId: string;
  diffHash: string;
  approvers: string[];
  quizResults: QuizResult[];
  issuedAt: string;
  signature: string;
}

export type Outcome = 'approved' | 'rejected' | 'rubber-stamped' | 'auto-approved' | 'deploy-failed';

/** A hash-chained decision record. */
export interface Receipt {
  /** Hash format. 2 = also covers tier, approvals and timestamp. Missing = 1 (older receipts). */
  format?: 2;
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
  /** deploy-failed: approved by reviewers, but the executor could not deliver it (retry it). */
  status: 'pending' | 'approved' | 'rejected' | 'deploy-failed';
  createdAt: string;
  /** Who created it: the agent hook gate, the agent API, or the Changes page. Older rows: unknown. */
  source?: ActionSource;
}

export type ActionSource = 'gate' | 'api' | 'changes';

/** Something that happened to an action after its card was posted. */
export interface ActionEvent {
  kind: 'countersigned' | 'rubber-stamped' | 'approved' | 'execution-failed';
  card: ActionCard;
  /** Human-readable summary, same text plain notifiers receive. */
  message: string;
  approvers: string[];
  requiredApprovers: number;
  attentionScore?: number;
}

/** Where Litti tells the team about approvals (console, webhook, Slack, Discord, Jira). Best-effort. */
export interface Notifier {
  postCard(card: ActionCard, assessment: RiskAssessment, approvalUrl: string): Promise<void> | void;
  postMessage(message: string): Promise<void> | void;
  /** Optional: follow-up tied to an action (thread reply, issue comment). Falls back to postMessage. */
  postUpdate?(event: ActionEvent): Promise<void> | void;
}
