// What the model says about a form, and the contract an engine implements to
// say it. The summary is display-only: nothing downstream acts on it, so a
// misleading answer can mislead a reader but never a fill.

import type { FormContext } from "./context";
import type { CollectedField } from "../forms/collect";
import type { BlockReason } from "../forms/sensitivity";

export interface FormSummary {
  /** What the form is for and what submitting it does. */
  purpose: string;
  /** How to complete it, a few short items. */
  howTo: string[];
  /** Things worth knowing before starting. */
  notes: string[];
}

/** Everything the prompt is built from. Carries no profile value and no field ref. */
export interface SummaryInput {
  context: FormContext;
  /** Visible, editable, unblocked fields. */
  fields: CollectedField[];
  /** The kinds of blocked fields on the page, as kinds only; the fields themselves stay out. */
  blocked: BlockReason[];
}

/**
 * Something that can describe a form, typically the same local model behind
 * the FieldMapper. Resolves to undefined when the answer was unusable.
 */
export interface FormSummarizer {
  readonly name: string;
  summarizeForm(input: SummaryInput, signal?: AbortSignal): Promise<FormSummary | undefined>;
}
