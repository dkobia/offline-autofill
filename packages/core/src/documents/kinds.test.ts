import { describe, expect, it } from "vitest";
import { DOCUMENT_KINDS, PLANNABLE_KINDS, describeKinds, documentKey, guessDocumentKind, isDocumentKind, matchDocumentKind } from "./kinds";

describe("document kinds", () => {
  it("keeps 'other' out of what the rules and the model may map to", () => {
    expect(PLANNABLE_KINDS).not.toContain("other");
    expect(PLANNABLE_KINDS).toHaveLength(DOCUMENT_KINDS.length - 1);
    expect(describeKinds().map((k) => k.kind)).toEqual(PLANNABLE_KINDS);
    expect(isDocumentKind("resume")).toBe(true);
    expect(isDocumentKind("passport")).toBe(false);
    expect(documentKey("coverLetter")).toBe("document.coverLetter");
  });

  it.each([
    ["Resume/CV", "resume"],
    ["Upload your CV", "resume"],
    ["Curriculum Vitae", "resume"],
    ["Résumé", "resume"],
    ["Cover Letter", "coverLetter"],
    ["Letter of motivation", "coverLetter"],
    ["Unofficial transcript", "transcript"],
    ["Portfolio (PDF)", "portfolio"],
    ["Writing sample", "writingSample"],
    ["Professional certifications", "certificate"],
    ["Letters of recommendation", "referenceLetter"],
    ["Profile picture", "photo"],
    ["Headshot", "photo"],
    ["Supporting documents", undefined],
    ["Passport", undefined],
  ])("matches %s -> %s", (label, kind) => {
    expect(matchDocumentKind(label)).toBe(kind);
  });

  it("guesses a kind from a file name, then from an image type, else other", () => {
    expect(guessDocumentKind("Ada_Lovelace_CV_2026.pdf", "application/pdf")).toBe("resume");
    expect(guessDocumentKind("ada-lovelace-resume.docx", "")).toBe("resume");
    expect(guessDocumentKind("coverletter.pdf", "application/pdf")).toBe("coverLetter");
    expect(guessDocumentKind("IMG_2034.jpg", "image/jpeg")).toBe("photo");
    expect(guessDocumentKind("scan.pdf", "application/pdf")).toBe("other");
  });
});
