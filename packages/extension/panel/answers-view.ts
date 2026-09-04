// Pure view-model for "Save answers": the candidates the background read
// from the page in, review rows and sentences out. No DOM, so the copy for
// every outcome is unit tested. Mirrors plan-view.ts: a row per field, a
// tag saying where it goes, ticked by default, the user unticks.

import {
  fieldSpec,
  sectionSpec,
  splitKey,
  type AnswerCandidate,
  type CandidateTarget,
  type FillPlan,
  type PlannedValue,
  type SaveOutcome,
} from "@offline-autofill/core";
import type { ReadAnswersResponse } from "@offline-autofill/shared";

export interface AnswerRow {
  ref: string;
  label: string;
  value: string;
  /** Where the answer goes: "Answers", "Update", or the profile field ("Contact · LinkedIn"). */
  tag: string;
  multiline: boolean;
}

export const NOTHING_TO_SAVE = "Nothing new to save on this page.";
export const CAPTURE_INTRO = "What you typed into this form. Tick what to keep; nothing is saved until you do.";
export const READING_STATUS = "Reading what you typed…";
export const DIFFERENT_PAGE = "This is a different page from the one you scanned. Scan it first.";
export const PROFILE_UNSAVED = "Save your profile changes first, so saving answers does not lose them.";

/** Where a candidate would be kept, as a short tag. */
export function targetTag(target: CandidateTarget): string {
  switch (target.kind) {
    case "answer":
      return "Answers";
    case "update":
      return "Update";
    case "key": {
      const { section, field } = splitKey(target.key);
      const spec = sectionSpec(section);
      const where = spec.repeating ? `${spec.label} ${target.entry + 1}` : spec.label;
      return `${where} · ${fieldSpec(target.key).label}`;
    }
  }
}

export function answerRows(candidates: AnswerCandidate[]): AnswerRow[] {
  return candidates.map((candidate) => ({
    ref: candidate.ref,
    label: candidate.label,
    value: candidate.value,
    tag: targetTag(candidate.target),
    multiline: candidate.multiline,
  }));
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The run-status line while the review list is showing. */
export function captureSummary(candidates: AnswerCandidate[]): string {
  const toProfile = candidates.filter((candidate) => candidate.target.kind === "key").length;
  const parts = [`${plural(candidates.length - toProfile, "answer")} you typed`];
  if (toProfile > 0) {
    parts.push(`${plural(toProfile, "profile field")} to fill in`);
  }
  return parts.join(" · ");
}

export function saveAnswersButtonText(count: number): string {
  return count === 0 ? "Nothing selected" : `Save ${plural(count, "answer")}`;
}

/** The run-status line after a save: what actually happened, as the background counted it. */
export function savedText(outcome: SaveOutcome): string {
  const answers = outcome.answers + outcome.updates;
  const parts: string[] = [];
  if (answers > 0) {
    parts.push(`saved ${plural(answers, "answer")}`);
  }
  if (outcome.keys > 0) {
    parts.push(`filled in ${plural(outcome.keys, "profile field")}`);
  }
  const done = parts.length > 0 ? `${parts.join(" and ")}.` : "nothing to save.";
  const skipped = `${plural(outcome.skipped, "field")} already had a value and ${outcome.skipped === 1 ? "was" : "were"} left alone.`;
  const text = outcome.skipped > 0 ? `${done} ${skipped}` : done;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function readAnswersErrorText(response: Extract<ReadAnswersResponse, { ok: false }>): string {
  return response.message;
}

/**
 * What the plan actually put on the page: the assignments whose write
 * succeeded, as the user sees them (an option's label, not its value, since
 * that is what is read back). Nothing was filled until Fill was clicked,
 * an unticked row was never written, and a failed write left the user's
 * own value in place; none of those may hide what the user typed.
 */
export function plannedValues(plan: FillPlan, filled: ReadonlySet<string>): PlannedValue[] {
  return plan.assignments.filter((assignment) => filled.has(assignment.ref)).map((assignment) => ({ ref: assignment.ref, value: assignment.display }));
}
