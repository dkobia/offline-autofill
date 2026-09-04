// What a page could teach the profile: the fields the user filled by hand,
// each with where it would be kept. Rules propose, the user disposes: the
// panel lists every candidate ticked, and only the ticked ones are saved.
// The built-in heuristics and folded value comparison decide here, never the
// model, so the answer is the same with no model configured and a click
// never waits on inference.

import { isProfileKey, fieldSpec, sectionSpec, splitKey, type ProfileKey } from "../profile/keys";
import { cleanQuestion, foldQuestion, newAnswerId, type SavedAnswer } from "../profile/answers";
import { normalizeProfile, resolveValue, type Profile, type SectionValues } from "../profile/schema";
import type { CollectedField } from "../forms/collect";
import type { ReadValue } from "../forms/values";
import { eligibleFields } from "../mapping/resolve";
import { mapByHeuristics } from "../mapping/heuristics";
import { foldValue } from "../fill/execute";
import { matchOption } from "../fill/plan";

/** Where a candidate would be kept. */
export type CandidateTarget =
  /** A new saved answer, with the candidate's question. */
  | { kind: "answer" }
  /** An existing saved answer asking the same question; its answer is replaced. */
  | { kind: "update"; id: string }
  /** A built-in key the rules recognized that the profile has no value for. */
  | { kind: "key"; key: ProfileKey; entry: number };

export interface AnswerCandidate {
  ref: string;
  /** The field as the review list names it. */
  label: string;
  /** The label as a question: markers and trailing colons gone. */
  question: string;
  value: string;
  /** Typed into a textarea. */
  multiline: boolean;
  target: CandidateTarget;
}

/** A value the fill plan assigned to a field; a field still holding it is the extension's own fill. */
export interface PlannedValue {
  ref: string;
  value: string;
}

export interface CaptureInput {
  fields: CollectedField[];
  values: ReadValue[];
  profile: Profile;
  planned?: readonly PlannedValue[];
}

/** What a save did: new answers, answers updated, built-in keys filled in, and candidates left as they were. */
export interface SaveOutcome {
  answers: number;
  updates: number;
  keys: number;
  skipped: number;
}

function fieldLabel(field: CollectedField): string | undefined {
  return field.label ?? field.ariaLabel ?? field.placeholder ?? field.nearbyText;
}


/** Saved answers by folded question; the first of a duplicated question wins, as it does in matching. */
function answersByQuestion(answers: readonly SavedAnswer[]): Map<string, SavedAnswer> {
  const byQuestion = new Map<string, SavedAnswer>();
  for (const saved of answers) {
    const folded = foldQuestion(saved.question);
    if (!byQuestion.has(folded)) {
      byQuestion.set(folded, saved);
    }
  }
  return byQuestion;
}

/**
 * Whether a field still holds what the fill wrote. Folded equality for most
 * controls; a combobox widget shows the option the executor chose, which
 * the option rules may have reached through an alias or a prefix ("United
 * States" choosing "United States of America"), so the same rules judge it.
 */
function holdsPlanned(field: CollectedField, value: string, plannedValue: string | undefined): boolean {
  if (plannedValue === undefined) {
    return false;
  }
  if (foldValue(value) === foldValue(plannedValue)) {
    return true;
  }
  return field.combobox === true && matchOption([{ value, label: value }], plannedValue) !== undefined;
}

/**
 * The candidate rule: a field the scan would offer that holds a value, minus
 * fields still holding what the reviewed plan put there (the extension's own
 * fill), fields the rules map to a key the profile already has a value for,
 * and fields with nothing to match against next time. A value is judged
 * field by field, never against the whole profile: "Engineer" in "What role
 * are you applying for?" is an answer even when it is also the job title.
 */
export function proposeAnswers({ fields, values, profile, planned = [] }: CaptureInput): AnswerCandidate[] {
  const { eligible } = eligibleFields(fields);
  const byRef = new Map(eligible.map((field) => [field.ref, field]));
  const { mapped } = mapByHeuristics(eligible);
  const mappingByRef = new Map(mapped.map((mapping) => [mapping.ref, mapping]));
  const plannedByRef = new Map(planned.map((item) => [item.ref, item.value]));
  const byQuestion = answersByQuestion(profile.answers);
  const out: AnswerCandidate[] = [];
  for (const { ref, value } of values) {
    const field = byRef.get(ref);
    if (!field || field.type === "checkbox" || value.trim() === "") {
      continue;
    }
    const label = fieldLabel(field);
    const question = label ? cleanQuestion(label) : "";
    if (!label || question === "") {
      continue;
    }
    if (holdsPlanned(field, value, plannedByRef.get(ref))) {
      continue; // what the fill wrote, still there
    }
    let target: CandidateTarget | undefined;
    const mapping = mappingByRef.get(ref);
    if (mapping && isProfileKey(mapping.key)) {
      if (fieldSpec(mapping.key).derived || resolveValue(profile, mapping.key, mapping.entry) !== undefined) {
        continue;
      }
      target = { kind: "key", key: mapping.key, entry: mapping.entry };
    } else {
      const existing = byQuestion.get(foldQuestion(question));
      if (existing && foldValue(existing.answer) === foldValue(value)) {
        continue; // the same answer to the same question: nothing to learn
      }
      target = existing ? { kind: "update", id: existing.id } : { kind: "answer" };
    }
    out.push({ ref, label, question, value: value.trim(), multiline: field.tag === "textarea", target });
  }
  return out;
}

/**
 * The profile with the chosen candidates saved into it, and what happened to
 * each; the input is left as it was. A candidate that no longer applies (a
 * key filled in since the review, a blank) is skipped and counted.
 */
export function applyAnswers(profile: Profile, chosen: readonly AnswerCandidate[]): { profile: Profile; outcome: SaveOutcome } {
  const next = normalizeProfile(profile);
  const taken = new Set(next.answers.map((saved) => saved.id));
  const outcome: SaveOutcome = { answers: 0, updates: 0, keys: 0, skipped: 0 };
  for (const candidate of chosen) {
    const value = candidate.value.trim();
    if (value === "") {
      outcome.skipped += 1;
      continue;
    }
    const { target } = candidate;
    if (target.kind === "key") {
      // A key filled in since the review (in the editor, or by another save) keeps its value.
      if (!isProfileKey(target.key) || fieldSpec(target.key).derived || resolveValue(next, target.key, target.entry) !== undefined) {
        outcome.skipped += 1;
        continue;
      }
      const { section, field } = splitKey(target.key);
      if (sectionSpec(section).repeating) {
        const list = next[section] as SectionValues[];
        while (list.length <= target.entry) {
          list.push({});
        }
        list[target.entry]![field] = value;
      } else {
        (next[section] as SectionValues)[field] = value;
      }
      outcome.keys += 1;
      continue;
    }
    const question = cleanQuestion(candidate.question);
    if (question === "") {
      outcome.skipped += 1;
      continue;
    }
    // An update names its answer, and that answer must still ask the reviewed
    // question (its question may have been edited since). Otherwise, and for
    // a new answer whose question is already saved (a duplicated field, or an
    // answer added a moment ago), the answer with that question is updated,
    // so one question keeps one answer.
    const named = target.kind === "update" ? next.answers.find((saved) => saved.id === target.id) : undefined;
    const existing =
      named && foldQuestion(named.question) === foldQuestion(question) ? named : answersByQuestion(next.answers).get(foldQuestion(question));
    if (existing) {
      existing.answer = value;
      if (candidate.multiline) {
        existing.multiline = true;
      } else {
        delete existing.multiline;
      }
      outcome.updates += 1;
      continue;
    }
    const id = newAnswerId(taken);
    taken.add(id);
    const saved: SavedAnswer = { id, question, answer: value };
    if (candidate.multiline) {
      saved.multiline = true;
    }
    next.answers.push(saved);
    outcome.answers += 1;
  }
  return { profile: normalizeProfile(next), outcome };
}
