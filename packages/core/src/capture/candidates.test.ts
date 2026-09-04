import { describe, expect, it } from "vitest";
import { WHY_ANSWER, answeredScreening } from "../answered.test-util";
import { loadFixture } from "../fixtures.test-util";
import { collectFields } from "../forms/collect";
import { readValues } from "../forms/values";
import { mapByHeuristics } from "../mapping/heuristics";
import { eligibleFields } from "../mapping/resolve";
import { planFill } from "../fill/plan";
import { describeAnswers } from "../profile/answers";
import { normalizeProfile, type Profile } from "../profile/schema";
import { applyAnswers, proposeAnswers, type AnswerCandidate } from "./candidates";

const profile = normalizeProfile({
  identity: { firstName: "Ada", lastName: "Lovelace" },
  contact: { email: "ada@example.com" },
});

/** The screening fixture answered, read the way the background reads it: every eligible field that holds a value. */
function capture(page: Profile = profile) {
  const document = answeredScreening();
  const fields = collectFields(document);
  const refs = fields.filter((f) => f.visible && f.editable && f.hasValue).map((f) => f.ref);
  const values = readValues(document, refs);
  return { fields, values, candidates: proposeAnswers({ fields, values, profile: page }) };
}

describe("proposeAnswers", () => {
  const { candidates } = capture();
  const byName = new Map(candidates.map((c) => [c.label, c]));

  it("offers what the user typed, as questions, in the page's order", () => {
    expect(candidates.map((c) => c.question)).toEqual([
      "LinkedIn profile",
      "Preferred pronouns",
      "Desired salary",
      "Are you legally authorized to work in this country?",
      "Will you now or in the future require sponsorship?",
      "Why do you want to work here?",
      "How did you hear about us?",
    ]);
  });

  it("keeps the label the page showed and the value as the user sees it", () => {
    expect(byName.get("Desired salary *")).toMatchObject({ value: "£90,000", multiline: false, target: { kind: "answer" } });
    expect(byName.get("Are you legally authorized to work in this country? (required)")!.value).toBe("Yes");
    expect(byName.get("Will you now or in the future require sponsorship?")!.value).toBe("No");
    expect(byName.get("Why do you want to work here?")).toMatchObject({ value: WHY_ANSWER, multiline: true });
  });

  it("sends a field the rules recognize to its empty profile key, not to a new answer", () => {
    expect(byName.get("LinkedIn profile")!.target).toEqual({ kind: "key", key: "contact.linkedin", entry: 0 });
  });

  it("leaves out fields whose value the profile already holds, fields without a label, and fields it never reads", () => {
    const labels = candidates.map((c) => c.label);
    expect(labels).not.toContain("Email *"); // the profile's own email, typed again
    expect(candidates.some((c) => c.ref.includes("mystery"))).toBe(false);
    expect(candidates.some((c) => c.ref.includes("password"))).toBe(false);
  });

  it("recognizes a built-in value already stored, whatever field it sits in and however it is punctuated", () => {
    const known = normalizeProfile({ ...profile, contact: { email: "ada@example.com", linkedin: "https://linkedin.com/in/ada" } });
    expect(capture(known).candidates.map((c) => c.question)).not.toContain("LinkedIn profile");
    const folded = normalizeProfile({ ...profile, contact: { email: "ada@example.com", linkedin: "LinkedIn.com/in/ADA" } });
    expect(capture(folded).candidates.map((c) => c.question)).not.toContain("LinkedIn profile");
  });

  it("offers an update when a saved answer asks the same question with a different answer", () => {
    const saved = normalizeProfile({ ...profile, answers: [{ id: "s1", question: "Desired salary", answer: "£80,000" }] });
    const { candidates: withSaved } = capture(saved);
    expect(withSaved.find((c) => c.question === "Desired salary")!.target).toEqual({ kind: "update", id: "s1" });
  });

  it("proposes nothing from a page with nothing typed", () => {
    const fields = collectFields(loadFixture("screening-questions.html"));
    expect(proposeAnswers({ fields, values: [], profile })).toEqual([]);
  });
});

describe("applyAnswers", () => {
  const { candidates } = capture();
  const { profile: saved, outcome } = applyAnswers(profile, candidates);

  it("saves new answers with unique ids, fills the built-in key, and keeps the multi-line shape", () => {
    expect(outcome).toEqual({ answers: 6, updates: 0, keys: 1, skipped: 0 });
    expect(saved.contact.linkedin).toBe("https://linkedin.com/in/ada");
    expect(saved.answers.map((a) => a.question)).toEqual([
      "Preferred pronouns",
      "Desired salary",
      "Are you legally authorized to work in this country?",
      "Will you now or in the future require sponsorship?",
      "Why do you want to work here?",
      "How did you hear about us?",
    ]);
    expect(new Set(saved.answers.map((a) => a.id)).size).toBe(6);
    expect(saved.answers.find((a) => a.question.startsWith("Why"))).toMatchObject({ answer: WHY_ANSWER, multiline: true });
    expect(saved.answers.find((a) => a.question === "Desired salary")).not.toHaveProperty("multiline");
    expect(profile.answers).toEqual([]);
  });

  it("replaces the answer of an updated question and creates a repeating entry for a key past the end", () => {
    const start = normalizeProfile({ answers: [{ id: "s1", question: "Desired salary", answer: "£80,000" }] });
    const chosen: AnswerCandidate[] = [
      { ref: "#salary", label: "Desired salary *", question: "Desired salary", value: "£90,000", multiline: false, target: { kind: "update", id: "s1" } },
      { ref: "#school", label: "School", question: "School", value: "MIT", multiline: false, target: { kind: "key", key: "education.institution", entry: 1 } },
      { ref: "#blank", label: "Blank", question: "Blank", value: "   ", multiline: false, target: { kind: "answer" } },
      { ref: "#full", label: "Full name", question: "Full name", value: "Ada", multiline: false, target: { kind: "key", key: "identity.fullName", entry: 0 } },
    ];
    const { profile: next, outcome: counts } = applyAnswers(start, chosen);
    expect(counts).toEqual({ answers: 0, updates: 1, keys: 1, skipped: 2 });
    expect(next.answers).toEqual([{ id: "s1", question: "Desired salary", answer: "£90,000" }]);
    expect(next.education).toEqual([{ institution: "MIT" }]); // the empty entry 0 is pruned by normalization
    expect(next.identity).toEqual({});
  });

  it("fills the saved questions next time, by rules alone", () => {
    const fresh = collectFields(loadFixture("screening-questions.html"));
    const { mapped, unmapped } = mapByHeuristics(eligibleFields(fresh).eligible, describeAnswers(saved.answers));
    const plan = planFill(fresh, mapped, saved);
    const values = new Map(plan.assignments.map((a) => [a.label, a.display]));
    expect(values.get("Desired salary *")).toBe("£90,000");
    expect(values.get("Are you legally authorized to work in this country? (required)")).toBe("Yes");
    expect(values.get("Will you now or in the future require sponsorship?")).toBe("No");
    expect(values.get("Why do you want to work here?")).toBe(WHY_ANSWER);
    expect(values.get("LinkedIn profile")).toBe("https://linkedin.com/in/ada");
    expect(unmapped.map((f) => f.name)).toEqual(["q_17"]);
    expect(plan.assignments.filter((a) => a.key.startsWith("answer.")).every((a) => a.confidence === 0.95)).toBe(true);
  });
});

describe("proposeAnswers (one answer per question)", () => {
  it("offers a question answered like another one already saved: a value is known by its question, not by itself", () => {
    const saidYes = normalizeProfile({ ...profile, answers: [{ id: "s1", question: "Are you over 18?", answer: "Yes" }] });
    const { candidates } = capture(saidYes);
    expect(candidates.find((c) => c.question.startsWith("Are you legally authorized"))).toMatchObject({ value: "Yes", target: { kind: "answer" } });
  });

  it("drops a question whose saved answer is the same, and folds duplicated questions into one answer", () => {
    const same = normalizeProfile({ ...profile, answers: [{ id: "s1", question: "Desired salary", answer: "£ 90,000" }] });
    expect(capture(same).candidates.map((c) => c.question)).not.toContain("Desired salary");
    const twice: AnswerCandidate[] = [
      { ref: "#a", label: "Notice period", question: "Notice period", value: "One month", multiline: false, target: { kind: "answer" } },
      { ref: "#b", label: "Notice period *", question: "Notice period", value: "Two months", multiline: false, target: { kind: "answer" } },
    ];
    const { profile: saved, outcome } = applyAnswers(profile, twice);
    expect(saved.answers).toEqual([expect.objectContaining({ question: "Notice period", answer: "Two months" })]);
    expect(outcome).toEqual({ answers: 1, updates: 1, keys: 0, skipped: 0 });
  });

  it("keeps a built-in key that was filled in since the review", () => {
    const filled = normalizeProfile({ ...profile, contact: { email: "ada@example.com", linkedin: "https://linkedin.com/in/lovelace" } });
    const chosen: AnswerCandidate[] = [
      { ref: "#linkedin", label: "LinkedIn profile", question: "LinkedIn profile", value: "https://linkedin.com/in/ada", multiline: false, target: { kind: "key", key: "contact.linkedin", entry: 0 } },
    ];
    const { profile: kept, outcome } = applyAnswers(filled, chosen);
    expect(kept.contact.linkedin).toBe("https://linkedin.com/in/lovelace");
    expect(outcome).toEqual({ answers: 0, updates: 0, keys: 0, skipped: 1 });
  });

  it("updates by question when the named answer no longer asks the reviewed question", () => {
    const edited = normalizeProfile({ answers: [{ id: "s1", question: "Notice period", answer: "One month" }, { id: "s2", question: "Desired salary", answer: "£80,000" }] });
    const chosen: AnswerCandidate[] = [
      { ref: "#salary", label: "Desired salary *", question: "Desired salary", value: "£90,000", multiline: false, target: { kind: "update", id: "s1" } },
    ];
    const { profile: next } = applyAnswers(edited, chosen);
    expect(next.answers).toEqual([
      { id: "s1", question: "Notice period", answer: "One month" },
      { id: "s2", question: "Desired salary", answer: "£90,000" },
    ]);
  });

  it("leaves alone what the reviewed plan filled, and offers a built-in value typed into a custom question", () => {
    const document = answeredScreening();
    const fields = collectFields(document);
    const values = readValues(document, fields.filter((f) => f.visible && f.editable && f.hasValue).map((f) => f.ref));
    const salary = fields.find((f) => f.name === "salary")!;
    const withPlan = proposeAnswers({ fields, values, profile, planned: [{ ref: salary.ref, value: "£90,000" }] });
    expect(withPlan.map((c) => c.question)).not.toContain("Desired salary");
    const engineer = normalizeProfile({ ...profile, employment: [{ title: "she/her" }] });
    expect(proposeAnswers({ fields, values, profile: engineer }).find((c) => c.question === "Preferred pronouns")).toBeDefined();
  });
});

describe("proposeAnswers (what the fill wrote)", () => {
  it("recognizes a combobox showing the option the fill reached through an alias or a prefix, but holds a text field to its exact value", () => {
    const combobox = { ref: "#c", tag: "input" as const, type: "text", label: "Country", visible: true, editable: true, hasValue: true, combobox: true as const };
    const text = { ref: "#t", tag: "input" as const, type: "text", label: "Country of birth", visible: true, editable: true, hasValue: true };
    const fields = [combobox, text];
    const values = [
      { ref: "#c", value: "United States of America" },
      { ref: "#t", value: "United States of America" },
    ];
    const planned = [
      { ref: "#c", value: "United States" },
      { ref: "#t", value: "United States" },
    ];
    const bare = normalizeProfile({ identity: { firstName: "Ada" } });
    expect(proposeAnswers({ fields, values, profile: bare, planned }).map((c) => c.ref)).toEqual(["#t"]);
    expect(proposeAnswers({ fields, values, profile: bare }).map((c) => c.ref)).toEqual(["#c", "#t"]);
  });
});
