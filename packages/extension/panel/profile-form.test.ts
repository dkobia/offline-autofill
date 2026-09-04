import { emptyProfile, normalizeProfile } from "@offline-autofill/core";
import { describe, expect, it } from "vitest";
import { addEntry, formSections, parsePath, removeEntry, setValue } from "./profile-form";

describe("formSections", () => {
  it("lays out every section with one implicit entry for empty repeating ones", () => {
    const sections = formSections(emptyProfile());
    expect(sections.map((s) => s.id)).toEqual(["identity", "contact", "address", "education", "employment", "answers"]);
    const identity = sections[0]!;
    expect(identity.entries).toHaveLength(1);
    expect(identity.entries[0]!.title).toBe("Identity");
    expect(identity.entries[0]!.fields.map((f) => f.path)).toEqual([
      "identity.0.firstName",
      "identity.0.middleName",
      "identity.0.lastName",
      "identity.0.dateOfBirth",
    ]);
    const address = sections[2]!;
    expect(address.entries).toHaveLength(1);
    expect(address.entries[0]!.title).toBe("Address 1");
    expect(address.addLabel).toBe("Add address");
  });

  it("lets short fields share a row and gives long ones the full width", () => {
    const widths = new Map(
      formSections(emptyProfile()).flatMap((s) => s.entries[0]!.fields.map((f) => [f.path, f.width] as const)),
    );
    expect(widths.get("identity.0.firstName")).toBe("half");
    expect(widths.get("identity.0.dateOfBirth")).toBe("half");
    expect(widths.get("address.0.line1")).toBe("full");
    expect(widths.get("address.0.city")).toBe("half");
    expect(widths.get("education.0.institution")).toBe("full");
    expect(widths.get("employment.0.startDate")).toBe("half");
    expect(widths.get("employment.0.description")).toBe("full");
  });

  it("shows stored values and numbered entries", () => {
    const profile = normalizeProfile({ education: [{ institution: "A" }, { institution: "B" }] });
    const education = formSections(profile).find((s) => s.id === "education")!;
    expect(education.entries.map((e) => e.title)).toEqual(["Education 1", "Education 2"]);
    expect(education.entries[1]!.fields[0]).toMatchObject({ path: "education.1.institution", value: "B", kind: "text" });
  });
});

describe("edits", () => {
  it("sets values immutably and creates entries on demand", () => {
    const original = emptyProfile();
    const next = setValue(original, "identity.0.firstName", "Ada");
    expect(next.identity.firstName).toBe("Ada");
    expect(original.identity.firstName).toBeUndefined();
    const withEntry = setValue(next, "address.1.city", "London");
    expect(withEntry.address).toEqual([{}, { city: "London" }]);
    expect(setValue(next, "bogus.0.x", "y")).toBe(next);
    expect(setValue(next, "identity.x.firstName", "y")).toBe(next);
  });

  it("adds and removes entries", () => {
    const one = addEntry(emptyProfile(), "employment");
    expect(one.employment).toHaveLength(2); // implicit first entry made explicit, plus the new one
    const two = addEntry(one, "employment");
    expect(two.employment).toHaveLength(3);
    expect(removeEntry(two, "employment", 1).employment).toHaveLength(2);
    expect(addEntry(emptyProfile(), "identity")).toEqual(emptyProfile());
  });

  it("parses paths", () => {
    expect(parsePath("address.2.city")).toEqual({ section: "address", entry: 2, field: "city" });
    expect(parsePath("nope.0.city")).toBeUndefined();
    expect(parsePath("address.-1.city")).toBeUndefined();
  });
});

describe("saved answers section", () => {
  it("shows one blank entry when nothing is saved, with a hint and an add button", () => {
    const section = formSections(emptyProfile()).find((s) => s.id === "answers")!;
    expect(section).toMatchObject({ label: "Saved answers", repeating: true, addLabel: "Add answer" });
    expect(section.hint).toContain("never the answers");
    expect(section.entries).toHaveLength(1);
    expect(section.entries[0]!.fields.map((f) => [f.path, f.label, f.kind, f.width])).toEqual([
      ["answers.0.question", "Question", "text", "full"],
      ["answers.0.answer", "Answer", "text", "full"],
    ]);
  });

  it("shows stored answers, multi-line ones in a textarea", () => {
    const profile = normalizeProfile({
      answers: [
        { id: "a1", question: "Desired salary", answer: "90,000" },
        { id: "a2", question: "Why?", answer: "Because.", multiline: true },
      ],
    });
    const section = formSections(profile).find((s) => s.id === "answers")!;
    expect(section.entries.map((e) => e.title)).toEqual(["Answer 1", "Answer 2"]);
    expect(section.entries[1]!.fields[1]).toMatchObject({ path: "answers.1.answer", value: "Because.", kind: "multiline" });
  });

  it("edits answers immutably, creating entries with fresh ids on demand", () => {
    const original = emptyProfile();
    const next = setValue(original, "answers.0.question", "Desired salary");
    expect(original.answers).toEqual([]);
    expect(next.answers).toHaveLength(1);
    expect(next.answers[0]).toMatchObject({ question: "Desired salary", answer: "" });
    expect(next.answers[0]!.id).toMatch(/^[0-9a-f]{8}$/);
    const answered = setValue(next, "answers.0.answer", "90,000");
    expect(answered.answers[0]).toMatchObject({ question: "Desired salary", answer: "90,000" });
    expect(setValue(next, "answers.0.multiline", "yes")).toBe(next);
    const two = addEntry(answered, "answers");
    expect(two.answers).toHaveLength(2);
    expect(two.answers[1]!.id).not.toBe(two.answers[0]!.id);
    expect(addEntry(emptyProfile(), "answers").answers).toHaveLength(2);
    expect(removeEntry(two, "answers", 0).answers).toEqual([two.answers[1]]);
    expect(parsePath("answers.1.answer")).toEqual({ section: "answers", entry: 1, field: "answer" });
  });

  it("keeps saved answers through edits to other sections", () => {
    const profile = normalizeProfile({ answers: [{ id: "a1", question: "Q", answer: "A" }] });
    expect(setValue(profile, "identity.0.firstName", "Ada").answers).toEqual(profile.answers);
    expect(addEntry(profile, "address").answers).toEqual(profile.answers);
  });
});
