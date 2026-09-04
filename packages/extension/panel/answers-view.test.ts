import type { AnswerCandidate } from "@offline-autofill/core";
import { describe, expect, it } from "vitest";
import { answerRows, captureSummary, plannedValues, readAnswersErrorText, saveAnswersButtonText, savedText, targetTag } from "./answers-view";

function candidate(partial: Partial<AnswerCandidate>): AnswerCandidate {
  return { ref: "#x", label: "Q", question: "Q", value: "A", multiline: false, target: { kind: "answer" }, ...partial };
}

describe("targetTag", () => {
  it("names where an answer goes", () => {
    expect(targetTag({ kind: "answer" })).toBe("Answers");
    expect(targetTag({ kind: "update", id: "a1" })).toBe("Update");
    expect(targetTag({ kind: "key", key: "contact.linkedin", entry: 0 })).toBe("Contact · LinkedIn");
    expect(targetTag({ kind: "key", key: "education.institution", entry: 1 })).toBe("Education 2 · School");
  });
});

describe("answerRows", () => {
  it("keeps the page's label and value and adds the tag", () => {
    const rows = answerRows([
      candidate({ ref: "#salary", label: "Desired salary *", value: "£90,000" }),
      candidate({ ref: "#why", label: "Why?", value: "Because.", multiline: true, target: { kind: "update", id: "a1" } }),
    ]);
    expect(rows).toEqual([
      { ref: "#salary", label: "Desired salary *", value: "£90,000", tag: "Answers", multiline: false },
      { ref: "#why", label: "Why?", value: "Because.", tag: "Update", multiline: true },
    ]);
  });
});

describe("copy", () => {
  const mixed = [
    candidate({ ref: "#a" }),
    candidate({ ref: "#b", target: { kind: "update", id: "a1" } }),
    candidate({ ref: "#c", target: { kind: "key", key: "contact.linkedin", entry: 0 } }),
  ];

  it("summarizes the review list", () => {
    expect(captureSummary([candidate({})])).toBe("1 answer you typed");
    expect(captureSummary(mixed)).toBe("2 answers you typed · 1 profile field to fill in");
  });

  it("labels the save button by count", () => {
    expect(saveAnswersButtonText(0)).toBe("Nothing selected");
    expect(saveAnswersButtonText(1)).toBe("Save 1 answer");
    expect(saveAnswersButtonText(3)).toBe("Save 3 answers");
  });

  it("says what a save did, as the background counted it", () => {
    expect(savedText({ answers: 1, updates: 0, keys: 0, skipped: 0 })).toBe("Saved 1 answer.");
    expect(savedText({ answers: 1, updates: 1, keys: 1, skipped: 0 })).toBe("Saved 2 answers and filled in 1 profile field.");
    expect(savedText({ answers: 0, updates: 0, keys: 1, skipped: 0 })).toBe("Filled in 1 profile field.");
    expect(savedText({ answers: 0, updates: 0, keys: 0, skipped: 2 })).toBe("Nothing to save. 2 fields already had a value and were left alone.");
    expect(savedText({ answers: 1, updates: 0, keys: 0, skipped: 1 })).toBe("Saved 1 answer. 1 field already had a value and was left alone.");
  });

  it("passes the background's explanation through", () => {
    expect(readAnswersErrorText({ ok: false, error: "no-fields", message: "No form fields found on this page." })).toBe(
      "No form fields found on this page.",
    );
  });
});

describe("plannedValues", () => {
  const plan = {
    assignments: [
      { ref: "#first", key: "identity.firstName" as const, entry: 0, value: "Ada", display: "Ada", source: "heuristic" as const, confidence: 0.95 },
      { ref: "#degree", key: "education.degree" as const, entry: 0, value: "ma", display: "Master's degree", source: "heuristic" as const, confidence: 0.8 },
      { ref: "#city", key: "address.city" as const, entry: 0, value: "London", display: "London", source: "model" as const, confidence: 0.6 },
    ],
    attachments: [],
    skipped: [],
  };

  it("names only what the fill wrote, as the user sees it", () => {
    expect(plannedValues(plan, new Set())).toEqual([]); // nothing filled yet: nothing to hide
    expect(plannedValues(plan, new Set(["#first", "#degree"]))).toEqual([
      { ref: "#first", value: "Ada" },
      { ref: "#degree", value: "Master's degree" }, // the option's label, which is what is read back
    ]);
    // An unticked row or a failed write is not in the filled set, so the user's own value in that field is offered.
    expect(plannedValues(plan, new Set(["#city"]))).toEqual([{ ref: "#city", value: "London" }]);
  });
});
