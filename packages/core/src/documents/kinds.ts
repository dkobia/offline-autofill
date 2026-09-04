// The document vocabulary: the kinds of file a form asks for, as the enum the
// rules and the model map upload fields onto. Kinds are to documents what
// keys are to the profile, and they are all a model ever sees of one: never
// the file, its name, or what the user wrote about it.

import { tokenize } from "../forms/sensitivity";

export type DocumentKind =
  | "resume"
  | "coverLetter"
  | "transcript"
  | "portfolio"
  | "writingSample"
  | "certificate"
  | "referenceLetter"
  | "photo"
  | "other";

/** "document.resume", ... the form a kind takes where it sits beside profile keys (the plan's skipped list). */
export type DocumentKey = `document.${DocumentKind}`;

export interface DocumentKindSpec {
  readonly id: DocumentKind;
  /** Label shown in the documents view and the review list. */
  readonly label: string;
  /** Plain-words meaning handed to the model alongside the kind. */
  readonly description: string;
  /** Matched against lower-cased upload labels and tokenized file names; absent for the user-only kind. */
  readonly pattern?: RegExp;
}

/**
 * Identity documents (passport, licence, ID card) are deliberately absent, as
 * government identifiers are absent from the profile; an upload asking for
 * one is blocked by the sensitivity rules before any kind is considered.
 * Order matters: the first pattern to match wins.
 */
export const DOCUMENT_KINDS = [
  {
    id: "resume",
    label: "Resume / CV",
    description: "Resume or curriculum vitae",
    pattern: /\b(resume|cv|curriculum vitae)\b/,
  },
  {
    id: "coverLetter",
    label: "Cover letter",
    description: "Cover letter or letter of motivation",
    pattern: /\b(cover|covering|motivation) ?letter\b|\bletter of (motivation|interest|application)\b/,
  },
  {
    id: "transcript",
    label: "Transcript",
    description: "Academic transcript or record of grades",
    pattern: /\btranscripts?\b|\bacademic records?\b|\bgrade reports?\b/,
  },
  {
    id: "portfolio",
    label: "Portfolio",
    description: "Portfolio or work samples",
    pattern: /\bportfolio\b|\bwork samples?\b/,
  },
  {
    id: "writingSample",
    label: "Writing sample",
    description: "Writing sample",
    pattern: /\bwriting samples?\b/,
  },
  {
    id: "certificate",
    label: "Certificate",
    description: "Certificate, certification, diploma, or professional licence",
    pattern: /\b(certificates?|certifications?|diplomas?|licen[cs]es?)\b/,
  },
  {
    id: "referenceLetter",
    label: "Reference letter",
    description: "Reference or recommendation letter",
    pattern: /\b(reference|recommendation) letters?\b|\bletters? of (reference|recommendation)\b/,
  },
  {
    id: "photo",
    label: "Photo",
    description: "Photo, headshot, or profile picture",
    pattern: /\b(photos?|photographs?|headshots?|pictures?|profile (image|picture)|avatar)\b/,
  },
  { id: "other", label: "Other", description: "Anything else" },
] as const satisfies readonly DocumentKindSpec[];

const KIND_SPECS: readonly DocumentKindSpec[] = DOCUMENT_KINDS;
const KIND_SET: ReadonlySet<string> = new Set(KIND_SPECS.map((kind) => kind.id));

/** The kinds a form can ask for, and so the only ones the rules or the model may map to. */
export const PLANNABLE_KINDS: readonly DocumentKind[] = KIND_SPECS.filter((kind) => kind.pattern !== undefined).map((kind) => kind.id);

export function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === "string" && KIND_SET.has(value);
}

export function documentKindSpec(id: DocumentKind): DocumentKindSpec {
  const spec = KIND_SPECS.find((kind) => kind.id === id);
  if (!spec) {
    throw new Error(`unknown document kind: ${id}`);
  }
  return spec;
}

export function documentKey(kind: DocumentKind): DocumentKey {
  return `document.${kind}`;
}

/** The first plannable kind whose pattern matches the text (case and accents folded: "Résumé" is a resume), else nothing. */
export function matchDocumentKind(text: string): DocumentKind | undefined {
  const corpus = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return KIND_SPECS.find((kind) => kind.pattern?.test(corpus))?.id;
}

/**
 * A kind for a file the user just picked, from its name ("Ada_CV_2026.pdf")
 * and, for images, its type. The user can always change it.
 */
export function guessDocumentKind(fileName: string, mimeType: string): DocumentKind {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const byName = matchDocumentKind(tokenize(stem));
  if (byName) {
    return byName;
  }
  if (mimeType.toLowerCase().startsWith("image/")) {
    return "photo";
  }
  return "other";
}

/** The kinds with their descriptions, in the form the upload prompt lists them. */
export function describeKinds(): { kind: DocumentKind; description: string }[] {
  return PLANNABLE_KINDS.map((kind) => ({ kind, description: documentKindSpec(kind).description }));
}
