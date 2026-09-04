// Reads a model's form description back into a FormSummary. Tolerates code
// fences and prose around the JSON, trims and clips every string, caps the
// lists, and gives up (undefined) when there is no usable purpose.

import { extractJson } from "../mapping/parse";
import type { FormSummary } from "./types";

export const MAX_PURPOSE_CHARS = 400;
export const MAX_ITEM_CHARS = 200;
export const MAX_HOW_TO = 4;
export const MAX_NOTES = 3;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") {
    return "";
  }
  // Models sometimes bullet or number list items themselves.
  const text = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:[-*•]|\d{1,2}[.)])\s+/, "");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function list(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    const text = clean(item, MAX_ITEM_CHARS);
    if (text && !out.includes(text)) {
      out.push(text);
    }
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

export function parseSummaryResponse(text: string): FormSummary | undefined {
  const parsed = extractJson(text);
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const { purpose, howTo, notes } = parsed as { purpose?: unknown; howTo?: unknown; notes?: unknown };
  const cleaned = clean(purpose, MAX_PURPOSE_CHARS);
  if (!cleaned) {
    return undefined;
  }
  return { purpose: cleaned, howTo: list(howTo, MAX_HOW_TO), notes: list(notes, MAX_NOTES) };
}
