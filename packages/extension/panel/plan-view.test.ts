import type { FillPlan } from "@offline-autofill/core";
import { describe, expect, it } from "vitest";
import { fillButtonText, fillSummary, modelErrorText, planRows, scanSummary, skipText } from "./plan-view";

const plan: FillPlan = {
  assignments: [
    { ref: "#a", key: "identity.firstName", entry: 0, value: "Ada", display: "Ada", source: "heuristic", confidence: 0.95, label: "First name" },
    { ref: "#b", key: "address.region", entry: 0, value: "CA", display: "California", source: "heuristic", confidence: 0.7 },
    { ref: "#c", key: "employment.description", entry: 0, value: "x", display: "x", source: "model", confidence: 0.6, label: "Duties" },
  ],
  attachments: [
    {
      ref: "#cv",
      kind: "resume",
      documentId: "new",
      fileName: "cv-2026.pdf",
      choices: [
        { documentId: "new", fileName: "cv-2026.pdf", description: "Tailored", kind: "resume" },
        { documentId: "old", fileName: "cv-2024.pdf", description: "", kind: "resume" },
      ],
      source: "heuristic",
      confidence: 0.9,
      label: "Resume/CV",
    },
  ],
  skipped: [],
};

describe("planRows", () => {
  it("shows labels, display values, and a tag for weak or model mappings, then the attachments with their choices", () => {
    expect(planRows(plan)).toEqual([
      { ref: "#a", label: "First name", value: "Ada", source: "heuristic", tag: "" },
      { ref: "#b", label: "address.region", value: "California", source: "heuristic", tag: "guess" },
      { ref: "#c", label: "Duties", value: "x", source: "model", tag: "model" },
      {
        ref: "#cv",
        label: "Resume/CV",
        value: "cv-2026.pdf",
        source: "heuristic",
        tag: "",
        file: {
          documentId: "new",
          choices: [
            { documentId: "new", label: "cv-2026.pdf · Tailored" },
            { documentId: "old", label: "cv-2024.pdf" },
          ],
        },
      },
    ]);
  });

  it("names skips for uploads", () => {
    expect(skipText("no-document")).toBe("no document of that kind");
    expect(skipText("not-accepted")).toBe("file type not accepted");
  });
});

describe("summaries", () => {
  it("counts fields, unrecognized, and blocked", () => {
    expect(
      scanSummary({ ok: true, tabId: 1, plan, fieldCount: 5, uploadCount: 2, unmapped: [{ ref: "#u", label: "Pronouns" }], blockedCount: 2, usedModel: true }),
    ).toBe("3 of 5 fields ready to fill · 1 of 2 files to attach · 1 not recognized · 2 never filled");
    expect(scanSummary({ ok: true, tabId: 1, plan, fieldCount: 1, uploadCount: 0, unmapped: [], blockedCount: 0, usedModel: false })).toBe(
      "3 of 1 field ready to fill",
    );
  });

  it("describes fill outcomes, counting files apart from fields", () => {
    const files = new Set(["f"]);
    expect(fillSummary({ filled: ["a"], failed: [] })).toBe("Filled 1 field.");
    expect(fillSummary({ filled: ["a", "b", "f"], failed: [] }, files)).toBe("Filled 2 fields and attached 1 file.");
    expect(fillSummary({ filled: ["f"], failed: [] }, files)).toBe("Attached 1 file.");
    expect(fillSummary({ filled: [], failed: [{ ref: "a", reason: "unresolvable" }] })).toBe("Couldn’t fill 1 field. The page may have changed; scan again.");
    expect(fillSummary({ filled: [], failed: [{ ref: "f", reason: "unsupported" }] }, files)).toBe("Couldn’t attach 1 file. The page may have changed; scan again.");
    expect(fillSummary({ filled: [], failed: [{ ref: "a", reason: "unresolvable" }, { ref: "f", reason: "unsupported" }] }, files)).toContain(
      "Couldn’t fill 1 field or attach 1 file.",
    );
    expect(fillSummary({ filled: ["a", "b"], failed: [{ ref: "c", reason: "readback-mismatch" }] })).toBe("Filled 2 fields, 1 couldn’t be written.");
    expect(fillSummary({ filled: ["a", "f"], failed: [{ ref: "c", reason: "readback-mismatch" }] }, files)).toBe(
      "Filled 1 field and attached 1 file, 1 couldn’t be written.",
    );
    expect(fillButtonText(0)).toBe("Nothing selected");
    expect(fillButtonText(3)).toBe("Fill 3 fields");
    expect(fillButtonText(0, 1)).toBe("Attach 1 file");
    expect(fillButtonText(2, 1)).toBe("Fill 2 fields, attach 1 file");
  });

  it("has copy for every skip reason and model error", () => {
    for (const reason of ["no-value", "already-filled", "no-option-match", "unsupported-type", "unknown-field"] as const) {
      expect(skipText(reason)).not.toBe("");
    }
    expect(modelErrorText({ code: "origin-forbidden", message: "" })).toContain("blocks this extension");
    expect(modelErrorText({ code: "engine-error", message: "oom" })).toContain("oom");
  });
});
