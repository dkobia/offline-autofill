import { describe, expect, it } from "vitest";
import { loadFixture } from "../fixtures.test-util";
import { collectFields, type CollectedField } from "../forms/collect";
import type { AnswerSpec } from "../profile/answers";
import { entryIndexOf, keyFitsField, mapByHeuristics, normalizeEntries } from "./heuristics";
import type { FieldMapping } from "./types";

function field(partial: Partial<CollectedField>): CollectedField {
  return { ref: `#${partial.name ?? "x"}`, tag: "input", type: "text", visible: true, editable: true, hasValue: false, ...partial };
}

function keysByName(fields: CollectedField[]): Map<string | undefined, string> {
  const { mapped } = mapByHeuristics(fields);
  const refToName = new Map(fields.map((f) => [f.ref, f.name]));
  return new Map(mapped.map((m) => [refToName.get(m.ref), `${m.key}@${m.entry}`]));
}

describe("mapByHeuristics on an annotated form", () => {
  const fields = collectFields(loadFixture("contact-form.html"));
  const keys = keysByName(fields);

  it("maps every autocomplete-annotated field", () => {
    expect(keys.get("given")).toBe("identity.firstName@0");
    expect(keys.get("family")).toBe("identity.lastName@0");
    expect(keys.get("email")).toBe("contact.email@0");
    expect(keys.get("phone")).toBe("contact.phone@0");
    expect(keys.get("addr1")).toBe("address.line1@0");
    expect(keys.get("addr2")).toBe("address.line2@0");
    expect(keys.get("city")).toBe("address.city@0");
    expect(keys.get("state")).toBe("address.region@0");
    expect(keys.get("zip")).toBe("address.postalCode@0");
    expect(keys.get("country")).toBe("address.country@0");
  });

  it("leaves choices without a profile meaning unmapped", () => {
    const { unmapped } = mapByHeuristics(fields);
    expect(unmapped.map((f) => f.name)).toEqual(["method", "newsletter", "csrf"]);
  });

  it("grades autocomplete above labels", () => {
    const { mapped } = mapByHeuristics([
      field({ name: "a", autocomplete: "email" }),
      field({ name: "b", label: "Email" }),
      field({ name: "c", id: "userEmail" }),
    ]);
    expect(mapped.map((m) => m.confidence)).toEqual([0.95, 0.8, 0.7]);
  });
});

describe("mapByHeuristics on an unannotated application form", () => {
  const fields = collectFields(loadFixture("job-application.html"));
  const keys = keysByName(fields);
  const { unmapped } = mapByHeuristics(fields);

  it("reads labels from nearby prose", () => {
    expect(keys.get("applicant_first")).toBe("identity.firstName@0");
    expect(keys.get("applicant_last")).toBe("identity.lastName@0");
    expect(keys.get("li_url")).toBe("contact.linkedin@0");
    expect(keys.get("reach")).toBe("contact.email@0"); // placeholder "Email"
  });

  it("numbers repeating entries from 0 whatever the page counts from", () => {
    expect(keys.get("education[1][school]")).toBe("education.institution@0");
    expect(keys.get("education[2][school]")).toBe("education.institution@1");
    expect(keys.get("education[1][degree]")).toBe("education.degree@0");
    expect(keys.get("job_0_company")).toBe("employment.employer@0");
    expect(keys.get("job_1_company")).toBe("employment.employer@1");
    expect(keys.get("job_1_title")).toBe("employment.title@1");
  });

  it("resolves ambiguous dates through the section", () => {
    expect(keys.get("education[1][start]")).toBe("education.startDate@0");
    expect(keys.get("education[1][end]")).toBe("education.endDate@0");
    expect(keys.get("job_0_from")).toBe("employment.startDate@0");
  });

  it("leaves genuinely ambiguous fields for the model", () => {
    expect(unmapped.map((f) => f.name)).toEqual(["pronouns", "motivation"]);
  });

  it("maps the degree level select for option matching later", () => {
    expect(keys.get("degree_level")).toBe("education.degree@0");
  });
});

describe("mapByHeuristics on a hosted ATS application", () => {
  // Heuristics see only what resolve offers them: the visible fields.
  const fields = collectFields(loadFixture("ats-application.html")).filter((f) => f.visible);
  const { mapped, unmapped } = mapByHeuristics(fields);
  const refToId = new Map(fields.map((f) => [f.ref, f.id]));
  const keys = new Map(mapped.map((m) => [refToId.get(m.ref), m.key]));

  it("maps the contact block, comboboxes included", () => {
    expect(keys.get("first_name")).toBe("identity.firstName");
    expect(keys.get("last_name")).toBe("identity.lastName");
    expect(keys.get("preferred_name")).toBe("identity.firstName");
    expect(keys.get("email")).toBe("contact.email");
    expect(keys.get("phone")).toBe("contact.phone");
    expect(keys.get("candidate-location")).toBe("address.city");
    expect(keys.get("question_1")).toBe("contact.linkedin");
  });

  it("leaves the phone group's country to the widget, which derives the dialing code from the number", () => {
    expect(keys.get("country")).toBeUndefined();
    expect(keyFitsField(field({ name: "c", label: "Country", sectionText: "Phone" }), "address.country")).toBe(false);
    expect(keyFitsField(field({ name: "c", label: "Country", sectionText: "Mobile number" }), "address.country")).toBe(false);
    expect(keyFitsField(field({ name: "c", label: "Country", sectionText: "Phone" }), "contact.phone")).toBe(true);
    expect(keyFitsField(field({ name: "c", label: "Country", sectionText: "Home address" }), "address.country")).toBe(true);
    expect(keyFitsField(field({ name: "c", label: "Country" }), "address.country")).toBe(true);
  });

  it("leaves screening questions to the model, even when a keyword appears inside them", () => {
    // "this role", "states", "Software Engineer" all occur in these labels.
    expect(unmapped.map((f) => f.id)).toEqual(["country", "question_2", "question_3", "question_4", "question_5", "question_6", "question_7"]);
  });
});

describe("mapByHeuristics guards", () => {
  it("skips label patterns on question-shaped labels but keeps identifier hints", () => {
    const { mapped, unmapped } = mapByHeuristics([
      field({ name: "q1", label: "Are you willing to relocate for this role?" }),
      field({ name: "q2", label: "Please tell us the city you would like to work from next year" }),
      field({ name: "job_title", label: "What title best describes your current position?" }),
    ]);
    expect(unmapped.map((f) => f.name)).toEqual(["q1", "q2"]);
    expect(mapped).toEqual([{ ref: "#job_title", key: "employment.title", entry: 0, source: "heuristic", confidence: 0.7 }]);
  });

  it("applies the question guard to typed inputs and to every label signal, but not to autocomplete", () => {
    const { mapped, unmapped } = mapByHeuristics([
      field({ name: "boss", type: "email", label: "What is your manager’s email address?" }),
      field({ name: "yours", type: "email", label: "What is your manager’s email address?", autocomplete: "email" }),
      field({ name: "aria", label: "Email", ariaLabel: "What email address should we use for your manager?" }),
      field({ name: "plain", type: "email", label: "Email" }),
    ]);
    expect(unmapped.map((f) => f.name)).toEqual(["boss", "aria"]);
    expect(mapped.map((m) => [m.ref, m.key, m.confidence])).toEqual([
      ["#yours", "contact.email", 0.95],
      ["#plain", "contact.email", 0.9],
    ]);
  });

  it("only lets prose keys and the street address into a textarea, autocomplete included", () => {
    const { mapped, unmapped } = mapByHeuristics([
      field({ name: "t1", tag: "textarea", label: "Job title" }),
      field({ name: "t2", tag: "textarea", label: "Describe your responsibilities" }),
      field({ name: "t3", tag: "textarea", label: "Street address" }),
      field({ name: "t4", tag: "textarea", autocomplete: "email" }),
      field({ name: "t5", tag: "textarea", autocomplete: "street-address" }),
    ]);
    expect(unmapped.map((f) => f.name)).toEqual(["t1", "t4"]);
    expect(mapped.map((m) => [m.ref, m.key])).toEqual([
      ["#t2", "employment.description"],
      ["#t3", "address.line1"],
      ["#t5", "address.line1"],
    ]);
  });
});

describe("entry indexes", () => {
  it("extracts the first integer from names and ids", () => {
    expect(entryIndexOf(field({ name: "education[3][school]" }))).toBe(3);
    expect(entryIndexOf(field({ name: "job-12-title" }))).toBe(12);
    expect(entryIndexOf(field({ name: "school", id: "edu_2" }))).toBe(2);
    expect(entryIndexOf(field({ name: "address1" }))).toBeUndefined();
  });

  it("normalizes per section", () => {
    const mappings: FieldMapping[] = [
      { ref: "a", key: "education.institution", entry: 1, source: "heuristic", confidence: 1 },
      { ref: "b", key: "education.institution", entry: 2, source: "heuristic", confidence: 1 },
      { ref: "c", key: "employment.employer", entry: 0, source: "heuristic", confidence: 1 },
    ];
    expect(normalizeEntries(mappings, new Set(["a", "b", "c"])).map((m) => m.entry)).toEqual([0, 1, 0]);
  });

  it("leaves unindexed fields alone and out of the shift", () => {
    const mappings: FieldMapping[] = [
      { ref: "a", key: "education.institution", entry: 1, source: "heuristic", confidence: 1 },
      { ref: "lone", key: "education.degree", entry: 0, source: "heuristic", confidence: 1 },
    ];
    expect(normalizeEntries(mappings, new Set(["a"])).map((m) => m.entry)).toEqual([0, 0]);
  });
});

describe("mapByHeuristics with saved answers", () => {
  const answers: AnswerSpec[] = [
    { key: "answer.a1", question: "Why do you want to work here?", multiline: true },
    { key: "answer.a2", question: "Desired salary" },
    { key: "answer.a3", question: "Phone" },
  ];

  it("maps a field whose whole label is a saved question, markers and case aside, above the label patterns", () => {
    const { mapped } = mapByHeuristics(
      [
        field({ name: "why", tag: "textarea", label: "Why do you want to work here?" }),
        field({ name: "salary", label: "DESIRED SALARY *" }),
        field({ name: "salary2", placeholder: "Desired salary (required)" }),
      ],
      answers,
    );
    expect(mapped.map((m) => [m.key, m.confidence, m.entry])).toEqual([
      ["answer.a1", 0.95, 0],
      ["answer.a2", 0.95, 0],
      ["answer.a2", 0.95, 0],
    ]);
  });

  it("matches a sentence-length question the label contains, as a guess, and never a short one", () => {
    const { mapped, unmapped } = mapByHeuristics(
      [
        field({ name: "why", tag: "textarea", label: "Why do you want to work here at Acme Corp?" }),
        field({ name: "sal", label: "Desired salary in USD per year" }),
        field({ name: "unrelated", label: "Why?" }),
      ],
      answers,
    );
    expect(mapped.map((m) => [m.key, m.confidence])).toEqual([["answer.a1", 0.7]]);
    expect(unmapped.map((f) => f.name)).toEqual(["sal", "unrelated"]);
  });

  it("lets an explicit autocomplete token and the blocked rules stand", () => {
    const { mapped } = mapByHeuristics([field({ name: "p", label: "Phone", autocomplete: "tel" })], answers);
    expect(mapped[0]!.key).toBe("contact.phone");
  });

  it("never writes a multi-line answer into a single-line input, and takes any answer in a textarea", () => {
    const { mapped } = mapByHeuristics(
      [
        field({ name: "one-line", label: "Why do you want to work here?" }),
        field({ name: "area", tag: "textarea", label: "Desired salary" }),
      ],
      answers,
    );
    expect(mapped.map((m) => [m.ref, m.key])).toEqual([["#area", "answer.a2"]]);
    expect(keyFitsField(field({}), "answer.a1", answers)).toBe(false);
    expect(keyFitsField(field({}), "answer.a2", answers)).toBe(true);
    expect(keyFitsField(field({}), "answer.unknown", answers)).toBe(false);
    expect(keyFitsField(field({ tag: "textarea" }), "answer.a1", answers)).toBe(true);
  });

  it("changes nothing when there are no saved answers", () => {
    const fields = collectFields(loadFixture("job-application.html"));
    expect(mapByHeuristics(fields)).toEqual(mapByHeuristics(fields, []));
  });
});
