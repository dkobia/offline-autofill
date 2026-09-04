// The profile vocabulary: every value the extension can fill, as dotted keys
// grouped into sections. This list is the enum the model maps form fields
// onto, so it stays small, unambiguous, and described in plain words. Profile
// VALUES never appear here or in any prompt - only these keys do.

export type SectionId = "identity" | "contact" | "address" | "education" | "employment";

export type FieldKind = "text" | "email" | "tel" | "url" | "date" | "month" | "multiline";

export interface FieldSpec {
  readonly id: string;
  /** Label shown in the profile editor. */
  readonly label: string;
  /** Plain-words meaning handed to the model alongside the key. */
  readonly description: string;
  readonly kind: FieldKind;
  /** Computed from other fields (never stored, hidden in the editor). */
  readonly derived?: true;
}

export interface SectionSpec {
  readonly id: SectionId;
  readonly label: string;
  /** Repeating sections hold a list of entries (several addresses, degrees, jobs). */
  readonly repeating: boolean;
  readonly fields: readonly FieldSpec[];
}

export const PROFILE_SECTIONS = [
  {
    id: "identity",
    label: "Identity",
    repeating: false,
    fields: [
      { id: "firstName", label: "First name", description: "Given name", kind: "text" },
      { id: "middleName", label: "Middle name", description: "Middle name or initial", kind: "text" },
      { id: "lastName", label: "Last name", description: "Family name or surname", kind: "text" },
      {
        id: "fullName",
        label: "Full name",
        description: "Full name, first and last together in one field",
        kind: "text",
        derived: true,
      },
      { id: "dateOfBirth", label: "Date of birth", description: "Date of birth", kind: "date" },
    ],
  },
  {
    id: "contact",
    label: "Contact",
    repeating: false,
    fields: [
      { id: "email", label: "Email", description: "Email address", kind: "email" },
      { id: "phone", label: "Phone", description: "Phone or mobile number", kind: "tel" },
      { id: "website", label: "Website", description: "Personal website or portfolio URL", kind: "url" },
      { id: "linkedin", label: "LinkedIn", description: "LinkedIn profile URL", kind: "url" },
      { id: "github", label: "GitHub", description: "GitHub profile URL", kind: "url" },
    ],
  },
  {
    id: "address",
    label: "Address",
    repeating: true,
    fields: [
      { id: "line1", label: "Street address", description: "Street address, first line", kind: "text" },
      { id: "line2", label: "Address line 2", description: "Apartment, suite, unit, or second address line", kind: "text" },
      { id: "city", label: "City", description: "City or town", kind: "text" },
      { id: "region", label: "State / region", description: "State, province, or region", kind: "text" },
      { id: "postalCode", label: "Postal code", description: "Postal or ZIP code", kind: "text" },
      { id: "country", label: "Country", description: "Country", kind: "text" },
    ],
  },
  {
    id: "education",
    label: "Education",
    repeating: true,
    fields: [
      { id: "institution", label: "School", description: "School, college, or university name", kind: "text" },
      { id: "degree", label: "Degree", description: "Degree or qualification earned", kind: "text" },
      { id: "fieldOfStudy", label: "Field of study", description: "Major or field of study", kind: "text" },
      { id: "startDate", label: "Start date", description: "When the studies started", kind: "month" },
      { id: "endDate", label: "End date", description: "When the studies ended or graduation date", kind: "month" },
      { id: "gpa", label: "GPA", description: "Grade point average or final grade", kind: "text" },
    ],
  },
  {
    id: "employment",
    label: "Employment",
    repeating: true,
    fields: [
      { id: "employer", label: "Employer", description: "Company or organization name", kind: "text" },
      { id: "title", label: "Job title", description: "Job title or position", kind: "text" },
      { id: "location", label: "Location", description: "Where the job was located", kind: "text" },
      { id: "startDate", label: "Start date", description: "When the job started", kind: "month" },
      { id: "endDate", label: "End date", description: "When the job ended; empty if current", kind: "month" },
      { id: "description", label: "Description", description: "Responsibilities and achievements", kind: "multiline" },
    ],
  },
] as const satisfies readonly SectionSpec[];

type Sections = typeof PROFILE_SECTIONS;

/** "identity.firstName", "education.institution", ... derived from PROFILE_SECTIONS. */
export type ProfileKey = {
  [S in Sections[number] as S["id"]]: `${S["id"]}.${S["fields"][number]["id"]}`;
}[SectionId];

export const PROFILE_KEYS: readonly ProfileKey[] = PROFILE_SECTIONS.flatMap((section) =>
  section.fields.map((field) => `${section.id}.${field.id}` as ProfileKey),
);

const KEY_SET: ReadonlySet<string> = new Set(PROFILE_KEYS);

export function isProfileKey(value: unknown): value is ProfileKey {
  return typeof value === "string" && KEY_SET.has(value);
}

export function splitKey(key: ProfileKey): { section: SectionId; field: string } {
  const [section, field] = key.split(".") as [SectionId, string];
  return { section, field };
}

export function sectionSpec(id: SectionId): SectionSpec {
  const spec = PROFILE_SECTIONS.find((section) => section.id === id);
  if (!spec) {
    throw new Error(`unknown profile section: ${id}`);
  }
  return spec;
}

export function fieldSpec(key: ProfileKey): FieldSpec {
  const { section, field } = splitKey(key);
  const spec = sectionSpec(section).fields.find((f) => f.id === field);
  if (!spec) {
    throw new Error(`unknown profile key: ${key}`);
  }
  return spec;
}

/** The keys with their descriptions, in the form the mapping prompt lists them. */
export function describeKeys(): { key: ProfileKey; description: string; repeating: boolean }[] {
  return PROFILE_SECTIONS.flatMap((section) =>
    section.fields.map((field) => ({
      key: `${section.id}.${field.id}` as ProfileKey,
      description: field.description,
      repeating: section.repeating,
    })),
  );
}
