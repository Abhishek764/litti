/**
 * Review notes: a conversation about the working-tree diff, anchored to a file and line.
 * Humans leave notes on the Changes page; agents read open notes and reply over the API/CLI.
 */
import { randomBytes } from 'node:crypto';
import { getDb } from '../chain/db.js';

export interface Note {
  id: string;
  /** Root note of the thread; null for a root note. */
  parentId: string | null;
  file: string;
  /** New-file line number the note is about; 0 for a whole-file note. */
  line: number;
  /** The line's text when the note was written, so it stays readable after the code moves. */
  snippet: string;
  author: string;
  role: 'human' | 'agent';
  body: string;
  status: 'open' | 'resolved';
  createdAt: string;
}

const ready = new WeakSet<object>();
function db() {
  const d = getDb();
  if (!ready.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS review_notes (
      id TEXT PRIMARY KEY, parent_id TEXT, file TEXT NOT NULL, line INTEGER NOT NULL DEFAULT 0,
      snippet TEXT NOT NULL DEFAULT '', author TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
    )`);
    ready.add(d);
  }
  return d;
}

const toNote = (r: any): Note => ({
  id: r.id, parentId: r.parent_id, file: r.file, line: r.line, snippet: r.snippet,
  author: r.author, role: r.role, body: r.body, status: r.status, createdAt: r.created_at,
});

export const LIMITS = { body: 4000, file: 500, snippet: 300, author: 64 };

export function addNote(n: { parentId?: string | null; file: string; line: number; snippet?: string; author: string; role: Note['role']; body: string }): Note {
  const parent = n.parentId ? getNote(n.parentId) : null;
  const root = parent ? (parent.parentId ? getNote(parent.parentId) ?? parent : parent) : null;
  const note: Note = {
    id: `note_${randomBytes(6).toString('hex')}`,
    parentId: root?.id ?? null,
    file: root?.file ?? n.file.slice(0, LIMITS.file),
    line: root?.line ?? Math.max(0, Math.floor(n.line) || 0),
    snippet: root?.snippet ?? (n.snippet ?? '').slice(0, LIMITS.snippet),
    author: n.author.slice(0, LIMITS.author),
    role: n.role,
    body: n.body.slice(0, LIMITS.body),
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  db().prepare(`INSERT INTO review_notes (id, parent_id, file, line, snippet, author, role, body, status, created_at)
    VALUES (@id, @parentId, @file, @line, @snippet, @author, @role, @body, @status, @createdAt)`).run(note);
  // A human reply reopens a resolved thread.
  if (root && n.role === 'human' && root.status === 'resolved') setStatus(root.id, 'open');
  return note;
}

export function getNote(id: string): Note | null {
  const r = db().prepare('SELECT * FROM review_notes WHERE id = ?').get(id);
  return r ? toNote(r) : null;
}

/** Threads: root notes with their replies, newest thread last. */
export function listThreads(filter: { status?: Note['status'] } = {}): Array<Note & { replies: Note[] }> {
  const all = (db().prepare('SELECT * FROM review_notes ORDER BY created_at ASC, rowid ASC').all() as any[]).map(toNote);
  const roots = all.filter(n => !n.parentId && (!filter.status || n.status === filter.status));
  return roots.map(r => ({ ...r, replies: all.filter(n => n.parentId === r.id) }));
}

export function setStatus(id: string, status: Note['status']): boolean {
  return db().prepare('UPDATE review_notes SET status = ? WHERE id = ? AND parent_id IS NULL').run(status, id).changes > 0;
}
