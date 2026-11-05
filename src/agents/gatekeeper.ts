/** Independent gatekeeper: deterministic tiering + template-based quiz. No LLM. */
import { randomInt } from 'node:crypto';
import type { ActionCard, Quiz, RiskAssessment } from '../types.js';
import { assessRisk } from '../rules/tiering.js';

/** Fisher-Yates shuffle (crypto RNG so the correct slot can't be predicted). */
function shuffle<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a 4-option quiz. Distractors are always distinct from the answer and
 * never appear in the diff, so there is exactly one defensible answer.
 */
function makeQuiz(question: string, correct: string, pool: string[], diff: string): Quiz {
  const distractors: string[] = [];
  for (const p of shuffle(pool)) {
    if (distractors.length === 3) break;
    if (p !== correct && !distractors.includes(p) && !diff.includes(p)) distractors.push(p);
  }
  const options = shuffle([correct, ...distractors]);
  return { question, options, correctIndex: options.indexOf(correct) };
}

const TABLES = ['sessions', 'products', 'audit_log', 'orders', 'invoices', 'payments', 'accounts', 'customers', 'events', 'api_keys'];
const SYMBOLS = ['handleRequest', 'validateInput', 'processQueue', 'renderPage', 'parseConfig', 'sendEmail', 'loadUser', 'syncCache'];
const PATHS = ['/var/log/app/', '/tmp/build-cache/', '/srv/static/', '/home/deploy/backups/', '/opt/app/releases/'];
const ENDPOINTS = ['/api/users', '/api/orders', '/api/login', '/api/health', '/api/payments', '/api/search'];

/** Generate a comprehension quiz by extracting a fact from the changed lines of the diff. */
export function generateQuiz(card: ActionCard): Quiz {
  const diff = card.diff;
  // Only lines the change adds or removes (skip ---/+++ file headers).
  const changed = diff.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)\s/.test(l)).map(l => l.slice(1)).join('\n');

  const dropped = changed.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)/i);
  if (dropped) return makeQuiz('Which table does this change permanently DROP?', dropped[1], TABLES, diff);

  const table = changed.match(/(?:ALTER|CREATE)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)/i);
  if (table) return makeQuiz('Which table does this migration alter?', table[1], TABLES, diff);

  const rmrf = changed.match(/rm\s+-rf\s+(\S+)/);
  if (rmrf) return makeQuiz('Which path is deleted with rm -rf?', rmrf[1], PATHS, diff);

  // CSS / config property whose value changes: "-  prop: old;" then "+  prop: new;".
  const removed = [...diff.matchAll(/^-\s*([a-z-]+)\s*:\s*([^;]+);/gm)];
  for (const m of removed) {
    const added = diff.match(new RegExp(`^\\+\\s*${m[1]}\\s*:\\s*([^;]+);`, 'm'));
    if (added && added[1].trim() !== m[2].trim()) {
      const next = added[1].trim();
      const num = next.match(/^(\d+(?:\.\d+)?)([a-z%]*)$/);
      const pool = num
        ? [m[2].trim(), ...[2, 4, 12, 16, 24, 0].map(n => `${n}${num[2]}`)]
        : [m[2].trim(), 'none', 'inherit', 'auto', 'initial'];
      return makeQuiz(`What does "${m[1]}" change to?`, next, pool, '');
    }
  }

  const endpoint = changed.match(/\.(?:get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/i);
  if (endpoint) return makeQuiz('Which endpoint does this change modify?', endpoint[1], ENDPOINTS, diff);

  const symbol = changed.match(/(?:function\s+|(?:const|let|var|class)\s+|def\s+)([A-Za-z_]\w*)/);
  if (symbol) return makeQuiz('Which function/symbol does this change modify?', symbol[1], SYMBOLS, diff);

  // Fallback: lines added. Distinct numbers, no duplicates.
  const added = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
  const nums = [added + 1, added + 3, Math.max(0, added - 2), added + 7, added * 2 + 1].map(String);
  return makeQuiz('How many lines does this change add?', String(added), nums, '');
}

/** Run the full gatekeeper assessment: risk tier + quiz. */
export function gatekeep(card: ActionCard): { assessment: RiskAssessment; quiz: Quiz } {
  return { assessment: assessRisk(card), quiz: generateQuiz(card) };
}
