import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, acceptsFile, base64ByteLength, decodeBase64, newestFirst, normalizeDocuments, type StoredDocument } from "./store";

const doc: StoredDocument = {
  id: "a1",
  kind: "resume",
  description: "",
  fileName: "cv.pdf",
  mimeType: "application/pdf",
  size: 1234,
  addedAt: "2026-09-03T10:00:00.000Z",
};

describe("normalizeDocuments", () => {
  it("returns an empty list for garbage and keeps valid entries", () => {
    expect(normalizeDocuments(undefined)).toEqual([]);
    expect(normalizeDocuments({ a: 1 })).toEqual([]);
    expect(normalizeDocuments([doc, null, 3])).toEqual([doc]);
  });

  it("repairs what it can and drops what it cannot", () => {
    const [fixed] = normalizeDocuments([
      { ...doc, kind: "passport", description: "  tailored   for EM roles ", mimeType: "Application/PDF", addedAt: "yesterday" },
    ]);
    expect(fixed).toMatchObject({ kind: "other", description: "tailored for EM roles", mimeType: "application/pdf", addedAt: "1970-01-01T00:00:00.000Z" });
    expect(normalizeDocuments([{ ...doc, id: "" }, { ...doc, fileName: "" }, { ...doc, size: 0 }, { ...doc, size: MAX_DOCUMENT_BYTES + 1 }])).toEqual([]);
  });

  it("drops duplicate ids, keeping the first", () => {
    expect(normalizeDocuments([doc, { ...doc, fileName: "other.pdf" }]).map((d) => d.fileName)).toEqual(["cv.pdf"]);
  });

  it("sorts newest first", () => {
    const older = { ...doc, id: "b", addedAt: "2026-01-01T00:00:00.000Z" };
    expect(newestFirst([older, doc]).map((d) => d.id)).toEqual(["a1", "b"]);
  });
});

describe("acceptsFile", () => {
  it.each([
    [undefined, "cv.pdf", "application/pdf", true],
    ["", "cv.pdf", "application/pdf", true],
    [".pdf,.doc,.docx", "cv.PDF", "application/pdf", true],
    [".pdf,.doc,.docx", "cv.txt", "text/plain", false],
    ["application/pdf", "cv.pdf", "application/pdf", true],
    ["application/pdf", "cv.pdf", "", false],
    ["image/*", "me.png", "image/png", true],
    ["image/*", "cv.pdf", "application/pdf", false],
    ["*/*", "anything.bin", "", true],
    ["pdf", "cv.pdf", "application/pdf", true],
  ])("accept=%s %s %s -> %s", (accept, name, type, expected) => {
    expect(acceptsFile(accept, name, type)).toBe(expected);
  });
});

describe("base64", () => {
  it("measures and decodes", () => {
    const data = btoa("hello!");
    expect(base64ByteLength(data)).toBe(6);
    expect(base64ByteLength(btoa("hi"))).toBe(2);
    expect(base64ByteLength(btoa("abc"))).toBe(3);
    expect(Array.from(decodeBase64(data))).toEqual([104, 101, 108, 108, 111, 33]);
  });
});
