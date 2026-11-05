/** SQLite schema init + query helpers. Synchronous better-sqlite3. */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Receipt, PendingAction } from '../types.js';

let db: Database.Database;

/** Set true only by the demo entrypoint. Gates the tamper injector. */
let tamperAllowed = false;

/** Enable the DEMO-ONLY chain tamper injector. Call only from demo code. */
export function enableDemoTamper(): void {
  tamperAllowed = true;
}

/** Open (or create) the database and ensure schema exists. */
export function initDb(path = 'litti.db'): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      previous_hash TEXT NOT NULL,
      action_card TEXT NOT NULL,
      tier INTEGER NOT NULL,
      approvals TEXT NOT NULL,
      outcome TEXT NOT NULL,
      attention_score REAL NOT NULL,
      chain_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seq INTEGER
    );
    CREATE TABLE IF NOT EXISTS pending_actions (
      id TEXT PRIMARY KEY,
      action_card TEXT NOT NULL,
      tier INTEGER NOT NULL,
      required_approvers INTEGER NOT NULL,
      current_approvals TEXT NOT NULL DEFAULT '[]',
      quiz_question TEXT NOT NULL,
      quiz_options TEXT NOT NULL,
      quiz_answer TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS consumed_tokens (
      token_id TEXT PRIMARY KEY,
      consumed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Additive migrations for databases created by older versions.
  const cols = (db.prepare('PRAGMA table_info(pending_actions)').all() as { name: string }[]).map(c => c.name);
  if (!cols.includes('approval_token')) db.exec('ALTER TABLE pending_actions ADD COLUMN approval_token TEXT');
  return db;
}

/** Get the live db handle (must call initDb first). */
export function getDb(): Database.Database {
  if (!db) throw new Error('initDb() not called');
  return db;
}

/** Insert a receipt at the end of the chain. */
export function insertReceipt(r: Receipt): void {
  const seq = (getDb().prepare('SELECT COUNT(*) AS n FROM receipts').get() as { n: number }).n;
  getDb().prepare(
    `INSERT INTO receipts (id, previous_hash, action_card, tier, approvals, outcome, attention_score, chain_hash, created_at, seq)
     VALUES (@id, @previousHash, @actionCard, @tier, @approvals, @outcome, @attentionScore, @chainHash, @timestamp, @seq)`
  ).run({
    id: r.id,
    previousHash: r.previousHash,
    actionCard: JSON.stringify(r.actionCard),
    tier: r.tier,
    approvals: JSON.stringify(r.approvals),
    outcome: r.outcome,
    attentionScore: r.attentionScore,
    chainHash: r.chainHash,
    timestamp: r.timestamp,
    seq,
  });
}

/** Return all receipts in chain order (oldest first). */
export function allReceipts(): Receipt[] {
  const rows = getDb().prepare('SELECT * FROM receipts ORDER BY seq ASC').all() as any[];
  return rows.map(rowToReceipt);
}

/** The most recently appended receipt, or null for an empty chain. */
export function lastReceipt(): Receipt | null {
  const row = getDb().prepare('SELECT * FROM receipts ORDER BY seq DESC LIMIT 1').get() as any;
  return row ? rowToReceipt(row) : null;
}

function rowToReceipt(row: any): Receipt {
  return {
    id: row.id,
    previousHash: row.previous_hash,
    actionCard: JSON.parse(row.action_card),
    tier: row.tier,
    approvals: JSON.parse(row.approvals),
    outcome: row.outcome,
    attentionScore: row.attention_score,
    chainHash: row.chain_hash,
    timestamp: row.created_at,
  };
}

/**
 * DEMO-ONLY tamper injector. Overwrites a receipt's chain_hash so judges can
 * watch Verify Chain detect it. Intentionally destructive; must only be reached
 * via the explicit /api/demo/break-chain route, never from the approval flow.
 */
export function corruptReceipt(id: string, badHash: string): void {
  if (!tamperAllowed) throw new Error('Demo tamper not enabled');
  getDb().prepare('UPDATE receipts SET chain_hash = ? WHERE id = ?').run(badHash, id);
}

/** Persist a pending action awaiting approval. */
export function insertPending(p: PendingAction): void {
  getDb().prepare(
    `INSERT INTO pending_actions (id, action_card, tier, required_approvers, current_approvals, quiz_question, quiz_options, quiz_answer, status, created_at)
     VALUES (@id, @actionCard, @tier, @requiredApprovers, @currentApprovals, @quizQuestion, @quizOptions, @quizAnswer, @status, @createdAt)`
  ).run({
    id: p.id,
    actionCard: JSON.stringify(p.actionCard),
    tier: p.tier,
    requiredApprovers: p.requiredApprovers,
    currentApprovals: JSON.stringify(p.currentApprovals),
    quizQuestion: p.quiz.question,
    quizOptions: JSON.stringify(p.quiz.options),
    quizAnswer: p.quizAnswer,
    status: p.status,
    createdAt: p.createdAt,
  });
}

/** Fetch a pending action by id, or null. */
export function getPending(id: string): PendingAction | null {
  const row = getDb().prepare('SELECT * FROM pending_actions WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    actionCard: JSON.parse(row.action_card),
    tier: row.tier,
    requiredApprovers: row.required_approvers,
    currentApprovals: JSON.parse(row.current_approvals),
    quiz: { question: row.quiz_question, options: JSON.parse(row.quiz_options), correctIndex: -1 },
    quizAnswer: row.quiz_answer,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Close the database (graceful shutdown). */
export function closeDb(): void {
  if (db?.open) db.close();
}

/** Read a persisted setting. */
export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Write a persisted setting. */
export function setSetting(key: string, value: string): void {
  getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Store the signed approval token on an approved action. */
export function setApprovalToken(id: string, token: unknown): void {
  getDb().prepare('UPDATE pending_actions SET approval_token = ? WHERE id = ?').run(JSON.stringify(token), id);
}

/** The signed approval token for an approved action, if any. */
export function getApprovalToken(id: string): unknown | null {
  const row = getDb().prepare('SELECT approval_token FROM pending_actions WHERE id = ?').get(id) as { approval_token: string | null } | undefined;
  return row?.approval_token ? JSON.parse(row.approval_token) : null;
}

/** All actions still awaiting approval, oldest first. */
export function listPending(): PendingAction[] {
  const rows = getDb().prepare("SELECT id FROM pending_actions WHERE status = 'pending' ORDER BY created_at").all() as { id: string }[];
  return rows.map(r => getPending(r.id)!).filter(Boolean);
}

/** Update a pending action's approvals + status. */
export function updatePending(id: string, approvals: unknown[], status: string): void {
  getDb().prepare('UPDATE pending_actions SET current_approvals = ?, status = ? WHERE id = ?')
    .run(JSON.stringify(approvals), status, id);
}

/** Record a token as consumed. Returns false if already consumed (replay). */
export function consumeToken(tokenId: string): boolean {
  const existing = getDb().prepare('SELECT token_id FROM consumed_tokens WHERE token_id = ?').get(tokenId);
  if (existing) return false;
  getDb().prepare('INSERT INTO consumed_tokens (token_id, consumed_at) VALUES (?, ?)')
    .run(tokenId, new Date().toISOString());
  return true;
}

/** Undo a consumeToken reservation — used when the gated operation fails. */
export function releaseToken(tokenId: string): void {
  getDb().prepare('DELETE FROM consumed_tokens WHERE token_id = ?').run(tokenId);
}
