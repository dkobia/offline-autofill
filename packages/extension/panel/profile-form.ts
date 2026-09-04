// Pure view-model for the profile editor: the Profile in, sections/entries/
// fields with stable paths out, and the edits (set, add, remove) as pure
// functions returning a new Profile. main.ts renders and wires; it never
// decides shape.

import {
  PROFILE_SECTIONS,
  emptyProfile,
  newAnswerId,
  type FieldKind,
  type FieldSpec,
  type Profile,
  type SavedAnswer,
  type SectionId,
  type SectionValues,
} from "@offline-autofill/core";

/** The built-in sections plus the saved answers, which the editor shows as one more repeating section. */
export type FormSectionId = SectionId | "answers";

export const ANSWERS_SECTION_LABEL = "Saved answers";
export const ANSWERS_HINT = "Kept from forms you filled. The local model sees the questions, never the answers.";

export interface FormField {
  /** "section.entry.field" - the input's data-path. */
  path: string;
  label: string;
  kind: FieldKind;
  value: string;
  /** Half-width fields share a row with their neighbour in the editor. */
  width: "full" | "half";
}

/** Short values (names, dates, city, postal code) that fit half a row. */
const HALF_WIDTH: ReadonlySet<string> = new Set([
  "identity.firstName",
  "identity.middleName",
  "identity.lastName",
  "identity.dateOfBirth",
  "address.city",
  "address.region",
  "address.postalCode",
  "address.country",
  "education.degree",
  "education.fieldOfStudy",
  "education.startDate",
  "education.endDate",
  "education.gpa",
  "employment.title",
  "employment.location",
  "employment.startDate",
  "employment.endDate",
]);

export interface FormEntry {
  index: number;
  /** "Address 2", or the section label for a lone entry. */
  title: string;
  fields: FormField[];
}

export interface FormSection {
  id: FormSectionId;
  label: string;
  repeating: boolean;
  entries: FormEntry[];
  /** "Add address"; absent for non-repeating sections. */
  addLabel?: string;
  /** A line under the heading explaining the section, where one is needed. */
  hint?: string;
}

export function fieldPath(section: FormSectionId, entry: number, field: string): string {
  return `${section}.${entry}.${field}`;
}

function isFormSectionId(value: string): value is FormSectionId {
  return value === "answers" || PROFILE_SECTIONS.some((s) => s.id === value);
}

export function parsePath(path: string): { section: FormSectionId; entry: number; field: string } | undefined {
  const [section, entry, field] = path.split(".");
  if (!section || !entry || !field || !isFormSectionId(section)) {
    return undefined;
  }
  const index = Number(entry);
  return Number.isInteger(index) && index >= 0 ? { section, entry: index, field } : undefined;
}

function entriesOf(profile: Profile, section: SectionId): SectionValues[] {
  const values = profile[section];
  return Array.isArray(values) ? values : [values];
}

/** The saved answers as an editor section: a question and an answer per entry, the answer multi-line when it was typed so. */
function answersSection(profile: Profile): FormSection {
  const stored: Partial<SavedAnswer>[] = profile.answers.length === 0 ? [{}] : profile.answers;
  return {
    id: "answers",
    label: ANSWERS_SECTION_LABEL,
    repeating: true,
    hint: ANSWERS_HINT,
    entries: stored.map((saved, index) => ({
      index,
      title: `Answer ${index + 1}`,
      fields: [
        { path: fieldPath("answers", index, "question"), label: "Question", kind: "text", value: saved.question ?? "", width: "full" },
        {
          path: fieldPath("answers", index, "answer"),
          label: "Answer",
          kind: saved.multiline ? "multiline" : "text",
          value: saved.answer ?? "",
          width: "full",
        },
      ],
    })),
    addLabel: "Add answer",
  };
}

/** A repeating section always shows at least one (possibly empty) entry to type into. */
export function formSections(profile: Profile): FormSection[] {
  return [...builtInSections(profile), answersSection(profile)];
}

function builtInSections(profile: Profile): FormSection[] {
  return PROFILE_SECTIONS.map((spec) => {
    const stored = entriesOf(profile, spec.id);
    const fields: readonly FieldSpec[] = spec.fields;
    const entries = spec.repeating && stored.length === 0 ? [{}] : stored;
    const section: FormSection = {
      id: spec.id,
      label: spec.label,
      repeating: spec.repeating,
      entries: entries.map((values, index) => ({
        index,
        title: spec.repeating ? `${spec.label} ${index + 1}` : spec.label,
        fields: fields
          .filter((field) => !field.derived)
          .map((field) => ({
            path: fieldPath(spec.id, index, field.id),
            label: field.label,
            kind: field.kind,
            value: values[field.id] ?? "",
            width: HALF_WIDTH.has(`${spec.id}.${field.id}`) ? "half" : "full",
          })),
      })),
    };
    if (spec.repeating) {
      section.addLabel = `Add ${spec.label.toLowerCase()}`;
    }
    return section;
  });
}

function clone(profile: Profile): Profile {
  return {
    ...emptyProfile(),
    identity: { ...profile.identity },
    contact: { ...profile.contact },
    address: profile.address.map((entry) => ({ ...entry })),
    education: profile.education.map((entry) => ({ ...entry })),
    employment: profile.employment.map((entry) => ({ ...entry })),
    answers: profile.answers.map((saved) => ({ ...saved })),
  };
}

/** A blank answer with an id no other answer in the list has. */
function blankAnswer(answers: readonly SavedAnswer[]): SavedAnswer {
  return { id: newAnswerId(new Set(answers.map((saved) => saved.id))), question: "", answer: "" };
}

/** Sets one value; creates the entry when the path points past the end. Unknown paths are ignored. */
export function setValue(profile: Profile, path: string, value: string): Profile {
  const parsed = parsePath(path);
  if (!parsed) {
    return profile;
  }
  const next = clone(profile);
  if (parsed.section === "answers") {
    if (parsed.field !== "question" && parsed.field !== "answer") {
      return profile;
    }
    while (next.answers.length <= parsed.entry) {
      next.answers.push(blankAnswer(next.answers));
    }
    next.answers[parsed.entry]![parsed.field] = value;
    return next;
  }
  const target = next[parsed.section];
  if (Array.isArray(target)) {
    while (target.length <= parsed.entry) {
      target.push({});
    }
    target[parsed.entry]![parsed.field] = value;
  } else {
    target[parsed.field] = value;
  }
  return next;
}

export function addEntry(profile: Profile, section: FormSectionId): Profile {
  const next = clone(profile);
  if (section === "answers") {
    // As below: the implicit blank entry becomes real, then one more is added.
    if (next.answers.length === 0) {
      next.answers.push(blankAnswer(next.answers));
    }
    next.answers.push(blankAnswer(next.answers));
    return next;
  }
  const target = next[section];
  if (Array.isArray(target)) {
    // The editor shows one implicit entry when the list is empty; adding
    // must yield two visible entries, not one.
    if (target.length === 0) {
      target.push({});
    }
    target.push({});
  }
  return next;
}

export function removeEntry(profile: Profile, section: FormSectionId, index: number): Profile {
  const next = clone(profile);
  const target = next[section];
  if (Array.isArray(target)) {
    target.splice(index, 1);
  }
  return next;
}
