/**
 * Review challenges: how a reviewer proves they read the diff.
 *
 * The multiple-choice quiz is only one kind. Litti picks a different kind per action
 * (weighted random, never the same kind twice in a row) so approving never becomes
 * muscle memory:
 *
 *  - quiz       pick the right fact from 4 options
 *  - spot-line  click the line in the diff that does the risky thing
 *  - type-in    type the table / function / route / value from memory (no options to guess from)
 *  - canary     "was this exact line in the change?" — sometimes it's a subtly altered fake
 *  - count      type how many lines the change adds or removes (small diffs only)
 *  - explain    write a one-sentence summary in your own words; it must name what changed.
 *               The summary is stored in the receipt as evidence.
 *
 * Tier 2+ never uses the guessable kinds (canary, count).
 * Deterministic and local: no diff content leaves the process.
 */
import { randomInt } from 'node:crypto';
import type { ActionCard, ChallengeKind, PendingAction, Quiz, Tier } from '../types.js';
import { generateQuiz } from './gatekeeper.js';

export const CHALLENGE_KINDS: ChallengeKind[] = ['quiz', 'spot-line', 'type-in', 'canary', 'count', 'explain'];

const WEIGHTS: Record<'low' | 'high', Partial<Record<ChallengeKind, number>>> = {
  low: { quiz: 30, 'spot-line': 20, 'type-in': 15, canary: 15, count: 10, explain: 10 },
  high: { quiz: 30, 'spot-line': 25, 'type-in': 20, explain: 25 },
};

const MAX_ANSWER = 600;
const MIN_EXPLAIN_WORDS = 6;

/** A generated challenge plus the server-side expected answer (never sent to the browser). */
export interface Challenge { quiz: Quiz; answer: string }

/** A changed line of the diff, numbered the way the review page numbers it (1-based). */
interface Changed { n: number; sign: '+' | '-'; text: string }

function changedLines(diff: string): Changed[] {
  return diff.split('\n').flatMap((line, i) =>
    /^[+-]/.test(line) && !/^(\+\+\+|---)(\s|$)/.test(line)
      ? [{ n: i + 1, sign: line[0] as '+' | '-', text: line.slice(1) }]
      : []);
}

/** A concrete fact the diff states, with the line(s) that state it. */
interface Fact { category: string; value: string; lines: number[]; spot: string; type: string }

/** Extract facts by category. Each category lists every line and value that answers it. */
function facts(diff: string): Fact[] {
  const ch = changedLines(diff);
  const byCat = new Map<string, Fact>();
  const add = (category: string, value: string, line: number, spot: string, type: string) => {
    const f = byCat.get(category) ?? { category, value, lines: [], spot, type };
    if (!f.lines.includes(line)) f.lines.push(line);
    byCat.set(category, f);
  };
  const values = new Map<string, Set<string>>();
  const note = (cat: string, v: string) => { const s = values.get(cat) ?? new Set(); s.add(v); values.set(cat, s); };

  for (const c of ch) {
    const drop = c.text.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)/i);
    if (drop) { add('drop', drop[1], c.n, 'Click the line that permanently deletes data.', 'Type the name of the table this change drops.'); note('drop', drop[1]); continue; }
    const table = c.text.match(/(?:ALTER|CREATE)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)/i);
    if (table) { add('table', table[1], c.n, 'Click the line that creates or alters a table.', 'Type the name of the table this migration changes.'); note('table', table[1]); continue; }
    const rm = c.text.match(/rm\s+-rf\s+(\S+)/);
    if (rm) { add('rm', rm[1], c.n, 'Click the line that deletes files from disk.', 'Type the path this change deletes with rm -rf.'); note('rm', rm[1]); continue; }
    const route = c.text.match(/\.(?:get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/i);
    if (route) { add('route', route[1], c.n, 'Click the line that defines the API route this change touches.', 'Type the API route this change modifies (e.g. /api/...).'); note('route', route[1]); continue; }
    if (c.sign === '+') {
      const sym = c.text.match(/(?:function\s+|(?:const|let|var|class)\s+|def\s+)([A-Za-z_]\w*)/);
      if (sym) { add('symbol', sym[1], c.n, 'Click the line that defines the function or symbol this change adds or modifies.', 'Type the name of the function or symbol this change adds or modifies.'); note('symbol', sym[1]); }
    }
  }

  // Property whose value changes: "-  prop: old;" then "+  prop: new;". The + line is the answer.
  for (const del of ch.filter(c => c.sign === '-')) {
    const m = del.text.match(/^\s*([a-z-]+)\s*:\s*([^;]+);/);
    if (!m) continue;
    const plus = ch.find(c => c.sign === '+' && new RegExp(`^\\s*${m[1]}\\s*:`).test(c.text));
    const next = plus?.text.match(/:\s*([^;]+);/)?.[1].trim();
    if (plus && next && next !== m[2].trim()) {
      add(`prop:${m[1]}`, next, plus.n, `Click the line that sets the new value of "${m[1]}".`, `Type the new value of "${m[1]}".`);
      note(`prop:${m[1]}`, next);
    }
  }
  // Each category accepts every value it found (e.g. two dropped tables → either name).
  return [...byCat.values()].map(f => ({ ...f, value: [...(values.get(f.category) ?? [f.value])].join('|') }));
}

const STOP = new Set(('const let var function return true false null undefined this that from import export default class with then else when where '
  + 'select into values table create alter drop insert update delete string number void async await new public private static each have will '
  + 'diff file line lines index exists not and the for http https').split(' '));

/** Words a summary can use to show it names the actual change. */
export function keywords(card: ActionCard): string[] {
  const out = new Set<string>();
  for (const c of changedLines(card.diff)) {
    for (const w of c.text.match(/[A-Za-z_][A-Za-z0-9_]{3,}/g) ?? []) {
      const lw = w.toLowerCase();
      if (!STOP.has(lw)) out.add(lw);
    }
  }
  for (const p of card.touchedPaths) {
    const base = p.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '').toLowerCase();
    if (base && base.length >= 3) out.add(base);
  }
  return [...out].slice(0, 60);
}

function pick<T>(items: T[]): T { return items[randomInt(items.length)]; }

/** Alter one real line just enough that a skimmer won't notice. Returns null if it can't. */
function mutate(text: string, diff: string): string | null {
  const num = text.match(/\d+(\.\d+)?/);
  if (num) {
    const n = Number(num[0]);
    for (const alt of [n * 2, n + 1, n === 0 ? 1 : n - 1, n * 10]) {
      const s = Number.isInteger(n) ? String(alt) : alt.toFixed(num[1]!.length - 1);
      const fake = text.replace(num[0], s);
      if (fake !== text && !diff.includes(fake)) return fake;
    }
  }
  const SWAPS: Record<string, string> = {
    true: 'false', false: 'true', '===': '!==', '!==': '===', '<=': '<', '>=': '>', '&&': '||', '||': '&&',
    ASC: 'DESC', DESC: 'ASC', NOT: '', add: 'remove', enable: 'disable', allow: 'deny', min: 'max', max: 'min',
  };
  for (const [from, to] of Object.entries(SWAPS)) {
    const re = new RegExp(/^\w+$/.test(from) ? `\\b${from}\\b` : from.replace(/[|&=<>!]/g, '\\$&'));
    if (re.test(text)) {
      const fake = text.replace(re, to).replace(/\s{2,}/g, ' ');
      if (fake !== text && !diff.includes(fake)) return fake;
    }
  }
  return null;
}

/** Build one challenge of the given kind, or null when the diff doesn't support it. */
export function buildChallenge(kind: ChallengeKind, card: ActionCard): Challenge | null {
  const diff = card.diff;
  const ch = changedLines(diff);
  switch (kind) {
    case 'quiz': {
      const quiz = { ...generateQuiz(card), kind };
      return { quiz, answer: quiz.options[quiz.correctIndex] };
    }
    case 'spot-line': {
      const fs = facts(diff);
      if (!fs.length) return null;
      const f = pick(fs);
      // Too many right answers makes it a coin toss over the whole diff: skip.
      if (f.lines.length > 3) return null;
      return { quiz: { kind, question: f.spot, options: [], correctIndex: -1 }, answer: f.lines.sort((a, b) => a - b).join(',') };
    }
    case 'type-in': {
      const fs = facts(diff);
      if (!fs.length) return null;
      const f = pick(fs);
      return { quiz: { kind, question: f.type, options: [], correctIndex: -1 }, answer: f.value.toLowerCase() };
    }
    case 'canary': {
      const lines = ch.filter(c => c.text.trim().length >= 10 && c.text.length <= 160);
      if (!lines.length) return null;
      const real = pick(lines);
      const fake = randomInt(2) === 0 ? mutate(real.text.trim(), diff) : null;
      return {
        quiz: {
          kind,
          question: `Does this exact line appear in the change (${real.sign === '+' ? 'added' : 'removed'})?`,
          options: ['Yes — it is in the diff', 'No — it is not'],
          correctIndex: -1,
          subject: fake ?? real.text.trim(),
        },
        answer: fake ? 'no' : 'yes',
      };
    }
    case 'count': {
      const added = ch.filter(c => c.sign === '+').length;
      const removed = ch.length - added;
      const options: Array<['add' | 'remove', number]> = [];
      if (added > 0 && added <= 15) options.push(['add', added]);
      if (removed > 0 && removed <= 15) options.push(['remove', removed]);
      if (!options.length) return null;
      const [verb, n] = pick(options);
      return { quiz: { kind, question: `How many lines does this change ${verb}? (count the ${verb === 'add' ? 'green' : 'red'} lines)`, options: [], correctIndex: -1 }, answer: String(n) };
    }
    case 'explain': {
      return {
        quiz: {
          kind,
          question: `In one sentence and your own words: what does this change do? Name at least one thing it changes (a table, function, file, setting…). At least ${MIN_EXPLAIN_WORDS} words.`,
          options: [], correctIndex: -1,
        },
        answer: keywords(card).join('|'),
      };
    }
  }
}

/** Kinds an operator allows via LITTI_CHALLENGES (comma list). Defaults to all. */
export function allowedKinds(env = process.env): ChallengeKind[] {
  const raw = (env.LITTI_CHALLENGES || '').split(',').map(s => s.trim()).filter(Boolean);
  const list = raw.filter((k): k is ChallengeKind => (CHALLENGE_KINDS as string[]).includes(k));
  return list.length ? list : CHALLENGE_KINDS;
}

/**
 * Pick a challenge for an action: weighted random over the kinds this diff supports,
 * avoiding the previous kind so consecutive reviews feel different. Falls back to the quiz.
 */
export function chooseChallenge(card: ActionCard, tier: Tier, opts: { lastKind?: string | null; allowed?: ChallengeKind[] } = {}): Challenge {
  const weights = WEIGHTS[tier >= 2 ? 'high' : 'low'];
  const allowed = opts.allowed ?? allowedKinds();
  let pool = (Object.keys(weights) as ChallengeKind[]).filter(k => allowed.includes(k));
  // The operator's explicit LITTI_CHALLENGES choice wins over the tier filter.
  if (!pool.length) pool = allowed;
  if (pool.length > 1 && opts.lastKind) pool = pool.filter(k => k !== opts.lastKind);

  const built = pool.map(k => ({ k, c: buildChallenge(k, card), w: weights[k] ?? 10 })).filter(x => x.c);
  if (!built.length) return buildChallenge('quiz', card)!;
  let roll = randomInt(built.reduce((s, x) => s + x.w, 0));
  for (const x of built) { if ((roll -= x.w) < 0) return x.c!; }
  return built[0].c!;
}

const norm = (s: string) => s.normalize('NFKC').trim().replace(/^[`'"]+|[`'";]+$/g, '').replace(/\s+/g, ' ').toLowerCase();

/** True when a and b differ by at most one insert, delete or substitution. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Check a reviewer's answer against the expected answer for the challenge kind. */
export function checkAnswer(kind: ChallengeKind | undefined, expected: string, given: unknown, card: ActionCard): boolean {
  const g = String(given ?? '').slice(0, MAX_ANSWER);
  switch (kind ?? 'quiz') {
    case 'quiz': return g === expected;
    case 'spot-line': return /^\d+$/.test(g.trim()) && expected.split(',').includes(String(Number(g.trim())));
    case 'type-in': {
      // A wrong answer counts as a rubber-stamp, so forgive one typo on longer names.
      const a = norm(g);
      return a !== '' && expected.split('|').some(e => e === a || (e.length >= 6 && oneEditApart(e, a)));
    }
    case 'canary': return norm(g) === expected;
    case 'count': return /^\s*\d+\s*$/.test(g) && Number(g) === Number(expected);
    case 'explain': {
      const text = norm(g);
      const words = text.split(' ').filter(w => /[a-z0-9]/.test(w));
      if (words.length < MIN_EXPLAIN_WORDS || text.length < 25) return false;
      // Copying the agent's own description is not a summary.
      const desc = norm(card.description);
      if (desc.length >= 15 && text.includes(desc)) return false;
      const keys = expected.split('|').filter(Boolean);
      if (!keys.length) return true;
      const tokens = new Set(text.split(/[^a-z0-9_]+/));
      return keys.some(k => tokens.has(k) || (k.length >= 6 && text.includes(k)));
    }
  }
  return false;
}

/** A passing answer for a pending action. For tests and the scripted demo only. */
export function sampleAnswer(p: PendingAction): string {
  switch (p.quiz.kind ?? 'quiz') {
    case 'spot-line': return p.quizAnswer.split(',')[0];
    case 'type-in': return p.quizAnswer.split('|')[0];
    case 'explain': return `This change updates ${p.quizAnswer.split('|')[0] || 'the code'} and I checked what it does carefully.`;
    default: return p.quizAnswer;
  }
}
