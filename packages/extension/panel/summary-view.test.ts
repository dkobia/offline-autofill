import type { FormOutline } from "@offline-autofill/core";
import { describe, expect, it } from "vitest";
import { describesPlan, factsLine, rulesNotes, rulesPurpose, summaryView } from "./summary-view";

const outline: FormOutline = {
  fieldCount: 14,
  requiredCount: 8,
  sections: ["About you", "Education", "Work history", "Anything else"],
  questionCount: 2,
  blocked: ["password", "payment-card"],
  uploads: ["Resume/CV", "Cover letter"],
  submit: "Submit application",
};

const bare: FormOutline = { fieldCount: 1, requiredCount: 0, sections: [], questionCount: 0, blocked: [], uploads: [] };

describe("summaryView", () => {
  it("hides when idle or when the page could not be described", () => {
    expect(summaryView({ kind: "idle" }).hidden).toBe(true);
    expect(summaryView({ kind: "ready", response: { ok: false, error: "no-fields", message: "x" } }).hidden).toBe(true);
  });

  it("shows a working card with no copy", () => {
    expect(summaryView({ kind: "working" })).toMatchObject({ hidden: false, working: true, tag: "", purpose: "" });
  });

  it("shows the model's description over the rules' facts", () => {
    const view = summaryView({
      kind: "ready",
      response: {
        ok: true,
        tabId: 1,
        outline,
        usedModel: true,
        summary: { purpose: "An application.", howTo: ["Fill it in"], notes: ["Travel may be required"] },
      },
    });
    expect(view).toEqual({
      hidden: false,
      working: false,
      tag: "model",
      purpose: "An application.",
      howTo: ["Fill it in"],
      notes: ["Travel may be required"],
      note: "",
      facts: "14 fields · 8 required · 2 uploads · 2 questions · never fills a password, payment card details",
    });
  });

  it("falls back to the rules with a note when the model failed or answered nothing", () => {
    const failed = summaryView({
      kind: "ready",
      response: { ok: true, tabId: 1, outline, usedModel: false, modelError: { code: "engine-unreachable", message: "x" } },
    });
    expect(failed.tag).toBe("rules");
    expect(failed.note).toBe("The local model isn’t reachable, so this is what the built-in rules found.");
    expect(failed.purpose).toBe(
      "A form with 14 fillable fields across About you, Education, Work history, and Anything else, submitted with “Submit application”.",
    );

    const silent = summaryView({ kind: "ready", response: { ok: true, tabId: 1, outline, usedModel: true } });
    expect(silent.note).toBe("The model didn’t return a usable description.");

    const off = summaryView({ kind: "ready", response: { ok: true, tabId: 1, outline: bare, usedModel: false } });
    expect(off).toMatchObject({ tag: "rules", note: "", purpose: "A form with 1 fillable field.", notes: [], facts: "1 field" });
  });
});

describe("describesPlan", () => {
  it("accepts a description before any plan, or for the plan's own tab, and rejects another tab's", () => {
    expect(describesPlan(null, 7)).toBe(true);
    expect(describesPlan(7, 7)).toBe(true);
    expect(describesPlan(7, 8)).toBe(false);
  });
});

describe("rules copy", () => {
  it("lists sections and counts past four", () => {
    expect(rulesPurpose({ ...bare, fieldCount: 0 })).toBe("A form with no fillable fields.");
    expect(rulesPurpose({ ...bare, sections: ["A"] })).toBe("A form with 1 fillable field across A.");
    expect(rulesPurpose({ ...bare, sections: ["A", "B"] })).toBe("A form with 1 fillable field across A and B.");
    expect(rulesPurpose({ ...bare, sections: ["A", "B", "C", "D", "E", "F"] })).toBe("A form with 1 fillable field across A, B, C, and 3 more sections.");
    expect(rulesPurpose({ ...bare, submit: "Continue" })).toBe("A form with 1 fillable field, submitted with “Continue”.");
  });

  it("notes blocked kinds, uploads, and questions", () => {
    expect(rulesNotes(outline)).toEqual([
      "It also asks for a password and payment card details, which Offline Autofill never fills.",
      "It asks you to attach: Resume/CV, Cover letter.",
      "2 questions to answer yourself.",
    ]);
    expect(rulesNotes(bare)).toEqual([]);
  });

  it("builds the facts line from what is present", () => {
    expect(factsLine({ ...bare, requiredCount: 1, questionCount: 1 })).toBe("1 field · 1 required · 1 question");
  });
});
