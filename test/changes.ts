/** Changes workspace tests: git reading, notes conversation, auth/CSRF, one-click review. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
process.env.SECRET_KEY = 'changes-test-secret-'.repeat(3);
const repo = mkdtempSync(join(tmpdir(), 'litti-changes-'));
process.env.LITTI_REPO_PATH = repo;
process.env.LITTI_AGENT_NAME = 'claude-code';
import { initDb, getPending } from '../src/chain/db.js';
import { buildServer, setNotifier } from '../src/approval/server.js';
import { readChanges, splitDiff } from '../src/changes/git.js';
import { notARepoMessage } from '../src/changes/routes.js';
import { renderChangesPage } from '../src/changes/page.js';

const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' }).toString();
git('init', '-q');
git('config', 'user.email', 't@example.test');
git('config', 'user.name', 'T');
git('config', 'core.autocrlf', 'false');
mkdirSync(join(repo, 'src'));
writeFileSync(join(repo, 'src', 'pay.ts'), 'export function charge(a: number) {\n  return a;\n}\n');
writeFileSync(join(repo, 'old.txt'), 'bye\n');
git('add', '.');
git('commit', '-q', '-m', 'init');

initDb(':memory:');
setNotifier(null);
const app = buildServer();
const ui = { 'x-litti-ui': '1' };
const agent = { 'x-litti-agent': '1' };

let passed = 0;
async function step(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`  ✓ ${name}`); }

try {
  await step('clean tree: no changes, review refused', async () => {
    const c = await readChanges(repo);
    assert.equal(c.files.length, 0);
    const r = await app.inject({ method: 'POST', url: '/api/changes/review', headers: ui, payload: {} });
    assert.equal(r.statusCode, 409);
  });

  await step('reads edits, deletions and untracked files with line counts', async () => {
    writeFileSync(join(repo, 'src', 'pay.ts'), 'export function charge(a: number) {\n  return a * 100;\n}\n');
    rmSync(join(repo, 'old.txt'));
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const fee = 3;\nexport const cap = 9;\n');
    const c = await readChanges(repo);
    const by = Object.fromEntries(c.files.map(f => [f.path, f]));
    assert.deepEqual(Object.keys(by).sort(), ['old.txt', 'src/new.ts', 'src/pay.ts']);
    assert.equal(by['src/pay.ts'].status, 'modified');
    assert.deepEqual([by['src/pay.ts'].added, by['src/pay.ts'].removed], [1, 1]);
    assert.equal(by['old.txt'].status, 'deleted');
    assert.equal(by['src/new.ts'].status, 'added');
    assert.equal(by['src/new.ts'].added, 2);
    assert.match(c.version, /^[0-9a-f]{16}$/);
    assert.equal(splitDiff(c.diff).length, 3, 'combined diff splits back into the same files');
  });

  await step('version changes when the agent edits again', async () => {
    const a = (await readChanges(repo)).version;
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const fee = 4;\n');
    assert.notEqual((await readChanges(repo)).version, a);
  });

  await step('page and API render for reviewers', async () => {
    const page = await app.inject({ method: 'GET', url: '/changes' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Request review/);
    // The page script lives in a TS template string, where escapes get eaten: it must still parse.
    for (const m of page.body.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]), 'Changes page script parses');
    const api = (await app.inject({ method: 'GET', url: '/api/changes' })).json();
    assert.equal(api.ok, true);
    assert.equal(api.files.length, 3);
  });

  let threadId = '';
  await step('reviewer comments on a line, agent reads and replies, reviewer resolves', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/notes', headers: ui, payload: { file: 'src/pay.ts', line: 2, snippet: '  return a * 100;', body: 'Why cents here? Callers pass cents already.' } });
    assert.equal(c.statusCode, 200);
    const note = c.json().note;
    threadId = note.id;
    assert.equal(note.role, 'human');

    const open = (await app.inject({ method: 'GET', url: '/api/notes?status=open', headers: agent })).json();
    assert.equal(open.threads.length, 1);
    assert.equal(open.threads[0].file, 'src/pay.ts');

    const r = (await app.inject({ method: 'POST', url: '/api/notes', headers: agent, payload: { parentId: threadId, body: 'Good catch — reverted to a.' } })).json();
    assert.equal(r.note.role, 'agent');
    assert.equal(r.note.author, 'claude-code');
    assert.equal(r.note.parentId, threadId);

    // Replying to a reply still lands in the same thread.
    const r2 = (await app.inject({ method: 'POST', url: '/api/notes', headers: ui, payload: { parentId: r.note.id, body: 'Thanks' } })).json();
    assert.equal(r2.note.parentId, threadId);

    assert.equal((await app.inject({ method: 'POST', url: `/api/notes/${threadId}/resolve`, headers: ui, payload: {} })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/notes?status=open', headers: agent })).json().threads.length, 0);
    const all = (await app.inject({ method: 'GET', url: '/api/notes', headers: agent })).json().threads;
    assert.equal(all[0].replies.length, 2);
  });

  await step('a human reply reopens a resolved thread', async () => {
    await app.inject({ method: 'POST', url: '/api/notes', headers: ui, payload: { parentId: threadId, body: 'Actually, one more thing' } });
    assert.equal((await app.inject({ method: 'GET', url: '/api/notes?status=open', headers: agent })).json().threads.length, 1);
  });

  await step('CSRF: browser writes without x-litti-ui are refused; bad input rejected', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/api/notes', payload: { file: 'a', body: 'x' } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/changes/review', payload: {} })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/notes', headers: ui, payload: { file: 'a', body: '   ' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/notes', headers: ui, payload: { body: 'no file' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/notes', headers: ui, payload: { parentId: 'note_nope', body: 'x' } })).statusCode, 404);
  });

  await step('with LITTI_API_KEY: agents need the key, reviewers need SSO, reviewers cannot pose as agent', async () => {
    process.env.LITTI_API_KEY = 'agent-key';
    process.env.LITTI_IDENTITY_HEADER = 'x-forwarded-email';
    try {
      assert.equal((await app.inject({ method: 'GET', url: '/api/notes', headers: agent })).statusCode, 401, 'x-litti-agent alone is not enough');
      assert.equal((await app.inject({ method: 'GET', url: '/api/notes', headers: { 'x-litti-key': 'wrong' } })).statusCode, 401);
      assert.equal((await app.inject({ method: 'GET', url: '/api/notes', headers: { 'x-litti-key': 'agent-key' } })).statusCode, 200);
      assert.equal((await app.inject({ method: 'GET', url: '/changes' })).statusCode, 401);
      const sso = { ...ui, 'x-forwarded-email': 'lee@acme.test' };
      const n = (await app.inject({ method: 'POST', url: '/api/notes', headers: sso, payload: { file: 'src/new.ts', line: 1, body: 'Is 4 right?', author: 'claude-code' } })).json();
      assert.equal(n.note.author, 'lee@acme.test', 'reviewer name comes from SSO, not the body');
      assert.equal(n.note.role, 'human');
    } finally {
      delete process.env.LITTI_API_KEY;
      delete process.env.LITTI_IDENTITY_HEADER;
    }
  });

  await step('one click: the working-tree diff becomes a Litti action with a challenge', async () => {
    const r = (await app.inject({ method: 'POST', url: '/api/changes/review', headers: agent, payload: { description: 'Charge in cents' } })).json();
    assert.equal(r.ok, true);
    assert.ok(r.tier >= 1);
    assert.match(r.approvalUrl, /\/approve\//);
    const p = getPending(r.id)!;
    assert.equal(p.actionCard.agent, 'claude-code');
    assert.deepEqual(p.actionCard.touchedPaths.sort(), ['old.txt', 'src/new.ts', 'src/pay.ts']);
    assert.match(p.actionCard.description, /open note/);
    assert.ok(p.quiz.kind, 'has a comprehension check');
  });

  await step('not a git repo: clear error', async () => {
    const prev = process.env.LITTI_REPO_PATH;
    process.env.LITTI_REPO_PATH = tmpdir();
    try {
      const r = await app.inject({ method: 'GET', url: '/api/changes' });
      // tmpdir may itself sit inside a repo on some machines; only assert when it doesn't.
      if (r.statusCode !== 200) {
        assert.equal(r.statusCode, 409);
        assert.equal(r.json().code, 'not-a-repo');
        assert.equal(r.json().folder, resolve(tmpdir()));
        assert.match(r.json().message, /LITTI_REPO_PATH points to .+, which isn't a git repository/);
        const review = await app.inject({ method: 'POST', url: '/api/changes/review', headers: ui, payload: {} });
        assert.equal(review.json().code, 'not-a-repo');
      }
    } finally { process.env.LITTI_REPO_PATH = prev; }
    // Started in a plain folder without LITTI_REPO_PATH: name the folder and say how to fix it (USER-9).
    const msg = notARepoMessage({ ...process.env, LITTI_REPO_PATH: '' });
    assert.match(msg, new RegExp(`Litti was started in ${process.cwd().replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}, which isn't a git repository`));
    assert.match(msg, /start `litti` from your project folder/);
    assert.match(msg, /LITTI_REPO_PATH in ~\/\.litti\/config\.env/);
  });

  await step('changes page: an error replaces every loading placeholder and disables review', () => {
    const html = renderChangesPage({ reviewer: null });
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    assert.match(script, /function showProblem/);
    assert.match(script, /if\(!c\.ok\)\{showProblem\(c\);return;\}/);
    for (const id of ['crumb', 'files', 'main', 'review']) assert.match(script.slice(script.indexOf('function showProblem')), new RegExp(`getElementById\\('${id}'\\)`), id);
    assert.match(script, /setAttribute\('role','alert'\)/);
  });
} finally {
  await app.close();
  rmSync(repo, { recursive: true, force: true });
}

console.log(`\nchanges: ${passed} passed`);
