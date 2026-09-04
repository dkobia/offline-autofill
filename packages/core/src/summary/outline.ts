// The facts about a form the rules can vouch for: how many fields, how many
// required, which sections, what it refuses to fill, what it wants uploaded.
// This is the whole summary when no model is configured, and the part the
// model cannot override when one is: a page cannot talk the summary out of
// saying the form asks for a password.

import type { CollectedField } from "../forms/collect";
import { assessField, type BlockReason } from "../forms/sensitivity";
import { isQuestion } from "../mapping/heuristics";
import type { FormContext } from "./context";

export interface FormOutline {
  /** Visible, editable, unblocked fields. */
  fieldCount: number;
  requiredCount: number;
  /** Distinct section texts among those fields, in order. */
  sections: string[];
  /** Fields whose label is shaped like a question: screening questions the user answers in their own words. */
  questionCount: number;
  /** Distinct reasons among the fields refused on sight. */
  blocked: BlockReason[];
  uploads: string[];
  /** The label of the button that submits the form, when one can be told apart. */
  submit?: string;
}

const MAX_SECTIONS = 8;

const SUBMIT_WORDS = /\b(submit|apply|continue|next|send|sign ?up|register|save|check ?out|pay|place order|finish|complete|proceed|confirm|join|subscribe|create|get started|start)\b/i;

/** The kind of thing a blocked field asks for, in plain words. */
export function blockReasonPhrase(reason: BlockReason): string {
  switch (reason) {
    case "password":
      return "a password";
    case "one-time-code":
      return "a one-time code";
    case "payment-card":
      return "payment card details";
    case "bank-account":
      return "bank account details";
    case "government-id":
      return "a government ID number";
  }
}

export function outlineForm(eligible: CollectedField[], blockedFields: CollectedField[], context: FormContext): FormOutline {
  const sections: string[] = [];
  let requiredCount = 0;
  let questionCount = 0;
  for (const field of eligible) {
    if (field.required) {
      requiredCount += 1;
    }
    if (isQuestion(field.label ?? field.ariaLabel ?? field.nearbyText)) {
      questionCount += 1;
    }
    if (field.sectionText && !sections.includes(field.sectionText) && sections.length < MAX_SECTIONS) {
      sections.push(field.sectionText);
    }
  }
  // Fields and uploads refused on sight, by reason only, so the summary can
  // say the form asks for an ID without ever naming the control.
  const blocked: BlockReason[] = [];
  for (const reason of [...blockedFields.map((field) => assessField(field).reason), ...context.blockedUploads]) {
    if (reason && !blocked.includes(reason)) {
      blocked.push(reason);
    }
  }
  const outline: FormOutline = {
    fieldCount: eligible.length,
    requiredCount,
    sections,
    questionCount,
    blocked,
    uploads: [...context.uploads],
  };
  const submit = context.submit ?? context.buttons.find((label) => SUBMIT_WORDS.test(label));
  if (submit) {
    outline.submit = submit;
  }
  return outline;
}
