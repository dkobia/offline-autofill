import { describe, expect, it } from "vitest";
import { loadFixture } from "../fixtures.test-util";
import type { StoredDocument } from "../documents/store";
import { collectFields } from "../forms/collect";
import { collectUploads } from "../forms/uploads";
import { mapByHeuristics } from "../mapping/heuristics";
import type { UploadMapping } from "../mapping/uploads";
import { normalizeProfile } from "../profile/schema";
import { matchOption, planAttachments, planFill, shapeDate } from "./plan";

const profile = normalizeProfile({
  identity: { firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1815-12-10" },
  contact: { email: "ada@example.com", phone: "+44 20 7946 0000", linkedin: "https://linkedin.com/in/ada" },
  address: [{ line1: "12 St James's Square", city: "London", region: "California", postalCode: "SW1Y 4JH", country: "United Kingdom" }],
  education: [
    { institution: "Home tutoring", degree: "Master's degree", startDate: "1828-01", endDate: "1835-06" },
    { institution: "Royal Society" },
  ],
  employment: [
    { employer: "Analytical Engine Co", title: "Programmer", startDate: "1842-01-01" },
    { employer: "Babbage & Co", title: "Consultant" },
  ],
});

describe("planFill on the contact form", () => {
  const fields = collectFields(loadFixture("contact-form.html"));
  const { mapped } = mapByHeuristics(fields);
  const plan = planFill(fields, mapped, profile);
  const byRef = new Map(plan.assignments.map((a) => [a.ref, a]));

  it("assigns text values with their labels", () => {
    expect(byRef.get("#given")).toMatchObject({ key: "identity.firstName", value: "Ada", display: "Ada", label: "First name" });
    expect(byRef.get("#email")!.value).toBe("ada@example.com");
  });

  it("matches select options through aliases and shows the option label", () => {
    expect(byRef.get("#state")).toMatchObject({ value: "CA", display: "California" });
    expect(byRef.get("#country")).toMatchObject({ value: "GB", display: "United Kingdom" });
  });

  it("skips keys the profile has no value for", () => {
    expect(byRef.has("#addr2")).toBe(false);
    expect(plan.skipped).toContainEqual({ ref: "#addr2", key: "address.line2", reason: "no-value", label: "Apartment, suite, etc." });
  });
});

describe("planFill on the application form", () => {
  const fields = collectFields(loadFixture("job-application.html"));
  const { mapped } = mapByHeuristics(fields);
  const plan = planFill(fields, mapped, profile);
  const byName = new Map(fields.map((f) => [f.ref, f.name]));
  const values = new Map(plan.assignments.map((a) => [byName.get(a.ref), a.value]));

  it("fills repeating entries in order", () => {
    expect(values.get("education[1][school]")).toBe("Home tutoring");
    expect(values.get("education[2][school]")).toBe("Royal Society");
    expect(values.get("job_0_company")).toBe("Analytical Engine Co");
    expect(values.get("job_1_title")).toBe("Consultant");
  });

  it("shapes dates to the control type", () => {
    expect(values.get("education[1][start]")).toBe("1828-01");
    expect(values.get("job_0_from")).toBe("1842-01");
  });

  it("matches a select by prefix when no alias fits", () => {
    expect(values.get("degree_level")).toBe("ma");
  });

  it("reports entries the profile does not have", () => {
    const missing = plan.skipped.filter((s) => s.reason === "no-value").map((s) => byName.get(s.ref));
    expect(missing).toContain("education[2][degree]");
  });
});

describe("planFill guards", () => {
  const fields = collectFields(loadFixture("hidden-fields.html"));

  it("does not overwrite a value already in the field unless asked", () => {
    const mapping = { ref: "#prefilled", key: "address.city" as const, entry: 0, source: "heuristic" as const, confidence: 1 };
    expect(planFill(fields, [mapping], profile).skipped[0]?.reason).toBe("already-filled");
    expect(planFill(fields, [mapping], profile, { overwrite: true }).assignments[0]?.value).toBe("London");
  });

  it("flags mappings to fields it cannot see", () => {
    const mapping = { ref: "#ghost", key: "address.city" as const, entry: 0, source: "model" as const, confidence: 0.6 };
    expect(planFill(fields, [mapping], profile).skipped[0]?.reason).toBe("unknown-field");
  });
});

describe("matchOption and shapeDate", () => {
  const options = [
    { value: "", label: "Select" },
    { value: "US", label: "United States" },
    { value: "GB", label: "United Kingdom" },
  ];

  it("matches exact, alias, and prefix, and refuses short fuzzy matches", () => {
    expect(matchOption(options, "GB")!.value).toBe("GB");
    expect(matchOption(options, "USA")!.value).toBe("US");
    expect(matchOption(options, "united k")!.value).toBe("GB");
    expect(matchOption(options, "Se")).toBeUndefined();
    expect(matchOption(options, "France")).toBeUndefined();
  });

  it("shapes ISO dates", () => {
    expect(shapeDate("1815-12-10", "date")).toBe("1815-12-10");
    expect(shapeDate("1815-12-10", "month")).toBe("1815-12");
    expect(shapeDate("1815-12", "date")).toBe("1815-12-01");
    expect(shapeDate("1815-12", "number")).toBe("1815");
    expect(shapeDate("Dec 1815", "month")).toBe("Dec 1815");
  });
});

describe("planAttachments", () => {
  const uploads = collectUploads(loadFixture("ats-application.html"));
  const documents: StoredDocument[] = [
    { id: "old", kind: "resume", description: "General", fileName: "cv-2024.pdf", mimeType: "application/pdf", size: 10, addedAt: "2024-01-01T00:00:00.000Z" },
    { id: "new", kind: "resume", description: "Tailored", fileName: "cv-2026.pdf", mimeType: "application/pdf", size: 10, addedAt: "2026-01-01T00:00:00.000Z" },
    { id: "photo", kind: "photo", description: "", fileName: "me.png", mimeType: "image/png", size: 10, addedAt: "2025-01-01T00:00:00.000Z" },
    { id: "letter", kind: "coverLetter", description: "", fileName: "letter.pages", mimeType: "", size: 10, addedAt: "2025-06-01T00:00:00.000Z" },
  ];
  const mappings: UploadMapping[] = [
    { ref: "#resume", kind: "resume", source: "heuristic", confidence: 0.9 },
    { ref: "#cover_letter", kind: "coverLetter", source: "heuristic", confidence: 0.9 },
  ];

  it("attaches the newest accepted document of the kind, offering the rest, and skips what the field refuses", () => {
    const { attachments, skipped } = planAttachments({ uploads, mappings, documents });
    expect(attachments).toEqual([
      {
        ref: "#resume",
        kind: "resume",
        documentId: "new",
        fileName: "cv-2026.pdf",
        choices: [
          { documentId: "new", fileName: "cv-2026.pdf", description: "Tailored", kind: "resume" },
          { documentId: "old", fileName: "cv-2024.pdf", description: "General", kind: "resume" },
        ],
        source: "heuristic",
        confidence: 0.9,
        label: "Resume/CV",
      },
    ]);
    // The cover letter is a .pages file the field's accept list refuses; the photo is not offered for a document field.
    expect(skipped).toEqual([{ ref: "#cover_letter", key: "document.coverLetter", reason: "not-accepted", label: "Cover Letter" }]);
  });

  it("skips kinds with no stored document, uploads that already hold a file, and vanished uploads", () => {
    const held = uploads.map((u) => ({ ...u, hasValue: true }));
    const plan = planAttachments({ uploads: held, mappings: [...mappings, { ref: "#gone", kind: "photo", source: "model", confidence: 0.6 }], documents: [] });
    expect(plan.attachments).toEqual([]);
    expect(plan.skipped.map((s) => [s.ref, s.reason])).toEqual([
      ["#resume", "already-filled"],
      ["#cover_letter", "already-filled"],
      ["#gone", "unknown-field"],
    ]);
    const overwrite = planAttachments({ uploads: held, mappings, documents: [] }, { overwrite: true });
    expect(overwrite.skipped.map((s) => s.reason)).toEqual(["no-document", "no-document"]);
  });

  it("is folded into planFill beside the assignments", () => {
    const fields = collectFields(loadFixture("ats-application.html"));
    const plan = planFill(fields, [], profile, { attach: { uploads, mappings, documents } });
    expect(plan.attachments.map((a) => a.documentId)).toEqual(["new"]);
    expect(plan.skipped.map((s) => s.key)).toEqual(["document.coverLetter"]);
    expect(planFill(fields, [], profile).attachments).toEqual([]);
  });
});

describe("planFill with saved answers", () => {
  const withAnswers = normalizeProfile({
    ...profile,
    answers: [
      { id: "a1", question: "Why do you want to work here?", answer: "Because.", multiline: true },
      { id: "a2", question: "Highest degree", answer: "Master's degree" },
    ],
  });
  const fields = collectFields(loadFixture("job-application.html"));

  it("resolves an answer key like any value, matching options and labelling the row", () => {
    const motivation = fields.find((f) => f.name === "motivation")!;
    const degree = fields.find((f) => f.name === "degree_level")!;
    const plan = planFill(
      fields,
      [
        { ref: motivation.ref, key: "answer.a1", entry: 0, source: "heuristic", confidence: 0.95 },
        { ref: degree.ref, key: "answer.a2", entry: 0, source: "model", confidence: 0.6 },
        { ref: degree.ref, key: "answer.nope", entry: 0, source: "model", confidence: 0.6 },
      ],
      withAnswers,
    );
    expect(plan.assignments).toEqual([
      expect.objectContaining({ key: "answer.a1", value: "Because.", display: "Because.", label: "Why do you want to work here?" }),
      expect.objectContaining({ key: "answer.a2", value: "ma", display: "Master's degree", label: "Highest degree" }),
    ]);
    expect(plan.skipped).toEqual([expect.objectContaining({ key: "answer.nope", reason: "no-value" })]);
  });

  it("names an unlabelled field by the question", () => {
    const bare = [{ ref: "#bare", tag: "input" as const, type: "text", visible: true, editable: true, hasValue: false }];
    const plan = planFill(bare, [{ ref: "#bare", key: "answer.a2", entry: 0, source: "model", confidence: 0.6 }], withAnswers);
    expect(plan.assignments[0]!.label).toBe("Highest degree");
  });
});
