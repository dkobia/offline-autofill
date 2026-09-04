// Turns mappings plus the profile into concrete assignments: which ref gets
// which string, with options matched and dates shaped to the control, and
// upload mappings plus the stored documents into attachments: which file
// input gets which file. This is the first point where profile values (and
// documents) appear, and it is pure: the panel shows the plan for review
// before anything touches the page.

import type { CollectedField, FieldOption } from "../forms/collect";
import type { UploadField } from "../forms/uploads";
import { documentKey, type DocumentKey, type DocumentKind } from "../documents/kinds";
import { acceptsFile, newestFirst, type StoredDocument } from "../documents/store";
import type { FillKey } from "../profile/answers";
import { fieldSpec, isProfileKey } from "../profile/keys";
import { answerOf, resolveValue, type Profile } from "../profile/schema";
import type { FieldMapping, MappingSource } from "../mapping/types";
import type { UploadMapping } from "../mapping/uploads";
import { aliasesOf } from "./aliases";

export interface Assignment {
  ref: string;
  key: FillKey;
  entry: number;
  /** The exact string the control will receive (an option's value for selects and radios). */
  value: string;
  /** What the panel shows: the option's label, or the value itself. */
  display: string;
  source: MappingSource;
  confidence: number;
  /** The field's label, for the review list. */
  label?: string;
}

export type SkipReason =
  | "no-value"
  | "already-filled"
  | "no-option-match"
  | "unsupported-type"
  | "unknown-field"
  | "no-document"
  | "not-accepted";

export interface Skipped {
  ref: string;
  /** The key a field asked for (built-in or saved answer), or the document kind an upload did. */
  key: FillKey | DocumentKey;
  reason: SkipReason;
  label?: string;
}

/** A stored document the user may attach to an upload instead of the planned one. */
export interface AttachmentChoice {
  documentId: string;
  fileName: string;
  description: string;
  kind: DocumentKind;
}

export interface Attachment {
  ref: string;
  kind: DocumentKind;
  /** The planned document: the newest of the mapped kind the field accepts. */
  documentId: string;
  fileName: string;
  /** Every stored document the field accepts, the mapped kind first, newest first; the planned one leads. */
  choices: AttachmentChoice[];
  source: MappingSource;
  confidence: number;
  /** The upload's label, for the review list. */
  label?: string;
}

export interface FillPlan {
  assignments: Assignment[];
  attachments: Attachment[];
  skipped: Skipped[];
}

/** What attachments are planned from: the page's uploads, their kinds, and what the user has stored. */
export interface AttachInput {
  uploads: UploadField[];
  mappings: UploadMapping[];
  documents: StoredDocument[];
}

export interface PlanOptions {
  /** Fill fields that already hold a value (default false: the user's own input wins). Applies to uploads too. */
  overwrite?: boolean;
  attach?: AttachInput;
}

/** An option whose value or label equals the value, then one that aliases it, then a prefix match. */
export function matchOption(options: FieldOption[], value: string): FieldOption | undefined {
  const wanted = aliasesOf(value);
  const norm = (text: string) => text.trim().toLowerCase();
  const exact = options.find((option) => wanted.has(norm(option.value)) || wanted.has(norm(option.label)));
  if (exact) {
    return exact;
  }
  const target = norm(value);
  if (target.length < 3) {
    return undefined;
  }
  return options.find((option) => norm(option.label).startsWith(target) || norm(option.value).startsWith(target));
}

/** Shapes a stored date to what the control accepts; unknown shapes pass through. */
export function shapeDate(value: string, type: string): string {
  const iso = value.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!iso) {
    return value;
  }
  const [, year, month, day] = iso;
  if (type === "month") {
    return `${year}-${month}`;
  }
  if (type === "date") {
    return day ? value : `${year}-${month}-01`;
  }
  if (type === "number") {
    return year!;
  }
  return value;
}

function fieldLabel(field: CollectedField): string | undefined {
  return field.label ?? field.ariaLabel ?? field.placeholder ?? field.nearbyText;
}

/**
 * Pairs each mapped upload with a stored document of its kind. Documents
 * the field does not accept are left out; a kind with no stored document,
 * or none the field accepts, is a skip the user can act on (add one).
 */
export function planAttachments({ uploads, mappings, documents }: AttachInput, options: PlanOptions = {}): { attachments: Attachment[]; skipped: Skipped[] } {
  const byRef = new Map(uploads.map((upload) => [upload.ref, upload]));
  const stored = newestFirst(documents);
  const attachments: Attachment[] = [];
  const skipped: Skipped[] = [];
  for (const mapping of mappings) {
    const upload = byRef.get(mapping.ref);
    const skip = (reason: SkipReason) => {
      const entry: Skipped = { ref: mapping.ref, key: documentKey(mapping.kind), reason };
      if (upload?.label) entry.label = upload.label;
      skipped.push(entry);
    };
    if (!upload) {
      skip("unknown-field");
      continue;
    }
    if (upload.hasValue && !options.overwrite) {
      skip("already-filled");
      continue;
    }
    const ofKind = stored.filter((document) => document.kind === mapping.kind);
    if (ofKind.length === 0) {
      skip("no-document");
      continue;
    }
    const accepted = (list: StoredDocument[]) => list.filter((document) => acceptsFile(upload.accept, document.fileName, document.mimeType));
    const planned = accepted(ofKind)[0];
    if (!planned) {
      skip("not-accepted");
      continue;
    }
    const others = accepted(stored.filter((document) => document.kind !== mapping.kind));
    const attachment: Attachment = {
      ref: mapping.ref,
      kind: mapping.kind,
      documentId: planned.id,
      fileName: planned.fileName,
      choices: [...accepted(ofKind), ...others].map(({ id, fileName, description, kind }) => ({ documentId: id, fileName, description, kind })),
      source: mapping.source,
      confidence: mapping.confidence,
    };
    if (upload.label) attachment.label = upload.label;
    attachments.push(attachment);
  }
  return { attachments, skipped };
}

export function planFill(
  fields: CollectedField[],
  mappings: FieldMapping[],
  profile: Profile,
  options: PlanOptions = {},
): FillPlan {
  const byRef = new Map(fields.map((field) => [field.ref, field]));
  const assignments: Assignment[] = [];
  const skipped: Skipped[] = [];

  for (const mapping of mappings) {
    const field = byRef.get(mapping.ref);
    const skip = (reason: SkipReason) => {
      const entry: Skipped = { ref: mapping.ref, key: mapping.key, reason };
      const label = field ? fieldLabel(field) : undefined;
      if (label) entry.label = label;
      skipped.push(entry);
    };
    if (!field) {
      skip("unknown-field");
      continue;
    }
    if (field.type === "checkbox") {
      skip("unsupported-type");
      continue;
    }
    if (field.hasValue && !options.overwrite) {
      skip("already-filled");
      continue;
    }
    const raw = resolveValue(profile, mapping.key, mapping.entry);
    if (raw === undefined) {
      skip("no-value");
      continue;
    }

    let value = raw;
    let display = raw;
    if (field.options && field.options.length > 0) {
      const option = matchOption(field.options, raw);
      if (!option) {
        skip("no-option-match");
        continue;
      }
      value = option.value;
      display = option.label || option.value;
    } else if (isProfileKey(mapping.key) && (fieldSpec(mapping.key).kind === "date" || fieldSpec(mapping.key).kind === "month")) {
      value = shapeDate(raw, field.type);
      display = value;
    }

    const assignment: Assignment = {
      ref: mapping.ref,
      key: mapping.key,
      entry: mapping.entry,
      value,
      display,
      source: mapping.source,
      confidence: mapping.confidence,
    };
    // A saved answer's question names a field that has no label of its own.
    const label = fieldLabel(field) ?? answerOf(profile, mapping.key)?.question;
    if (label) assignment.label = label;
    assignments.push(assignment);
  }

  const attached = options.attach ? planAttachments(options.attach, options) : { attachments: [], skipped: [] };
  return { assignments, attachments: attached.attachments, skipped: [...skipped, ...attached.skipped] };
}
