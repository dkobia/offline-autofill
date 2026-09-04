import { describe, expect, it } from "vitest";
import {
  answerIdOf,
  answerKey,
  cleanQuestion,
  describeAnswers,
  foldQuestion,
  isAnswerKey,
  newAnswerId,
  normalizeAnswers,
} from "./answers";

describe("answer keys", () => {
  it("builds and recognizes keys, and reads the id back", () => {
    expect(answerKey("ab12cd34")).toBe("answer.ab12cd34");
    expect(isAnswerKey("answer.ab12cd34")).toBe(true);
    expect(answerIdOf("answer.ab12cd34")).toBe("ab12cd34");
    expect(isAnswerKey("answer.")).toBe(false);
    expect(isAnswerKey("answer.has space")).toBe(false);
    expect(isAnswerKey("contact.email")).toBe(false);
    expect(isAnswerKey(42)).toBe(false);
  });

  it("issues short ids that avoid the ones taken", () => {
    const id = newAnswerId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    const taken = new Set([id]);
    expect(newAnswerId(taken)).not.toBe(id);
  });
});

describe("cleanQuestion", () => {
  it("strips required markers, trailing colons, and extra whitespace", () => {
    expect(cleanQuestion("Desired salary *")).toBe("Desired salary");
    expect(cleanQuestion("* Desired salary")).toBe("Desired salary");
    expect(cleanQuestion("Preferred pronouns (optional)")).toBe("Preferred pronouns");
    expect(cleanQuestion("Are you authorized to work here? (required)")).toBe("Are you authorized to work here?");
    expect(cleanQuestion("Notice period Required")).toBe("Notice period");
    expect(cleanQuestion("  How did   you hear\nabout us?: ")).toBe("How did you hear about us?");
  });

  it("keeps a marker word that is part of the question, and caps the length", () => {
    expect(cleanQuestion("Is a visa required?")).toBe("Is a visa required?");
    expect(cleanQuestion("x".repeat(300))).toHaveLength(200);
  });
});

describe("foldQuestion", () => {
  it("compares questions by their words alone", () => {
    expect(foldQuestion("Why do you want to work here?")).toBe("why do you want to work here");
    expect(foldQuestion("Why do you want to work here? *")).toBe(foldQuestion("why do you want to work here"));
    expect(foldQuestion("Desired salary (USD)")).toBe("desired salary usd");
  });
});

describe("normalizeAnswers", () => {
  it("keeps valid answers, trims and cleans, and drops blanks, bad ids, and duplicates", () => {
    const answers = normalizeAnswers([
      { id: "a1", question: " Desired salary * ", answer: " 90,000 ", multiline: "yes" },
      { id: "a2", question: "Why here?", answer: "Because.\nReally.", multiline: true },
      { id: "a1", question: "Duplicate id", answer: "x" },
      { id: "bad id", question: "Q", answer: "A" },
      { id: "a3", question: "", answer: "A" },
      { id: "a4", question: "Q", answer: "   " },
      { id: "a5", question: "desired SALARY (required)", answer: "the second answer to the same question" },
      "junk",
      null,
    ]);
    expect(answers).toEqual([
      { id: "a1", question: "Desired salary", answer: "90,000" },
      { id: "a2", question: "Why here?", answer: "Because.\nReally.", multiline: true },
    ]);
    expect(normalizeAnswers("nope")).toEqual([]);
  });
});

describe("describeAnswers", () => {
  it("hands the mapping layer keys and questions, never answers", () => {
    const specs = describeAnswers([
      { id: "a1", question: "Desired salary", answer: "90,000" },
      { id: "a2", question: "Why here?", answer: "Because.", multiline: true },
    ]);
    expect(specs).toEqual([
      { key: "answer.a1", question: "Desired salary" },
      { key: "answer.a2", question: "Why here?", multiline: true },
    ]);
    for (const spec of specs) {
      expect(spec).not.toHaveProperty("answer");
    }
  });
});
