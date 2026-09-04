// Saved answers: what the user typed into a form's own questions ("Why do
// you want to work here?", "Desired salary") and asked to keep. Each is a
// question and an answer under a stable id. The question is the description
// of a user-defined key `answer.<id>` that sits beside the built-in
// vocabulary; the model reads questions the way it reads the built-in key
// descriptions and the page's labels. The answer is a value: it appears in
// planFill and nowhere before it. AnswerSpec is the value-free view the
// mapping layer works with, so nothing in mapping/ can carry an answer.

import type { ProfileKey } from "./keys";

export interface SavedAnswer {
  /** Short random id, stable for the answer's life; the key is `answer.<id>`. */
  id: string;
  /** The cleaned field label; the model reads this. */
  question: string;
  /** Never in any prompt. */
  answer: string;
  /** Captured from a textarea: edited in one, and never written into a single-line input. */
  multiline?: true;
}

/** A saved answer without its answer: what the heuristics, the prompt, and the parser are given. */
export interface AnswerSpec {
  key: AnswerKey;
  question: string;
  multiline?: true;
}

export type AnswerKey = `answer.${string}`;

/** Anything a field mapping may point at: a built-in key or a saved answer. */
export type FillKey = ProfileKey | AnswerKey;

export const ANSWER_KEY_PREFIX = "answer.";
export const MAX_QUESTION_CHARS = 200;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function answerKey(id: string): AnswerKey {
  return `${ANSWER_KEY_PREFIX}${id}`;
}

export function isAnswerKey(value: unknown): value is AnswerKey {
  return typeof value === "string" && value.startsWith(ANSWER_KEY_PREFIX) && ID_PATTERN.test(value.slice(ANSWER_KEY_PREFIX.length));
}

export function answerIdOf(key: AnswerKey): string {
  return key.slice(ANSWER_KEY_PREFIX.length);
}

/** Eight hex characters: short enough to spend few prompt tokens, checked for collisions where it is issued. */
export function newAnswerId(taken: ReadonlySet<string> = new Set()): string {
  for (;;) {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    if (!taken.has(id)) {
      return id;
    }
  }
}

/** Required and optional markers pages hang on labels; "required" inside a question ("Is a visa required?") is kept. */
const MARKERS = /\(\s*(?:required|optional|mandatory)\s*\)|\b(?:required|optional|mandatory)\s*$|\*/gi;

/** A field label as a question worth keeping: markers, trailing colons, and extra whitespace gone; capped. */
export function cleanQuestion(label: string): string {
  return label
    .replace(/\s+/g, " ")
    .replace(MARKERS, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s:]+$/g, "")
    .trim()
    .slice(0, MAX_QUESTION_CHARS);
}

/** The comparison form of a question or label: cleaned, lower case, punctuation gone, one space between words. */
export function foldQuestion(text: string): string {
  return cleanQuestion(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Coerces whatever storage holds into valid answers: blanks dropped, text
 * trimmed and capped, one entry per id and one per question (the first
 * wins, as it does in matching).
 */
export function normalizeAnswers(raw: unknown): SavedAnswer[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const questions = new Set<string>();
  const out: SavedAnswer[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const { id, question, answer, multiline } = item as Record<string, unknown>;
    if (typeof id !== "string" || !ID_PATTERN.test(id) || seen.has(id)) {
      continue;
    }
    const cleanedQuestion = typeof question === "string" ? cleanQuestion(question) : "";
    const trimmedAnswer = typeof answer === "string" ? answer.trim() : "";
    if (cleanedQuestion === "" || trimmedAnswer === "" || questions.has(foldQuestion(cleanedQuestion))) {
      continue;
    }
    seen.add(id);
    questions.add(foldQuestion(cleanedQuestion));
    const saved: SavedAnswer = { id, question: cleanedQuestion, answer: trimmedAnswer };
    if (multiline === true) {
      saved.multiline = true;
    }
    out.push(saved);
  }
  return out;
}

/** The answers as the mapping layer may see them: keys and questions, never answers. */
export function describeAnswers(answers: readonly SavedAnswer[]): AnswerSpec[] {
  return answers.map((saved) => {
    const spec: AnswerSpec = { key: answerKey(saved.id), question: saved.question };
    if (saved.multiline) {
      spec.multiline = true;
    }
    return spec;
  });
}
