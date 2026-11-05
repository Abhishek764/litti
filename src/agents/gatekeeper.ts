/** Independent gatekeeper: deterministic tiering + template-based quiz. No LLM. */
import { randomInt } from 'node:crypto';
import type { ActionCard, Quiz, RiskAssessment } from '../types.js';
import { assessRisk } from '../rules/tiering.js';

/** Fisher-Yates shuffle that also reports where the correct answer landed. */
function shuffleWithCorrect(options: string[], correctIndex: number): { options: string[]; correctIndex: number } {
  const tagged = options.map((opt, i) => ({ opt, correct: i === correctIndex }));
  for (let i = tagged.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
  }
  return {
    options: tagged.map(t => t.opt),
    correctIndex: tagged.findIndex(t => t.correct),
  };
}

/** Generate a comprehension quiz by extracting facts from the diff. */
export function generateQuiz(card: ActionCard): Quiz {
  const diff = card.diff;

  // Migration: extract table name.
  const tableMatch = diff.match(/(?:ALTER|CREATE|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?[`"]?(\w+)[`"]?/i);
  if (tableMatch) {
    const { options, correctIndex } = shuffleWithCorrect(
      [tableMatch[1], 'sessions', 'products', 'audit_log'], 0);
    return { question: 'Which table is being modified in this migration?', options, correctIndex };
  }

  // Function/variable name.
  const funcMatch = diff.match(/(?:function|const|let|var|export)\s+(\w+)/);
  if (funcMatch) {
    const { options, correctIndex } = shuffleWithCorrect(
      [funcMatch[1], 'handleRequest', 'validateInput', 'processQueue'], 0);
    return { question: 'What function/symbol is being modified?', options, correctIndex };
  }

  // Fallback: file count.
  const fileCount = card.touchedPaths.length;
  const { options, correctIndex } = shuffleWithCorrect(
    [String(fileCount), String(fileCount + 2), String(fileCount + 5), '1'], 0);
  return { question: 'How many files does this change touch?', options, correctIndex };
}

/** Run the full gatekeeper assessment: risk tier + quiz. */
export function gatekeep(card: ActionCard): { assessment: RiskAssessment; quiz: Quiz } {
  return { assessment: assessRisk(card), quiz: generateQuiz(card) };
}
