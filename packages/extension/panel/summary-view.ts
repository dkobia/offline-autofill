// Pure view-model for the form summary card: a describe response in, the
// card's copy out. No DOM, so every state (working, rules only, model, model
// failed) is unit tested. The rules' outline is always shown as a strip of
// facts; the model's prose sits above it when there is any.

import { blockReasonPhrase, type FormOutline } from "@offline-autofill/core";
import type { DescribeResponse, EngineErrorCode } from "@offline-autofill/shared";

export type SummaryState = { kind: "idle" } | { kind: "working" } | { kind: "ready"; response: DescribeResponse };

export interface SummaryView {
  hidden: boolean;
  working: boolean;
  /** Who wrote the description; empty while working. */
  tag: "model" | "rules" | "";
  purpose: string;
  howTo: string[];
  notes: string[];
  /** Why the model's description is missing, when it was expected. */
  note: string;
  /** The rules' facts, dot-separated. */
  facts: string;
}

/**
 * Whether a description belongs next to the plan on screen. Each request
 * finds the active tab on its own, so a tab switch between them would pair
 * one tab's plan with another's description; with no plan yet, anything goes.
 */
export function describesPlan(planTabId: number | null, describedTabId: number): boolean {
  return planTabId === null || planTabId === describedTabId;
}

const EMPTY: SummaryView = { hidden: true, working: false, tag: "", purpose: "", howTo: [], notes: [], note: "", facts: "" };

export function summaryView(state: SummaryState): SummaryView {
  if (state.kind === "idle") {
    return EMPTY;
  }
  if (state.kind === "working") {
    return { ...EMPTY, hidden: false, working: true };
  }
  const { response } = state;
  if (!response.ok) {
    return EMPTY;
  }
  const facts = factsLine(response.outline);
  if (response.summary) {
    return {
      hidden: false,
      working: false,
      tag: "model",
      purpose: response.summary.purpose,
      howTo: response.summary.howTo,
      notes: response.summary.notes,
      note: "",
      facts,
    };
  }
  return {
    hidden: false,
    working: false,
    tag: "rules",
    purpose: rulesPurpose(response.outline),
    howTo: [],
    notes: rulesNotes(response.outline),
    note: response.modelError ? modelNote(response.modelError) : response.usedModel ? "The model didn’t return a usable description." : "",
    facts,
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "a and b", "a, b, and c"; past four items, the first three and a count. */
function listPhrase(items: string[], noun: string): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  if (items.length <= 4) {
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  }
  return `${items.slice(0, 3).join(", ")}, and ${plural(items.length - 3, `more ${noun}`)}`;
}

/** One sentence the rules can vouch for, including how the form is submitted when a button says so. */
export function rulesPurpose(outline: FormOutline): string {
  const fields = outline.fieldCount === 0 ? "no fillable fields" : plural(outline.fieldCount, "fillable field");
  const sections = outline.sections.length > 0 ? ` across ${listPhrase(outline.sections, "section")}` : "";
  const submit = outline.submit ? `, submitted with “${outline.submit}”` : "";
  return `A form with ${fields}${sections}${submit}.`;
}

export function rulesNotes(outline: FormOutline): string[] {
  const notes: string[] = [];
  if (outline.blocked.length > 0) {
    notes.push(`It also asks for ${listPhrase(outline.blocked.map(blockReasonPhrase), "kind")}, which Offline Autofill never fills.`);
  }
  if (outline.uploads.length > 0) {
    notes.push(`It asks you to attach: ${outline.uploads.join(", ")}.`);
  }
  if (outline.questionCount > 0) {
    // Question-shaped selects and radio groups count too, so not "in your own words".
    notes.push(`${plural(outline.questionCount, "question")} to answer yourself.`);
  }
  return notes;
}

export function factsLine(outline: FormOutline): string {
  const parts = [plural(outline.fieldCount, "field")];
  if (outline.requiredCount > 0) {
    parts.push(`${outline.requiredCount} required`);
  }
  if (outline.uploads.length > 0) {
    parts.push(plural(outline.uploads.length, "upload"));
  }
  if (outline.questionCount > 0) {
    parts.push(plural(outline.questionCount, "question"));
  }
  if (outline.blocked.length > 0) {
    parts.push(`never fills ${outline.blocked.map(blockReasonPhrase).join(", ")}`);
  }
  return parts.join(" · ");
}

function modelNote(error: { code: EngineErrorCode; message: string }): string {
  switch (error.code) {
    case "engine-unreachable":
      return "The local model isn’t reachable, so this is what the built-in rules found.";
    case "origin-forbidden":
      return "The local model server blocks this extension, so this is what the built-in rules found.";
    case "model-missing":
      return "The selected model isn’t available on the server, so this is what the built-in rules found.";
    case "model-unavailable":
      return `${error.message}, so this is what the built-in rules found.`;
    case "engine-error":
      return `The local model failed (${error.message}), so this is what the built-in rules found.`;
  }
}
