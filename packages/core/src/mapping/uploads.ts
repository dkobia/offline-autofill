// Upload-to-kind mapping: which stored document a file input asks for.
// Same shape as field mapping - sensitivity rules first, word patterns
// second, the model for what is left - and the same guarantee: the model
// sees the upload's label and name and the kind vocabulary, never a
// document, a file name, or what the user wrote about one.

import type { UploadField } from "../forms/uploads";
import { assessDocumentText, tokenize, type BlockReason } from "../forms/sensitivity";
import { describeKinds, isDocumentKind, matchDocumentKind, PLANNABLE_KINDS, type DocumentKind } from "../documents/kinds";
import { isQuestion } from "./heuristics";
import { extractJson, MODEL_CONFIDENCE } from "./parse";
import type { MappingSource } from "./types";

/** A file input paired with the kind of document that should be attached to it. */
export interface UploadMapping {
  ref: string;
  kind: DocumentKind;
  source: MappingSource;
  confidence: number;
}

/**
 * Something that can map upload fields to document kinds, typically the same
 * local model behind the FieldMapper. It receives upload schemas only.
 */
export interface UploadMapper {
  readonly name: string;
  mapUploads(uploads: UploadField[], signal?: AbortSignal): Promise<UploadMapping[]>;
}

export interface UploadHeuristicResult {
  mapped: UploadMapping[];
  unmapped: UploadField[];
}

/**
 * An upload asking for an identity document, card, or bank paper is refused
 * on sight, like the matching fields. The section heading counts too: a
 * "Photo" under "Identity verification" is an ID, and signals only escalate.
 */
export function assessUpload(upload: UploadField): { blocked: boolean; reason?: BlockReason } {
  return assessDocumentText([
    upload.label,
    upload.name ? tokenize(upload.name) : undefined,
    upload.id ? tokenize(upload.id) : undefined,
    upload.sectionText,
  ]);
}

/**
 * The label first, then identifiers, then an image-only accept. A
 * question-shaped label is the model's outright: a keyword in a sentence,
 * or an identifier beside one, is noise, not intent, as for fields.
 */
export function mapUploadsByHeuristics(uploads: UploadField[]): UploadHeuristicResult {
  const mapped: UploadMapping[] = [];
  const unmapped: UploadField[] = [];
  for (const upload of uploads) {
    const guess = guessKind(upload);
    if (guess) {
      mapped.push({ ref: upload.ref, kind: guess.kind, source: "heuristic", confidence: guess.confidence });
    } else {
      unmapped.push(upload);
    }
  }
  return { mapped, unmapped };
}

function guessKind(upload: UploadField): { kind: DocumentKind; confidence: number } | undefined {
  if (isQuestion(upload.label)) {
    return undefined;
  }
  if (upload.label) {
    const kind = matchDocumentKind(upload.label);
    if (kind) {
      return { kind, confidence: 0.9 };
    }
  }
  const identifiers = [upload.name, upload.id].filter((part): part is string => Boolean(part)).map(tokenize).join(" ");
  const byIdentifier = identifiers ? matchDocumentKind(identifiers) : undefined;
  if (byIdentifier) {
    return { kind: byIdentifier, confidence: 0.8 };
  }
  if (upload.accept && upload.accept.split(",").every((token) => token.trim().toLowerCase().startsWith("image/"))) {
    return { kind: "photo", confidence: 0.7 };
  }
  return undefined;
}

export interface UploadResolveResult {
  mappings: UploadMapping[];
  /** Uploads nobody could map. */
  unmapped: UploadField[];
  /** Uploads refused on sight; never sent to the mapper. */
  blocked: UploadField[];
  usedModel: boolean;
}

/** Uploads worth asking about: editable and not blocked. */
export function eligibleUploads(uploads: UploadField[]): { eligible: UploadField[]; blocked: UploadField[] } {
  const eligible: UploadField[] = [];
  const blocked: UploadField[] = [];
  for (const upload of uploads) {
    if (assessUpload(upload).blocked) {
      blocked.push(upload);
    } else if (upload.editable) {
      eligible.push(upload);
    }
  }
  return { eligible, blocked };
}

export async function resolveUploads(uploads: UploadField[], mapper?: UploadMapper, signal?: AbortSignal): Promise<UploadResolveResult> {
  const { eligible, blocked } = eligibleUploads(uploads);
  const { mapped, unmapped } = mapUploadsByHeuristics(eligible);
  // An upload with no text at all gives the model nothing to reason from.
  const askable = unmapped.filter((upload) => upload.label || upload.name || upload.id || upload.sectionText);
  if (!mapper || askable.length === 0) {
    return { mappings: mapped, unmapped, blocked, usedModel: false };
  }
  const refs = new Set(askable.map((upload) => upload.ref));
  const fromModel = (await mapper.mapUploads(askable, signal)).filter((mapping) => refs.has(mapping.ref));
  const modelRefs = new Set(fromModel.map((mapping) => mapping.ref));
  return {
    mappings: [...mapped, ...fromModel],
    unmapped: unmapped.filter((upload) => !modelRefs.has(upload.ref)),
    blocked,
    usedModel: true,
  };
}

// ---- The model's part -----------------------------------------------------------------

export interface UploadPrompt {
  system: string;
  user: string;
  /** JSON schema for the response; engines pass it as constrained output. */
  schema: Record<string, unknown>;
  /** Prompt upload id -> upload ref, for reading the answer back. */
  ids: Map<string, string>;
}

interface PromptUpload {
  id: string;
  label?: string;
  name?: string;
  accept?: string;
  section?: string;
}

const MAX_TEXT = 80;

const SYSTEM_PROMPT = [
  "You match a web form's file-upload fields to kinds of document from a fixed list.",
  "You only see the fields' labels and names, never any document.",
  "For each upload choose the single kind whose meaning matches what the field asks for, or null when no kind fits.",
  "Never guess: an upload that asks for something outside the list maps to null.",
  "Answer with JSON only.",
].join(" ");

function clip(text: string | undefined): string | undefined {
  return text && text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}...` : text;
}

function promptUploadOf(upload: UploadField, id: string): PromptUpload {
  const out: PromptUpload = { id };
  const label = clip(upload.label);
  if (label) out.label = label;
  const name = clip(upload.name ?? upload.id);
  if (name) out.name = name;
  const accept = clip(upload.accept);
  if (accept) out.accept = accept;
  const section = clip(upload.sectionText);
  if (section) out.section = section;
  return out;
}

export function uploadResponseSchema(uploadIds: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      mappings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            upload: { type: "string", enum: uploadIds },
            kind: { anyOf: [{ type: "string", enum: [...PLANNABLE_KINDS] }, { type: "null" }] },
          },
          required: ["upload", "kind"],
          additionalProperties: false,
        },
      },
    },
    required: ["mappings"],
    additionalProperties: false,
  };
}

export function buildUploadPrompt(uploads: UploadField[]): UploadPrompt {
  const ids = new Map<string, string>();
  const promptUploads = uploads.map((upload, index) => {
    const id = `u${index + 1}`;
    ids.set(id, upload.ref);
    return promptUploadOf(upload, id);
  });
  const kinds = describeKinds()
    .map((k) => `- ${k.kind}: ${k.description}`)
    .join("\n");
  const user = [
    "Document kinds:",
    kinds,
    "",
    "Upload fields (one JSON object per line):",
    ...promptUploads.map((upload) => JSON.stringify(upload)),
    "",
    'Respond as {"mappings":[{"upload":"u1","kind":"resume"}, ...]} covering every upload.',
  ].join("\n");
  return { system: SYSTEM_PROMPT, user, schema: uploadResponseSchema([...ids.keys()]), ids };
}

/**
 * `ids` maps the prompt's upload ids (u1, u2, ...) to refs. Entries for
 * unknown ids, unknown or unplannable kinds, or null kinds are dropped; an
 * upload mapped twice keeps its first mapping.
 */
export function parseUploadResponse(text: string, ids: Map<string, string>): UploadMapping[] {
  const parsed = extractJson(text);
  const list = (parsed as { mappings?: unknown })?.mappings;
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set<string>();
  const out: UploadMapping[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const { upload, kind } = item as { upload?: unknown; kind?: unknown };
    const ref = typeof upload === "string" ? ids.get(upload) : undefined;
    if (!ref || seen.has(ref) || !isDocumentKind(kind) || !PLANNABLE_KINDS.includes(kind)) {
      continue;
    }
    seen.add(ref);
    out.push({ ref, kind, source: "model", confidence: MODEL_CONFIDENCE });
  }
  return out;
}
