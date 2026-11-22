/** Review challenge tests: every kind, the chooser, the checker, the review page, and the full server flow. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
process.env.SECRET_KEY = 'challenge-test-secret-'.repeat(3);
process.env.LITTI_ALLOW_SELF_ASSERTED = 'true';
process.env.LITTI_DEPLOY_DIR = join(process.env.TEMP || '/tmp', `litti-ch-${process.pid}`);
import { initDb, getPending } from '../src/chain/db.js';
import { buildActionCard } from '../src/agents/builder.js';
import { buildChallenge, chooseChallenge, checkAnswer, allowedKinds, sampleAnswer, diffLineKinds, CHALLENGE_KINDS } from '../src/agents/challenges.js';
import { buildServer, registerPending, setNotifier } from '../src/approval/server.js';
import { renderApprovalPage } from '../src/approval/page.js';
import { issueViewStamp } from '../src/approval/identity.js';
import type { ActionCard, ChallengeKind, PendingAction } from '../src/types.js';

initDb(':memory:');
setNotifier(null);

const sample = (f: string) => readFileSync(join('demo', 'sample-diffs', f), 'utf8');
const card = (diff: string, description = 'Change under review', paths = ['src/x.ts']): ActionCard =>
  buildActionCard({ action: 'edit', description, diff, touchedPaths: paths, reversible: true, rollbackPlan: '' });

const MIGRATION = card(sample('migration.diff'), 'Add migration', ['migrations/x.sql']);
const CSS = card(sample('css-fix.diff'), 'Round the buttons', ['src/styles/button.css']);
const CODE = card('--- a/src/pay.ts\n+++ b/src/pay.ts\n@@ -1,3 +1,3 @@\n-export function chargeCard(amount) { return amount; }\n+export function chargeCard(amount) { return amount * 100; }\n const retries = 3;', 'Charge in cents', ['src/pay.ts']);
const pendingOf = (c: ActionCard, kind: ChallengeKind): PendingAction => {
  const ch = buildChallenge(kind, c)!;
  return { id: c.id, actionCard: c, tier: 1, requiredApprovers: 1, currentApprovals: [], quiz: ch.quiz, quizAnswer: ch.answer, status: 'pending', createdAt: '' };
};

let passed = 0;
async function step(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`  ✓ ${name}`); }

await step('every kind builds for a code diff, and its sample answer passes', () => {
  for (const kind of CHALLENGE_KINDS) {
    for (let i = 0; i < 20; i++) {
      const p = pendingOf(CODE, kind);
      assert.equal(p.quiz.kind, kind);
      assert.ok(checkAnswer(kind, p.quizAnswer, sampleAnswer(p), CODE), `${kind}: sample answer should pass`);
      assert.equal(checkAnswer(kind, p.quizAnswer, '', CODE), false, `${kind}: empty answer fails`);
    }
  }
});

await step('spot-line: only the risky line counts', () => {
  const ch = buildChallenge('spot-line', MIGRATION)!;
  const lines = MIGRATION.diff.split('\n');
  for (const n of ch.answer.split(',')) assert.match(lines[Number(n) - 1], /^[+-]/, 'answer is a changed line');
  assert.equal(checkAnswer('spot-line', ch.answer, '1', MIGRATION), false, 'file header line is wrong');
  assert.equal(checkAnswer('spot-line', ch.answer, 'abc', MIGRATION), false);
  const css = buildChallenge('spot-line', CSS)!;
  assert.match(css.quiz.question, /border-radius/);
  assert.match(lines.length ? CSS.diff.split('\n')[Number(css.answer) - 1] : '', /^\+.*8px/);
});

await step('type-in: case-insensitive, quotes ignored, one typo forgiven on long names only', () => {
  const p = pendingOf(CODE, 'type-in');
  assert.equal(p.quizAnswer, 'chargecard');
  assert.ok(checkAnswer('type-in', p.quizAnswer, 'ChargeCard', CODE));
  assert.ok(checkAnswer('type-in', p.quizAnswer, '`chargeCard`', CODE));
  assert.ok(checkAnswer('type-in', p.quizAnswer, 'chargeCrd', CODE), 'one typo ok');
  assert.equal(checkAnswer('type-in', p.quizAnswer, 'chrgeCrd', CODE), false, 'two typos not ok');
  assert.equal(checkAnswer('type-in', p.quizAnswer, 'refund', CODE), false);
  assert.equal(checkAnswer('type-in', 'users', 'user', MIGRATION), false, 'short names must be exact');
});

await step('canary: fakes never appear in the diff, real lines always do', () => {
  let fakes = 0, reals = 0;
  for (let i = 0; i < 60; i++) {
    const ch = buildChallenge('canary', CODE)!;
    const shown = ch.quiz.subject!;
    if (ch.answer === 'no') { fakes++; assert.ok(!CODE.diff.includes(shown), `fake leaked: ${shown}`); }
    else { reals++; assert.ok(CODE.diff.includes(shown)); }
    assert.equal(checkAnswer('canary', ch.answer, ch.answer === 'yes' ? 'no' : 'yes', CODE), false);
  }
  assert.ok(fakes > 5 && reals > 5, `both outcomes happen (fakes ${fakes}, reals ${reals})`);
});

await step('count: exact integer only, skipped on big diffs', () => {
  const ch = buildChallenge('count', CODE)!;
  assert.ok(checkAnswer('count', ch.answer, ` ${ch.answer} `, CODE));
  assert.equal(checkAnswer('count', ch.answer, `${Number(ch.answer) + 1}`, CODE), false);
  assert.equal(checkAnswer('count', ch.answer, `${ch.answer}.0`, CODE), false);
  const big = card(Array.from({ length: 30 }, (_, i) => `+line ${i}`).join('\n'));
  assert.equal(buildChallenge('count', big), null);
});

await step('explain: needs 6+ words naming the change; copying the description fails', () => {
  const p = pendingOf(CODE, 'explain');
  const ok = 'Converts the chargeCard amount into cents by multiplying it';
  assert.ok(checkAnswer('explain', p.quizAnswer, ok, CODE));
  assert.equal(checkAnswer('explain', p.quizAnswer, 'Looks good to me', CODE), false, 'too short');
  assert.equal(checkAnswer('explain', p.quizAnswer, 'I reviewed everything and it looks totally fine to ship', CODE), false, 'names nothing');
  const long = card(CODE.diff, 'Multiply the charge amount by one hundred for cents');
  const lp = pendingOf(long, 'explain');
  assert.equal(checkAnswer('explain', lp.quizAnswer, 'Multiply the charge amount by one hundred for cents', long), false, 'copied description');
});

await step('chooser: varies kinds, never repeats the last kind, quiz is not every time', () => {
  const seen = new Map<string, number>();
  let last: string | undefined;
  for (let i = 0; i < 300; i++) {
    const ch = chooseChallenge(CODE, 1, { lastKind: last });
    assert.notEqual(ch.quiz.kind, last, 'same kind twice in a row');
    last = ch.quiz.kind;
    seen.set(last!, (seen.get(last!) ?? 0) + 1);
  }
  assert.equal(seen.size, CHALLENGE_KINDS.length, `all kinds used: ${[...seen.keys()]}`);
  const quizShare = (seen.get('quiz') ?? 0) / 300;
  assert.ok(quizShare > 0.1 && quizShare < 0.5, `quiz share ${quizShare}`);
});

await step('chooser: tier 2+ never uses guessable kinds; LITTI_CHALLENGES restricts', () => {
  for (let i = 0; i < 200; i++) {
    const k = chooseChallenge(CODE, 2).quiz.kind;
    assert.ok(k !== 'canary' && k !== 'count', `tier 2 got ${k}`);
  }
  assert.deepEqual(allowedKinds({ LITTI_CHALLENGES: 'quiz, explain, bogus' }), ['quiz', 'explain']);
  assert.deepEqual(allowedKinds({}), CHALLENGE_KINDS);
  for (let i = 0; i < 30; i++) assert.equal(chooseChallenge(CODE, 1, { allowed: ['explain'] }).quiz.kind, 'explain');
  // A diff with no extractable facts still gets a check.
  const bare = card('+hello world');
  for (let i = 0; i < 30; i++) assert.ok(chooseChallenge(bare, 2, { allowed: ['spot-line'] }).quiz.kind);
});

await step('review page renders the right input for each kind, and never the answer', () => {
  const base = { tier: 1 as const, reasons: [], requiredApprovers: 1, approvalsSoFar: 0, approver: '', identityLocked: false, allowTyped: true, viewStamp: 'v', ticket: '' };
  const expect: Record<ChallengeKind, RegExp> = {
    quiz: /type="radio" name="quiz"/, 'spot-line': /class="ln [^"]*pick"/, 'type-in': /<input id="answer"/,
    canary: /class="canary"/, count: /type="number"/, explain: /<textarea id="answer"/,
  };
  for (const kind of CHALLENGE_KINDS) {
    const ch = buildChallenge(kind, CODE)!;
    const html = renderApprovalPage({ ...base, card: CODE, quiz: ch.quiz });
    assert.match(html, expect[kind], kind);
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]), `${kind}: page script parses`);
    if (kind === 'canary') assert.ok(!html.includes(`value="${ch.answer === 'yes' ? 'Yes' : 'No'} —`), 'canary options carry no hint');
  }
});

await step('explain: the served word counter splits on whitespace and updates before the box is ticked', () => {
  // USER-3 / FIELD-6: `\s` inside the TS template was served as `s`, so words split on the letter "s".
  const base = { tier: 2 as const, reasons: [], requiredApprovers: 1, approvalsSoFar: 0, approver: '', identityLocked: false, allowTyped: true, viewStamp: 'v', ticket: '' };
  const html = renderApprovalPage({ ...base, card: CODE, quiz: buildChallenge('explain', CODE)!.quiz });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const fns = script.match(/function selectedAnswer\(\)\{[\s\S]*?\nfunction refresh\(\)\{.*\}/)![0];
  const run = (text: string, checked = false) => {
    const wc = { textContent: '' };
    const btn = { disabled: true };
    const doc = { querySelector: () => null, getElementById: (id: string) => (id === 'answer' ? { value: text } : id === 'wc' ? wc : null) };
    new Function('document', 'kind', 'picked', 'reviewed', 'scrolled', 'btn', `${fns}\nrefresh();`)(doc, 'explain', null, { checked }, true, btn);
    return { words: wc.textContent, disabled: btn.disabled };
  };
  assert.equal(run('Drops the legacy token table and purges sessions').words, '8 / 6 words', 'counts real words, before the box is ticked');
  assert.equal(run('Adds the Claude hook\tconfig file\n to the  repo').words, '9 / 6 words', 'tabs, newlines, double spaces');
  assert.equal(run('This seems fine ss').words, '4 / 6 words', 'the letter s is not a separator');
  assert.equal(run('Drops the legacy token table and purges sessions', true).disabled, false, 'enabled once ticked');
  assert.equal(run('too short here', true).disabled, true, 'under 6 words stays disabled');
});

await step('inline page scripts keep their backslashes (no lone `\\x` inside a TS template)', () => {
  // A single backslash inside a template literal is eaten (`\s` -> `s`); page scripts must double it.
  for (const f of ['src/approval/page.ts', 'src/approval/inbox.ts', 'src/changes/page.ts', 'src/connect/page.ts', 'src/docs/site.ts']) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      for (const run of m[1].matchAll(/\\+/g)) assert.equal(run[0].length % 2, 0, `${f}: lone backslash near "${m[1].slice(Math.max(0, run.index! - 30), run.index! + 10)}"`);
    }
  }
});

await step('type-in accepts quoted, schema-qualified, hyphenated and unicode table names (QA-7)', () => {
  const cases: Array<[string, string[], string[]]> = [
    ['DROP TABLE "user-data";', ['user-data', '"user-data"'], ['user']],
    ['DROP TABLE public.users;', ['public.users', 'users', 'PUBLIC.USERS'], ['public']],
    ['DROP TABLE IF EXISTS "public"."users";', ['public.users', 'users', '"public"."users"'], ['public']],
    ['DROP TABLE `café_orders`;', ['café_orders', 'café_orders'.normalize('NFC')], ['caf']],
    ['ALTER TABLE [dbo].[Orders] ADD x int;', ['dbo.orders', 'Orders'], ['dbo']],
  ];
  for (const [sql, good, bad] of cases) {
    const c = card(`@@ -1 +1 @@\n+${sql}`, 'Schema change', ['db/m.sql']);
    const ch = buildChallenge('type-in', c)!;
    for (const g of good) assert.ok(checkAnswer('type-in', ch.answer, g, c), `${sql}: "${g}" should pass (expected ${ch.answer})`);
    for (const b of bad) assert.equal(checkAnswer('type-in', ch.answer, b, c), false, `${sql}: "${b}" should fail`);
  }
});

await step('type-in property values compare whitespace-normalised (QA-7)', () => {
  const c = card('@@ -1,3 +1,3 @@\n .btn {\n-  margin: 0 auto;\n+  margin:\t0  8px\tauto;\n }', 'Spacing', ['a.css']);
  const ch = buildChallenge('type-in', c)!;
  assert.equal(ch.answer, '0 8px auto');
  assert.ok(checkAnswer('type-in', ch.answer, '0 8px auto', c));
  assert.ok(checkAnswer('type-in', ch.answer, '0   8px  auto', c));
  // Only whitespace changed: no property fact (and so no challenge on it).
  const same = card('@@ -1,3 +1,3 @@\n .btn {\n-  margin: 0 auto;\n+  margin: 0  auto;\n }', 'Spacing', ['a.css']);
  assert.equal(buildChallenge('type-in', same), null);
});

await step('count matches the lines the page colours, including ++/-- content (QA-8)', () => {
  const diff = '--- a/x.c\n+++ b/x.c\n@@ -1,3 +1,3 @@\n+++counter;\n+int x = 1;\n--- old sql comment\n ctx';
  assert.deepEqual(diffLineKinds(diff), ['meta', 'meta', 'hunk', 'add', 'add', 'del', 'ctx']);
  const c = card(diff, 'Counter', ['x.c']);
  const html = renderApprovalPage({ card: c, tier: 1, reasons: [], requiredApprovers: 1, approvalsSoFar: 0, quiz: { kind: 'count', question: 'q', options: [], correctIndex: -1 }, approver: '', identityLocked: false, allowTyped: true, viewStamp: '', ticket: '' });
  const green = (html.match(/class="ln add"/g) ?? []).length;
  const red = (html.match(/class="ln del"/g) ?? []).length;
  assert.deepEqual([green, red], [2, 1]);
  for (let i = 0; i < 30; i++) {
    const ch = buildChallenge('count', c)!;
    assert.equal(ch.answer, ch.quiz.question.includes('add') ? String(green) : String(red));
  }
  // Second file in a plain unified diff: its headers are not changes.
  const two = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n--- a/y\n+++ b/y\n@@ -1 +1 @@\n-c\n+d';
  assert.deepEqual(diffLineKinds(two).filter(k => k === 'add' || k === 'del').length, 4);
  // No hunks at all (agent-written): plain prefix rule, header-looking lines skipped.
  assert.deepEqual(diffLineKinds('+++ b/x\n+a\n-b'), ['meta', 'add', 'del']);
});

await step('explain is never offered without keywords, and file names alone do not pass (QA-13)', () => {
  const bin = card('diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ', 'New logo', ['logo.png']);
  assert.equal(buildChallenge('explain', bin), null);
  for (let i = 0; i < 20; i++) assert.notEqual(chooseChallenge(bin, 1, { allowed: ['explain', 'quiz'] }).quiz.kind, 'explain');
  const c = card('@@ -1 +1 @@\n-export const rate = 1;\n+export const rate = 2;', 'Rate', ['src/pay.ts']);
  const ch = buildChallenge('explain', c)!;
  assert.equal(checkAnswer('explain', ch.answer, 'Looks good to me, the pay stuff is fine, approve it please', c), false);
  assert.ok(checkAnswer('explain', ch.answer, 'This doubles the exported rate constant from one to two', c));
  assert.equal(checkAnswer('explain', '', 'any six words at all will do here', c), false);
});

await step('server: each kind can be passed end to end, and a wrong answer is blocked', async () => {
  const app = buildServer();
  for (const kind of CHALLENGE_KINDS) {
    process.env.LITTI_CHALLENGES = kind;
    const c = card(CODE.diff, `Charge in cents (${kind})`, ['src/pay.ts']);
    registerPending(c, 'http://t');
    const p = getPending(c.id)!;
    assert.equal(p.quiz.kind, kind, 'kind persisted');
    const page = await app.inject({ method: 'GET', url: `/approve/${c.id}` });
    assert.equal(page.statusCode, 200);
    const submit = (approver: string, quizAnswer: string) => app.inject({
      method: 'POST', url: `/approve/${c.id}/submit`,
      payload: { approver, quizAnswer, scrolledToBottom: true, timeSpentMs: 40000, viewStamp: issueViewStamp(c.id, Date.now() - 40000) },
    }).then(r => r.json());
    const bad = await submit('wrong-wendy', kind === 'canary' ? (p.quizAnswer === 'yes' ? 'no' : 'yes') : kind === 'count' ? '999' : 'nope');
    assert.equal(bad.ok, false, `${kind}: wrong answer blocked`);
    const good = await submit('right-rita', sampleAnswer(getPending(c.id)!));
    assert.equal(good.ok, true, `${kind}: ${good.message}`);
  }
  delete process.env.LITTI_CHALLENGES;
  await app.close();
});

console.log(`\nchallenges: ${passed} passed`);
