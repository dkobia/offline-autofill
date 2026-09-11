// Pure view-model for the fill view: a scan response in, rows and sentences
// out. No DOM, so the copy for every scan outcome is unit tested.

import type { FillOutcome, FillPlan } from "@offline-autofill/core";
import type { Assignment, Attachment, AttachmentChoice, MappingSource, SkipReason } from "@offline-autofill/core";
import type { EngineErrorCode, ScanResponse } from "@offline-autofill/shared";

/** One stored document the user may attach to an upload row. */
export interface FileChoice {
  documentId: string;
  label: string;
}

export interface PlanRow {
  ref: string;
  label: string;
  value: string;
  source: MappingSource;
  /** Shown as a tag; empty for the confident heuristic case. */
  tag: string;
  /** Present for an upload: the planned document and every alternative the field accepts (the planned one first). */
  file?: { documentId: string; choices: FileChoice[] };
}

/** Assignments first, in the form's order, then the attachments (uploads sit at the end of most forms anyway). */
export function planRows(plan: FillPlan): PlanRow[] {
  const values = plan.assignments.map(
    (assignment): PlanRow => ({
      ref: assignment.ref,
      label: assignment.label ?? assignment.key,
      value: assignment.display,
      source: assignment.source,
      tag: tagFor(assignment),
    }),
  );
  const files = plan.attachments.map(
    (attachment): PlanRow => ({
      ref: attachment.ref,
      label: attachment.label ?? attachment.kind,
      value: attachment.fileName,
      source: attachment.source,
      tag: tagFor(attachment),
      file: { documentId: attachment.documentId, choices: attachment.choices.map(choiceOf) },
    }),
  );
  return [...values, ...files];
}

/** The file name, with the user's description after it when there is one, so two resumes can be told apart. */
export function choiceOf(choice: AttachmentChoice): FileChoice {
  return { documentId: choice.documentId, label: choice.description ? `${choice.fileName} · ${choice.description}` : choice.fileName };
}

function tagFor(assignment: Pick<Assignment | Attachment, "source" | "confidence">): string {
  if (assignment.source === "model") {
    return "model";
  }
  if (assignment.source === "user") {
    return "you";
  }
  return assignment.confidence < 0.8 ? "guess" : "";
}

export function skipText(reason: SkipReason): string {
  switch (reason) {
    case "no-value":
      return "nothing in your profile";
    case "already-filled":
      return "already has a value";
    case "no-option-match":
      return "no matching option";
    case "unsupported-type":
      return "checkbox";
    case "unknown-field":
      return "field disappeared";
    case "no-document":
      return "no document of that kind";
    case "not-accepted":
      return "file type not accepted";
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The run-status line after a scan. */
export function scanSummary(scan: Extract<ScanResponse, { ok: true }>): string {
  const parts = [`${scan.plan.assignments.length} of ${plural(scan.fieldCount, "field")} ready to fill`];
  if (scan.uploadCount > 0) {
    parts.push(`${scan.plan.attachments.length} of ${plural(scan.uploadCount, "file")} to attach`);
  }
  if (scan.unmapped.length > 0) {
    parts.push(`${scan.unmapped.length} not recognized`);
  }
  if (scan.blockedCount > 0) {
    parts.push(`${scan.blockedCount} never filled`);
  }
  return parts.join(" · ");
}

export function scanErrorText(scan: Extract<ScanResponse, { ok: false }>): string {
  return scan.message;
}

export function modelErrorText(error: { code: EngineErrorCode; message: string }): string {
  switch (error.code) {
    case "engine-unreachable":
      return "The local model isn’t reachable, so only the built-in rules were used.";
    case "origin-forbidden":
      return "The local model server blocks this extension (see the status above), so only the built-in rules were used.";
    case "model-missing":
      return "The selected model isn’t available on the server, so only the built-in rules were used.";
    case "model-unavailable":
      return `${error.message}, so only the built-in rules were used.`;
    case "engine-error":
      return `The local model failed (${error.message}), so only the built-in rules were used.`;
  }
}

/** "filled 3 fields and attached 1 file", for whichever of the two happened. */
function didText(fields: number, files: number): string {
  const parts: string[] = [];
  if (fields > 0) {
    parts.push(`filled ${plural(fields, "field")}`);
  }
  if (files > 0) {
    parts.push(`attached ${plural(files, "file")}`);
  }
  return parts.join(" and ");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The run-status line after a fill. `fileRefs` says which refs were
 * attachments, so files are counted as such rather than as fields.
 */
export function fillSummary(outcome: FillOutcome, fileRefs: ReadonlySet<string> = new Set()): string {
  const filledFiles = outcome.filled.filter((ref) => fileRefs.has(ref)).length;
  const filledFields = outcome.filled.length - filledFiles;
  if (outcome.failed.length === 0) {
    return `${capitalize(didText(filledFields, filledFiles))}.`;
  }
  if (outcome.filled.length === 0) {
    const failedFiles = outcome.failed.filter((f) => fileRefs.has(f.ref)).length;
    const failedFields = outcome.failed.length - failedFiles;
    const what = [failedFields > 0 ? `fill ${plural(failedFields, "field")}` : "", failedFiles > 0 ? `attach ${plural(failedFiles, "file")}` : ""]
      .filter(Boolean)
      .join(" or ");
    return `Couldn’t ${what}. The page may have changed; scan again.`;
  }
  return `${capitalize(didText(filledFields, filledFiles))}, ${outcome.failed.length} couldn’t be written.`;
}

export function fillButtonText(fields: number, files = 0): string {
  if (fields + files === 0) {
    return "Nothing selected";
  }
  const parts: string[] = [];
  if (fields > 0) {
    parts.push(`Fill ${plural(fields, "field")}`);
  }
  if (files > 0) {
    parts.push(`${fields > 0 ? "attach" : "Attach"} ${plural(files, "file")}`);
  }
  return parts.join(", ");
}
