// Deterministic field-to-key mapping. Runs before any model and covers the
// well-annotated majority: the HTML autocomplete vocabulary first, then a
// saved answer whose question is the field's whole label, then word
// patterns over the label, aria, placeholder, nearby prose, and identifier
// tokens, then a saved answer whose question the label contains. Whatever
// stays unmapped is the model's job.
//
// The heuristics never see profile values; they only decide which key a
// field asks for. Saved answers reach them as AnswerSpec: question and key,
// never the answer.

import type { CollectedField } from "../forms/collect";
import { tokenize } from "../forms/sensitivity";
import { foldQuestion, isAnswerKey, type AnswerSpec, type FillKey } from "../profile/answers";
import { PROFILE_KEYS, fieldSpec, type ProfileKey, type SectionId } from "../profile/keys";
import type { FieldMapping } from "./types";

export interface HeuristicResult {
  mapped: FieldMapping[];
  unmapped: CollectedField[];
}

/** Keys a textarea may hold: the long-form ones, plus the street address, which pages often take multi-line. */
const TEXTAREA_KEYS: ReadonlySet<ProfileKey> = new Set<ProfileKey>([
  ...PROFILE_KEYS.filter((key) => fieldSpec(key).kind === "multiline"),
  "address.line1",
]);

/**
 * Whether a key belongs in this kind of control. A textarea asks for prose;
 * a job title or a city dropped into one is always wrong, whoever proposed
 * it. A saved answer fits a textarea whatever its shape (the question
 * matched, and the page chose the control), but a multi-line answer never
 * fits a single-line input, which would swallow its line breaks. Applied
 * to heuristic and model mappings alike.
 */
export function keyFitsField(field: CollectedField, key: FillKey, answers: readonly AnswerSpec[] = []): boolean {
  if (isAnswerKey(key)) {
    if (field.tag === "textarea") {
      return true;
    }
    const spec = answers.find((answer) => answer.key === key);
    return spec !== undefined && !spec.multiline;
  }
  return field.tag !== "textarea" || TEXTAREA_KEYS.has(key);
}

/** The texts a field is named by, each a candidate for a whole-label match. */
function labelTexts(field: CollectedField): string[] {
  return [field.label, field.ariaLabel, field.placeholder, field.nearbyText].filter((text): text is string => Boolean(text));
}

const MIN_CONTAINMENT_WORDS = 4;

/** A saved answer whose question is one of the field's labels, folded. */
function matchAnswerExact(field: CollectedField, answers: readonly AnswerSpec[]): AnswerSpec | undefined {
  const labels = new Set(labelTexts(field).map(foldQuestion).filter(Boolean));
  if (labels.size === 0) {
    return undefined;
  }
  return answers.find((answer) => labels.has(foldQuestion(answer.question)));
}

/**
 * A saved answer whose question the field's label contains, or that
 * contains the label, when both are sentence-length: "Why do you want to
 * work here?" against "Why do you want to work here at Acme?". Short
 * strings are not compared this way; "Why" inside a question means nothing.
 */
function matchAnswerContaining(field: CollectedField, answers: readonly AnswerSpec[]): AnswerSpec | undefined {
  const label = labelTexts(field)[0];
  const folded = label ? foldQuestion(label) : "";
  if (folded.split(" ").length < MIN_CONTAINMENT_WORDS) {
    return undefined;
  }
  return answers.find((answer) => {
    const question = foldQuestion(answer.question);
    if (question.split(" ").length < MIN_CONTAINMENT_WORDS) {
      return false;
    }
    return ` ${folded} `.includes(` ${question} `) || ` ${question} `.includes(` ${folded} `);
  });
}

/**
 * Custom questions ("Are you willing to travel for this role?") read as
 * sentences, and a keyword inside a sentence is noise, not intent. Anything
 * shaped like one is left for the model, which reads the whole label.
 */
export function isQuestion(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  return text.includes("?") || text.trim().split(/\s+/).length > 8;
}

const AUTOCOMPLETE_KEYS: Record<string, ProfileKey> = {
  "given-name": "identity.firstName",
  "additional-name": "identity.middleName",
  "family-name": "identity.lastName",
  name: "identity.fullName",
  bday: "identity.dateOfBirth",
  email: "contact.email",
  tel: "contact.phone",
  "tel-national": "contact.phone",
  url: "contact.website",
  "street-address": "address.line1",
  "address-line1": "address.line1",
  "address-line2": "address.line2",
  "address-level2": "address.city",
  "address-level1": "address.region",
  "postal-code": "address.postalCode",
  country: "address.country",
  "country-name": "address.country",
  organization: "employment.employer",
  "organization-title": "employment.title",
};

/** Patterns over the label corpus, first match wins, so specific ones come first. */
const LABEL_PATTERNS: [RegExp, ProfileKey][] = [
  [/\b(first|given)[ -]?name\b|\bfirstname\b|\bfname\b|\bforename\b/, "identity.firstName"],
  [/\bmiddle[ -]?(name|initial)\b/, "identity.middleName"],
  [/\b(last|family)[ -]?name\b|\blastname\b|\blname\b|\bsurname\b/, "identity.lastName"],
  [/\b(full|legal|your)[ -]?name\b|^name$|\bname\b(?! of)/, "identity.fullName"],
  [/\b(date of birth|birth ?date|birthday|dob)\b/, "identity.dateOfBirth"],
  [/\be-?mail\b/, "contact.email"],
  [/\b(phone|mobile|telephone|cell)\b/, "contact.phone"],
  [/\blinked[ -]?in\b/, "contact.linkedin"],
  [/\bgit ?hub\b/, "contact.github"],
  [/\b(website|portfolio|personal site|homepage|web ?site|url)\b/, "contact.website"],
  [/\b(address|street)[ -]?(line)?[ -]?2\b|\b(apt|apartment|suite|unit)\b/, "address.line2"],
  [/\b(street|address)( line)?[ -]?1?\b|\bstreet address\b/, "address.line1"],
  [/\b(city|town|locality)\b/, "address.city"],
  [/\b(state|province|region|county)\b/, "address.region"],
  [/\b(zip|postal|postcode)\b/, "address.postalCode"],
  [/\bcountry\b/, "address.country"],
  [/\b(school|university|college|institution|alma mater)\b/, "education.institution"],
  [/\bdegree\b|\bqualification\b/, "education.degree"],
  [/\b(major|field of study|area of study|concentration|subject)\b/, "education.fieldOfStudy"],
  [/\bgpa\b|\bgrade point\b|\bfinal grade\b/, "education.gpa"],
  [/\b(graduation|graduated|completion)( date| year)?\b/, "education.endDate"],
  [/\b(employer|company|organization|organisation)\b/, "employment.employer"],
  [/\b(job title|position|title|role)\b/, "employment.title"],
  [/\b(responsibilities|duties|job description|description)\b/, "employment.description"],
];

/** Ambiguous dates: the section decides. */
const DATE_PATTERNS: [RegExp, "startDate" | "endDate"][] = [
  [/\b(start|from|began)\b/, "startDate"],
  [/\b(end|to|until|finish|left)\b/, "endDate"],
];

const SECTION_HINTS: [RegExp, SectionId][] = [
  [/\b(education|school|university|college|degree|academic|edu)\b/, "education"],
  [/\b(employment|employer|work|job|experience|company|position|career)\b/, "employment"],
  [/\b(address|shipping|billing|residence|home)\b/, "address"],
];

function corpusOf(field: CollectedField): string {
  return [field.label, field.ariaLabel, field.placeholder, field.nearbyText]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
}

function identifierCorpus(field: CollectedField): string {
  return [field.name, field.id]
    .filter((part): part is string => Boolean(part))
    .map(tokenize)
    .join(" ");
}

function sectionHint(field: CollectedField): SectionId | undefined {
  const text = [field.sectionText, identifierCorpus(field)].filter(Boolean).join(" ").toLowerCase();
  for (const [pattern, section] of SECTION_HINTS) {
    if (pattern.test(text)) {
      return section;
    }
  }
  return undefined;
}

function matchText(text: string, field: CollectedField): ProfileKey | undefined {
  if (!text) {
    return undefined;
  }
  for (const [pattern, key] of LABEL_PATTERNS) {
    if (pattern.test(text)) {
      return key;
    }
  }
  const dateLike = field.type === "date" || field.type === "month" || /\b(date|month|year)\b/.test(text);
  for (const [pattern, which] of DATE_PATTERNS) {
    if (dateLike && pattern.test(text)) {
      const section = sectionHint(field);
      if (section === "education" || section === "employment") {
        return `${section}.${which}`;
      }
    }
  }
  return undefined;
}

/** The first integer in a name or id ("education[1][school]", "job_2_title"). */
export function entryIndexOf(field: CollectedField): number | undefined {
  for (const source of [field.name, field.id]) {
    const match = source?.match(/(?:^|[^a-z0-9])(\d{1,2})(?:[^a-z0-9]|$)/i);
    if (match) {
      return Number(match[1]);
    }
  }
  return undefined;
}

function autocompleteToken(field: CollectedField): string | undefined {
  return field.autocomplete
    ?.split(/\s+/)
    .filter((t) => !/^(section-.*|shipping|billing|home|work|mobile|fax|pager|webauthn)$/.test(t))
    .pop();
}

function mapOne(field: CollectedField, answers: readonly AnswerSpec[]): { key: FillKey; confidence: number } | undefined {
  // An autocomplete token is the page author stating what the field wants;
  // it outranks everything, question-shaped label included.
  const token = autocompleteToken(field);
  const fromAutocomplete = token ? AUTOCOMPLETE_KEYS[token] : undefined;
  if (fromAutocomplete && keyFitsField(field, fromAutocomplete)) {
    return { key: fromAutocomplete, confidence: 0.95 };
  }
  // A saved answer to exactly this label outranks a keyword in it: the user
  // has answered this very question before.
  const exact = matchAnswerExact(field, answers);
  if (exact && keyFitsField(field, exact.key, answers)) {
    return { key: exact.key, confidence: 0.95 };
  }
  // A question-shaped label is left to the model, whatever the input type
  // says ("What is your manager's email?" is an email field, not yours);
  // only the control's own placeholder ("Email" under "Where can we reach
  // you?") and identifier hints still count.
  const question = isQuestion(field.label) || isQuestion(field.ariaLabel) || isQuestion(field.nearbyText);
  if (!question && field.type === "email") {
    return { key: "contact.email", confidence: 0.9 };
  }
  if (!question && field.type === "tel") {
    return { key: "contact.phone", confidence: 0.9 };
  }
  const fromLabel = question ? matchText(field.placeholder?.toLowerCase() ?? "", field) : matchText(corpusOf(field), field);
  if (fromLabel && keyFitsField(field, fromLabel)) {
    return { key: fromLabel, confidence: 0.8 };
  }
  const fromIdentifier = matchText(identifierCorpus(field), field);
  if (fromIdentifier && keyFitsField(field, fromIdentifier)) {
    return { key: fromIdentifier, confidence: 0.7 };
  }
  const containing = matchAnswerContaining(field, answers);
  if (containing && keyFitsField(field, containing.key, answers)) {
    return { key: containing.key, confidence: 0.7 };
  }
  return undefined;
}

/**
 * Entry indexes come from page markup, which may count from 0 or from 1.
 * Shift each repeating section so its lowest explicit index becomes entry
 * 0. Only mappings whose ref is in `indexed` carried an index; the rest
 * (a lone "Highest degree" select) stay at entry 0 and do not skew the shift.
 */
export function normalizeEntries(mappings: FieldMapping[], indexed: ReadonlySet<string>): FieldMapping[] {
  const minBySection = new Map<string, number>();
  for (const mapping of mappings) {
    if (!indexed.has(mapping.ref)) {
      continue;
    }
    const section = mapping.key.split(".")[0]!;
    const min = minBySection.get(section);
    if (min === undefined || mapping.entry < min) {
      minBySection.set(section, mapping.entry);
    }
  }
  return mappings.map((mapping) => {
    if (!indexed.has(mapping.ref)) {
      return mapping;
    }
    const section = mapping.key.split(".")[0]!;
    return { ...mapping, entry: mapping.entry - (minBySection.get(section) ?? 0) };
  });
}

export function mapByHeuristics(fields: CollectedField[], answers: readonly AnswerSpec[] = []): HeuristicResult {
  const mapped: FieldMapping[] = [];
  const unmapped: CollectedField[] = [];
  const indexed = new Set<string>();
  for (const field of fields) {
    const result = mapOne(field, answers);
    if (!result) {
      unmapped.push(field);
      continue;
    }
    // A saved answer has no entries; a number in the field's name is not one.
    const index = isAnswerKey(result.key) ? undefined : entryIndexOf(field);
    if (index !== undefined) {
      indexed.add(field.ref);
    }
    mapped.push({
      ref: field.ref,
      key: result.key,
      entry: index ?? 0,
      source: "heuristic",
      confidence: result.confidence,
    });
  }
  return { mapped: normalizeEntries(mapped, indexed), unmapped };
}
