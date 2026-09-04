// Mapping orchestration: heuristics first, the model only for what they
// leave, blocked fields never. The engine contract is the only thing the
// extension implements; core owns the policy of when it is consulted.

import type { CollectedField } from "../forms/collect";
import { assessField } from "../forms/sensitivity";
import type { AnswerSpec } from "../profile/answers";
import { keyFitsField, mapByHeuristics } from "./heuristics";
import type { FieldMapping } from "./types";

/** What a mapper is given beside the fields: the saved answers as keys and questions, and a way to cancel. */
export interface MapFieldsOptions {
  answers?: readonly AnswerSpec[];
  signal?: AbortSignal;
}

/**
 * Something that can map fields to profile keys, typically a local model
 * behind a localhost HTTP API. It receives field schemas and the saved
 * answers' questions only - never a profile value or an answer - and
 * returns mappings for whichever fields it recognized.
 */
export interface FieldMapper {
  readonly name: string;
  mapFields(fields: CollectedField[], options?: MapFieldsOptions): Promise<FieldMapping[]>;
}

export interface ResolveOptions {
  /** The saved answers, value-free; matched by the rules first, offered to the mapper after. */
  answers?: readonly AnswerSpec[];
  signal?: AbortSignal;
}

export interface ResolveResult {
  mappings: FieldMapping[];
  /** Fields nobody could map; the panel lists them so the user can assign a key by hand. */
  unmapped: CollectedField[];
  /** Fields refused on sight (passwords, cards, ids); never sent to the mapper. */
  blocked: CollectedField[];
  /** Whether the mapper was consulted, for the panel's status line. */
  usedModel: boolean;
}

/** Fields worth asking about: visible, editable, not blocked. */
export function eligibleFields(fields: CollectedField[]): { eligible: CollectedField[]; blocked: CollectedField[] } {
  const eligible: CollectedField[] = [];
  const blocked: CollectedField[] = [];
  for (const field of fields) {
    if (assessField(field).blocked) {
      blocked.push(field);
    } else if (field.visible && field.editable && field.type !== "hidden") {
      eligible.push(field);
    }
  }
  return { eligible, blocked };
}

export async function resolveMappings(fields: CollectedField[], mapper?: FieldMapper, options: ResolveOptions = {}): Promise<ResolveResult> {
  const answers = options.answers ?? [];
  const { eligible, blocked } = eligibleFields(fields);
  const { mapped, unmapped } = mapByHeuristics(eligible, answers);
  if (!mapper || unmapped.length === 0) {
    return { mappings: mapped, unmapped, blocked, usedModel: false };
  }
  const byRef = new Map(unmapped.map((field) => [field.ref, field]));
  const mapOptions: MapFieldsOptions = { answers };
  if (options.signal) {
    mapOptions.signal = options.signal;
  }
  // The model answers for the fields it was asked about, with keys that fit
  // the control; anything else is discarded, not trusted.
  const fromModel = (await mapper.mapFields(unmapped, mapOptions)).filter((mapping) => {
    const field = byRef.get(mapping.ref);
    return field !== undefined && keyFitsField(field, mapping.key, answers);
  });
  const modelRefs = new Set(fromModel.map((mapping) => mapping.ref));
  const stillUnmapped = unmapped.filter((field) => !modelRefs.has(field.ref));
  // The model is told to count entries from 0, so its answers need no shift.
  return {
    mappings: [...mapped, ...fromModel],
    unmapped: stillUnmapped,
    blocked,
    usedModel: true,
  };
}
