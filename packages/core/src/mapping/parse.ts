// Reads a model's mapping answer back into FieldMappings. Tolerates code
// fences and stray prose around the JSON, and drops anything that is not a
// known field id paired with a known key - the model can only ever pick from
// the vocabulary it was given.

import { isAnswerKey } from "../profile/answers";
import { PROFILE_KEYS, isProfileKey } from "../profile/keys";
import type { FieldMapping } from "./types";

const BUILT_IN_KEYS: ReadonlySet<string> = new Set(PROFILE_KEYS);

export const MODEL_CONFIDENCE = 0.6;

/** The first JSON object in a model answer, tolerating code fences and prose around it. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) {
      return undefined;
    }
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

/**
 * `ids` maps the prompt's field ids (f1, f2, ...) to field refs; `keys` is
 * the vocabulary the prompt offered (built-in keys alone by default).
 * Entries for unknown ids, keys outside that vocabulary, or null keys are
 * dropped; a field mapped twice keeps its first mapping.
 */
export function parseMappingResponse(text: string, ids: Map<string, string>, keys: ReadonlySet<string> = BUILT_IN_KEYS): FieldMapping[] {
  const parsed = extractJson(text);
  const list = (parsed as { mappings?: unknown })?.mappings;
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set<string>();
  const out: FieldMapping[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const { field, key, entry } = item as { field?: unknown; key?: unknown; entry?: unknown };
    const ref = typeof field === "string" ? ids.get(field) : undefined;
    if (!ref || seen.has(ref) || !(isProfileKey(key) || isAnswerKey(key)) || !keys.has(key)) {
      continue;
    }
    seen.add(ref);
    out.push({
      ref,
      key,
      entry: typeof entry === "number" && Number.isInteger(entry) && entry >= 0 ? entry : 0,
      source: "model",
      confidence: MODEL_CONFIDENCE,
    });
  }
  return out;
}
