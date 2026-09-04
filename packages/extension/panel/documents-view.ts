// Pure view-model for the documents view: the stored documents in, cards
// with formatted facts and the kind options out, plus the copy for adding
// and removing. No DOM, so the formatting and every message is unit tested.
// main.ts renders and wires.

import { DOCUMENT_KINDS, MAX_DOCUMENT_BYTES, documentKindSpec, newestFirst, type DocumentKind, type StoredDocument } from "@offline-autofill/core";

export interface KindOption {
  value: DocumentKind;
  label: string;
}

export interface DocumentCard {
  id: string;
  kind: DocumentKind;
  kindLabel: string;
  fileName: string;
  description: string;
  /** "184 KB · PDF · added 3 Sep 2026" */
  facts: string;
}

export const KIND_OPTIONS: KindOption[] = DOCUMENT_KINDS.map((kind) => ({ value: kind.id, label: kind.label }));

export const DOCUMENTS_INTRO = "Stored only in this browser. Attached to a form’s upload fields only after you review the scan.";
export const DOCUMENTS_EMPTY = "No documents yet. Add a resume or cover letter and it will be offered whenever a form asks for one.";
export const DESCRIPTION_PLACEHOLDER = "Optional: what this one is for";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Newest first, matching the order the plan prefers them in. */
export function documentCards(documents: StoredDocument[]): DocumentCard[] {
  return newestFirst(documents).map((document) => ({
    id: document.id,
    kind: document.kind,
    kindLabel: documentKindSpec(document.kind).label,
    fileName: document.fileName,
    description: document.description,
    facts: [formatSize(document.size), fileTypeLabel(document.fileName, document.mimeType), `added ${formatDate(document.addedAt)}`]
      .filter(Boolean)
      .join(" · "),
  }));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** The extension in capitals ("PDF"), else the MIME subtype, else nothing. */
export function fileTypeLabel(fileName: string, mimeType: string): string {
  const extension = fileName.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  if (extension) {
    return extension.toUpperCase();
  }
  const subtype = mimeType.split("/")[1];
  return subtype ? subtype.toUpperCase() : "";
}

/** "3 Sep 2026", in English whatever the locale, so the strip is one predictable line. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Why a picked file cannot be stored, or nothing when it can. */
export function fileError(size: number): string | undefined {
  if (size <= 0) {
    return "That file is empty.";
  }
  if (size > MAX_DOCUMENT_BYTES) {
    return `That file is too big. Files up to ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB can be stored.`;
  }
  return undefined;
}

export function addedText(fileName: string): string {
  return `Added ${fileName}.`;
}

export function removedText(fileName: string): string {
  return `Removed ${fileName}.`;
}
