// The stored profile and the operations on it: an empty one, coercing whatever
// came out of storage into a valid one, and resolving a key to a value.
// Storage and encryption are the extension's concern; core only knows the shape.

import { answerIdOf, isAnswerKey, normalizeAnswers, type FillKey, type SavedAnswer } from "./answers";
import { PROFILE_SECTIONS, sectionSpec, splitKey, type SectionId } from "./keys";

/** One section's values keyed by field id; unknown ids never survive normalization. */
export type SectionValues = Record<string, string>;

export interface Profile {
  version: 1;
  identity: SectionValues;
  contact: SectionValues;
  address: SectionValues[];
  education: SectionValues[];
  employment: SectionValues[];
  /** Answers the user saved from forms' own questions; see answers.ts. */
  answers: SavedAnswer[];
}

export const PROFILE_VERSION = 1;

export function emptyProfile(): Profile {
  return { version: PROFILE_VERSION, identity: {}, contact: {}, address: [], education: [], employment: [], answers: [] };
}

function normalizeSection(section: SectionId, raw: unknown): SectionValues {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: SectionValues = {};
  for (const field of sectionSpec(section).fields) {
    if (field.derived) {
      continue;
    }
    const value = input[field.id];
    if (typeof value === "string" && value.trim() !== "") {
      out[field.id] = value.trim();
    }
  }
  return out;
}

function hasValues(values: SectionValues): boolean {
  return Object.keys(values).length > 0;
}

/**
 * Coerces whatever came out of storage (possibly from an older version, or
 * hand-edited) into a valid Profile. Unknown fields are dropped, blank
 * values are removed, and empty repeating entries are pruned.
 */
export function normalizeProfile(raw: unknown): Profile {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const profile = emptyProfile();
  for (const section of PROFILE_SECTIONS) {
    if (section.repeating) {
      const list = Array.isArray(input[section.id]) ? (input[section.id] as unknown[]) : [];
      profile[section.id] = list.map((entry) => normalizeSection(section.id, entry)).filter(hasValues);
    } else {
      profile[section.id] = normalizeSection(section.id, input[section.id]);
    }
  }
  profile.answers = normalizeAnswers(input.answers);
  return profile;
}

/** True when nothing at all has been entered yet. */
export function isProfileEmpty(profile: Profile): boolean {
  return (
    profile.answers.length === 0 &&
    PROFILE_SECTIONS.every((section) => (section.repeating ? profile[section.id].length === 0 : !hasValues(profile[section.id])))
  );
}

/** The saved answer a key names, or undefined when there is none. */
export function answerOf(profile: Profile, key: FillKey): SavedAnswer | undefined {
  if (!isAnswerKey(key)) {
    return undefined;
  }
  const id = answerIdOf(key);
  return profile.answers.find((saved) => saved.id === id);
}

function joinName(values: SectionValues): string | undefined {
  const parts = [values.firstName, values.middleName, values.lastName].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * The value stored for a key, or undefined when the profile has none.
 * `entry` selects which entry of a repeating section (0 is the first);
 * non-repeating sections and saved answers ignore it. Derived keys are
 * computed here.
 */
export function resolveValue(profile: Profile, key: FillKey, entry = 0): string | undefined {
  if (isAnswerKey(key)) {
    return answerOf(profile, key)?.answer;
  }
  const { section, field } = splitKey(key);
  const spec = sectionSpec(section);
  const values = spec.repeating ? (profile[section] as SectionValues[])[entry] : (profile[section] as SectionValues);
  if (!values) {
    return undefined;
  }
  if (key === "identity.fullName") {
    return joinName(values);
  }
  const value = values[field];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function sectionValues(profile: Profile, section: SectionId): SectionValues | SectionValues[] {
  return profile[section];
}

/** Number of entries a repeating section has (1 or 0 for non-repeating ones). */
export function entryCount(profile: Profile, section: SectionId): number {
  const values = sectionValues(profile, section);
  return Array.isArray(values) ? values.length : hasValues(values) ? 1 : 0;
}
