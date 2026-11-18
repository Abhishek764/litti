/**
 * Changes workspace: see what the agent changed in the working tree, talk it through
 * with line notes, then send the whole diff for a Litti review in one click.
 *
 *   GET  /changes                      the page (reviewers)
 *   GET  /api/changes                  files + diffs + version (reviewers, agents)
 *   GET  /api/notes?status=open        note threads (reviewers, agents)
 *   POST /api/notes                    new note or reply   {file, line, snippet, body, parentId?}
 *   POST /api/notes/:id/resolve        close a thread      (reopen with {open:true})
 *   POST /api/changes/review           turn the current diff into a Litti action
 *
 * Who is who: requests with a valid x-litti-key are the agent; browser requests are
 * reviewers (allowed where the inbox is allowed: locally, or behind SSO in production).
 * Browser writes must carry x-litti-ui: 1, which a cross-site form can't send.
 */
import type { FastifyInstance } from 'fastify';
import { buildActionCard } from '../agents/builder.js';
import { readChanges, repoPath } from './git.js';
import { addNote, getNote, listThreads, setStatus, LIMITS } from './notes.js';
import { renderChangesPage } from './page.js';

export interface ChangesDeps {
  apiKeyOk(given: unknown): boolean;
  reviewerAllowed(headers: Record<string, unknown>): boolean;
  reviewerName(headers: Record<string, unknown>): string | null;
  baseUrlFor(req: { protocol: string; headers: Record<string, unknown> }): string;
  registerPending(card: ReturnType<typeof buildActionCard>, baseUrl: string): { id: string; url: string; tier: number };
}

type Who = { role: 'agent'; name: string } | { role: 'human'; name: string } | null;

export function registerChangesRoutes(app: FastifyInstance, deps: ChangesDeps): void {
  const agentKeySet = () => Boolean(process.env.LITTI_API_KEY);

  /**
   * Agent: valid x-litti-key (or, with no key configured, the x-litti-agent: 1 header).
   * Reviewer: browser allowed in like the inbox. Writes need a custom header (x-litti-ui or
   * x-litti-agent), which a cross-site form or simple request can't send — CSRF guard.
   */
  const who = (headers: Record<string, unknown>, wantsWrite: boolean): Who => {
    const agentName = process.env.LITTI_AGENT_NAME || 'agent';
    if (agentKeySet() && headers['x-litti-key'] !== undefined) {
      return deps.apiKeyOk(headers['x-litti-key']) ? { role: 'agent', name: agentName } : null;
    }
    if (!agentKeySet() && headers['x-litti-agent'] === '1') return { role: 'agent', name: agentName };
    if (!deps.reviewerAllowed(headers)) return null;
    if (wantsWrite && headers['x-litti-ui'] !== '1') return null;
    return { role: 'human', name: deps.reviewerName(headers) || 'reviewer' };
  };
  const denied = (reply: any) => reply.code(401).send({ ok: false, message: 'Not allowed. Agents: send x-litti-key. Reviewers: open /changes locally or behind your SSO proxy.' });

  app.get('/changes', (req, reply) => {
    if (!deps.reviewerAllowed(req.headers)) {
      reply.code(401).type('text/html').send('<!doctype html><meta charset="utf-8"><title>Litti</title><body style="font-family:system-ui;padding:40px"><h1>🔒 Changes needs sign-in</h1><p>Put Litti behind your SSO proxy and set <code>LITTI_IDENTITY_HEADER</code>.</p></body>');
      return;
    }
    reply.type('text/html').header('cache-control', 'no-store').send(renderChangesPage({ reviewer: deps.reviewerName(req.headers) }));
  });

  app.get('/api/changes', async (req, reply) => {
    if (!who(req.headers, false)) return denied(reply);
    try {
      const c = await readChanges();
      return { ok: true, ...c, files: c.files.map(f => ({ ...f })) };
    } catch (err) {
      return reply.code(500).send({ ok: false, message: (err as Error).message.startsWith('Not a git repository') ? `LITTI_REPO_PATH is not a git repository (${repoPath()}).` : 'Could not read changes.' });
    }
  });

  app.get<{ Querystring: { status?: string } }>('/api/notes', (req, reply) => {
    if (!who(req.headers, false)) return denied(reply);
    const status = req.query.status === 'open' || req.query.status === 'resolved' ? req.query.status : undefined;
    return { ok: true, threads: listThreads({ status }) };
  });

  app.post<{ Body: { file?: unknown; line?: unknown; snippet?: unknown; body?: unknown; parentId?: unknown; author?: unknown } }>('/api/notes', (req, reply) => {
    const w = who(req.headers, true);
    if (!w) return denied(reply);
    const b = req.body ?? {};
    const body = typeof b.body === 'string' ? b.body.trim() : '';
    if (!body) return reply.code(400).send({ ok: false, message: 'Required: body.' });
    const parentId = typeof b.parentId === 'string' && b.parentId ? b.parentId : null;
    if (parentId && !getNote(parentId)) return reply.code(404).send({ ok: false, message: 'Unknown note.' });
    const file = typeof b.file === 'string' ? b.file.slice(0, LIMITS.file) : '';
    if (!parentId && !file) return reply.code(400).send({ ok: false, message: 'Required: file (or parentId to reply).' });
    // Agents may name themselves (e.g. "claude-code"); reviewers can't — their name comes from identity.
    const author = w.role === 'agent' && typeof b.author === 'string' && b.author.trim() ? b.author.trim() : w.name;
    const note = addNote({ parentId, file, line: Number(b.line) || 0, snippet: typeof b.snippet === 'string' ? b.snippet : '', author, role: w.role, body });
    return { ok: true, note };
  });

  app.post<{ Params: { id: string }; Body: { open?: unknown } }>('/api/notes/:id/resolve', (req, reply) => {
    if (!who(req.headers, true)) return denied(reply);
    const ok = setStatus(req.params.id, req.body?.open === true ? 'open' : 'resolved');
    if (!ok) return reply.code(404).send({ ok: false, message: 'Unknown thread.' });
    return { ok: true };
  });

  app.post<{ Body: { description?: unknown } }>('/api/changes/review', async (req, reply) => {
    const w = who(req.headers, true);
    if (!w) return denied(reply);
    let c;
    try { c = await readChanges(); } catch { return reply.code(500).send({ ok: false, message: 'Could not read changes.' }); }
    if (!c.files.length) return reply.code(409).send({ ok: false, message: 'Nothing changed — no diff to review.' });
    if (c.truncated) return reply.code(413).send({ ok: false, message: 'The change is too large to review in one go (512 KB). Split it.' });
    const open = listThreads({ status: 'open' }).length;
    const description = typeof req.body?.description === 'string' && req.body.description.trim()
      ? req.body.description.trim().slice(0, 300)
      : `Working-tree changes on ${c.branch} (${c.files.length} file${c.files.length === 1 ? '' : 's'})`;
    const card = buildActionCard({
      agent: process.env.LITTI_AGENT_NAME || 'agent',
      action: 'edit',
      description: open ? `${description} · ${open} open note${open === 1 ? '' : 's'}` : description,
      diff: c.diff,
      touchedPaths: c.files.map(f => f.path).slice(0, 500),
      reversible: true,
      rollbackPlan: `git checkout -- . (branch ${c.branch} @ ${c.head})`,
    });
    const r = deps.registerPending(card, deps.baseUrlFor(req));
    return { ok: true, id: r.id, tier: r.tier, approvalUrl: r.url, openNotes: open };
  });
}
