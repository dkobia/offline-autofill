import type { StoredDocument } from "@offline-autofill/core";
import { describe, expect, it } from "vitest";
import { KIND_OPTIONS, documentCards, fileError, fileTypeLabel, formatDate, formatSize } from "./documents-view";

const docs: StoredDocument[] = [
  { id: "a", kind: "resume", description: "Tailored", fileName: "cv.pdf", mimeType: "application/pdf", size: 188_416, addedAt: "2026-09-03T10:00:00.000Z" },
  { id: "b", kind: "photo", description: "", fileName: "me", mimeType: "image/png", size: 2_400_000, addedAt: "2026-09-04T10:00:00.000Z" },
];

describe("documentCards", () => {
  it("lists newest first with a facts strip", () => {
    expect(documentCards(docs)).toEqual([
      { id: "b", kind: "photo", kindLabel: "Photo", fileName: "me", description: "", facts: "2.3 MB · PNG · added 4 Sep 2026" },
      { id: "a", kind: "resume", kindLabel: "Resume / CV", fileName: "cv.pdf", description: "Tailored", facts: "184 KB · PDF · added 3 Sep 2026" },
    ]);
  });

  it("offers every kind, 'other' included", () => {
    expect(KIND_OPTIONS.map((o) => o.value)).toContain("other");
    expect(KIND_OPTIONS[0]).toEqual({ value: "resume", label: "Resume / CV" });
  });
});

describe("formatting", () => {
  it("sizes", () => {
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(1536)).toBe("2 KB");
    expect(formatSize(12 * 1024 * 1024)).toBe("12 MB");
  });

  it("types and dates", () => {
    expect(fileTypeLabel("Resume.DOCX", "")).toBe("DOCX");
    expect(fileTypeLabel("noext", "application/pdf")).toBe("PDF");
    expect(fileTypeLabel("noext", "")).toBe("");
    expect(formatDate("not a date")).toBe("");
  });

  it("refuses empty and oversized files before they are sent anywhere", () => {
    expect(fileError(0)).toBe("That file is empty.");
    expect(fileError(11 * 1024 * 1024)).toContain("10 MB");
    expect(fileError(100)).toBeUndefined();
  });
});
