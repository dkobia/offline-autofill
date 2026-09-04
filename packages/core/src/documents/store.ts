// What the extension keeps about a stored document, and the operations on
// the list: coercing whatever came out of storage into valid entries, and
// deciding whether a file input's `accept` admits one. The bytes are not
// part of the shape; core never handles them except to hand a file to an
// input at fill time, and the extension owns where they live.

import { isDocumentKind, type DocumentKind } from "./kinds";

export interface StoredDocument {
  id: string;
  kind: DocumentKind;
  /** The user's own words, optional; the file name stands when empty. */
  description: string;
  fileName: string;
  mimeType: string;
  /** Bytes. */
  size: number;
  /** ISO timestamp of when it was added. */
  addedAt: string;
}

/** Application systems cap resumes at 2 to 5 MB; anything bigger would be refused by the site anyway. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DESCRIPTION_CHARS = 200;
export const MAX_FILE_NAME_CHARS = 255;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function normalizeDocument(raw: unknown): StoredDocument | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const input = raw as Record<string, unknown>;
  const id = text(input.id, 64);
  const fileName = text(input.fileName, MAX_FILE_NAME_CHARS);
  const size = typeof input.size === "number" && Number.isInteger(input.size) && input.size > 0 ? input.size : 0;
  if (!id || !fileName || size === 0 || size > MAX_DOCUMENT_BYTES) {
    return undefined;
  }
  const addedAt = text(input.addedAt, 40);
  return {
    id,
    kind: isDocumentKind(input.kind) ? input.kind : "other",
    description: text(input.description, MAX_DESCRIPTION_CHARS),
    fileName,
    mimeType: text(input.mimeType, 120).toLowerCase(),
    size,
    addedAt: Number.isNaN(Date.parse(addedAt)) ? new Date(0).toISOString() : addedAt,
  };
}

/**
 * Coerces whatever came out of storage (possibly from an older version, or
 * hand-edited) into a valid list. Broken entries and duplicate ids are
 * dropped rather than failing.
 */
export function normalizeDocuments(raw: unknown): StoredDocument[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: StoredDocument[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const document = normalizeDocument(entry);
    if (document && !seen.has(document.id)) {
      seen.add(document.id);
      out.push(document);
    }
  }
  return out;
}

/** Newest first, so the most recently added document of a kind is the default. */
export function newestFirst(documents: StoredDocument[]): StoredDocument[] {
  return [...documents].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

function extensionOf(fileName: string): string {
  const match = fileName.match(/\.([^.]+)$/);
  return match ? `.${match[1]!.toLowerCase()}` : "";
}

/**
 * Whether an input's `accept` attribute admits a file, judged the way the
 * file picker does: extension tokens against the name, MIME tokens (exact
 * or `type/*`) against the type. No attribute, or none with a usable
 * token, admits everything.
 */
export function acceptsFile(accept: string | undefined, fileName: string, mimeType: string): boolean {
  const tokens = (accept ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.startsWith(".") || token.includes("/"));
  if (tokens.length === 0 || tokens.includes("*/*")) {
    return true;
  }
  const extension = extensionOf(fileName);
  const type = mimeType.toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith(".")) {
      return extension === token;
    }
    if (token.endsWith("/*")) {
      return type !== "" && type.startsWith(token.slice(0, -1));
    }
    return type !== "" && type === token;
  });
}

// ---- Bytes across the message boundary -----------------------------------------------
//
// Extension messages are JSON, so file bytes travel as base64: from the panel
// to the background when a document is added, and from the background to the
// tab when one is attached.

/** The byte length a base64 string decodes to, without decoding it. */
export function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
