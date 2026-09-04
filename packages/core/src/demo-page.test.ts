// Guards demo/index.html against drift in the rules: the page was built so
// one scan shows every kind of row the panel has, and this test says which
// field is which. Change the page and this test together.

import { describe, expect, it } from "vitest";
import type { StoredDocument } from "./documents/store";
import { planFill } from "./fill/plan";
import { loadDemoPage, loadDemoProfile } from "./fixtures.test-util";
import { collectFields } from "./forms/collect";
import { collectUploads } from "./forms/uploads";
import { resolveMappings } from "./mapping/resolve";
import { resolveUploads } from "./mapping/uploads";
import { normalizeProfile } from "./profile/schema";

const page = loadDemoPage();
const fields = collectFields(page);
const uploads = collectUploads(page);
const profile = normalizeProfile(loadDemoProfile());

const documents: StoredDocument[] = [
  {
    id: "d-resume",
    kind: "resume",
    description: "",
    fileName: "Tessa_Marlowe_Resume.pdf",
    mimeType: "application/pdf",
    size: 144701,
    addedAt: "2026-09-04T10:00:00.000Z",
  },
  {
    id: "d-cover",
    kind: "coverLetter",
    description: "",
    fileName: "Tessa_Marlowe_Cover_Letter.pdf",
    mimeType: "application/pdf",
    size: 74744,
    addedAt: "2026-09-04T10:01:00.000Z",
  },
];

const nameOf = new Map(fields.map((field) => [field.ref, field.name]));

describe("the demo application page, rules only", () => {
  it("maps every profile field to the key and entry the page was built for", async () => {
    const { mappings } = await resolveMappings(fields);
    const byName = new Map(mappings.map((m) => [nameOf.get(m.ref), `${m.key}@${m.entry}`]));
    expect(Object.fromEntries(byName)).toEqual({
      first_name: "identity.firstName@0",
      last_name: "identity.lastName@0",
      email: "contact.email@0",
      phone: "contact.phone@0",
      linkedin: "contact.linkedin@0",
      github: "contact.github@0",
      website: "contact.website@0",
      street: "address.line1@0",
      street2: "address.line2@0",
      city: "address.city@0",
      state: "address.region@0",
      zip: "address.postalCode@0",
      country: "address.country@0",
      "education[0][school]": "education.institution@0",
      "education[0][degree]": "education.degree@0",
      "education[0][field]": "education.fieldOfStudy@0",
      "education[0][start]": "education.startDate@0",
      "education[0][end]": "education.endDate@0",
      "employment[0][employer]": "employment.employer@0",
      "employment[0][title]": "employment.title@0",
      "employment[0][start]": "employment.startDate@0",
      "employment[0][end]": "employment.endDate@0",
      "employment[0][summary]": "employment.description@0",
      "employment[1][employer]": "employment.employer@1",
      "employment[1][title]": "employment.title@1",
      "employment[1][start]": "employment.startDate@1",
      "employment[1][end]": "employment.endDate@1",
      "employment[1][summary]": "employment.description@1",
    });
  });

  it("leaves the screening questions, the pronouns, and the job locations to the model", async () => {
    const { unmapped } = await resolveMappings(fields);
    expect(unmapped.map((field) => field.name).sort()).toEqual(
      [
        "availability",
        "certify",
        "employment[0][location]",
        "employment[1][location]",
        "expected_salary",
        "pronouns",
        "referral_source",
        "why_acme",
        "work_authorization",
      ].sort(),
    );
  });

  it("refuses the password and never sees the honeypot", async () => {
    const { blocked } = await resolveMappings(fields);
    expect(blocked.map((field) => field.name)).toEqual(["password"]);
    const honeypot = fields.find((field) => field.name === "website_url");
    expect(honeypot?.visible).toBe(false);
  });

  it("plans a value for every mapped field from the demo profile, dropdowns included", async () => {
    const { mappings } = await resolveMappings(fields);
    const plan = planFill(fields, mappings, profile);
    const byName = new Map(plan.assignments.map((a) => [nameOf.get(a.ref), a.display]));
    expect(byName.get("state")).toBe("Oregon");
    expect(byName.get("country")).toBe("United States");
    expect(byName.get("education[0][end]")).toBe("2018-06");
    expect(byName.get("employment[1][employer]")).toBe("Tidewater Robotics");
    expect(byName.get("employment[0][summary]")).toContain("Lead engineer");
    // The current job has no end date; that is the only mapped field without a value.
    expect(plan.skipped.map((s) => [nameOf.get(s.ref), s.reason])).toEqual([["employment[0][end]", "no-value"]]);
  });

  it("maps both uploads to their kinds and attaches the demo documents", async () => {
    const { mappings, unmapped, blocked } = await resolveUploads(uploads);
    expect(unmapped).toEqual([]);
    expect(blocked).toEqual([]);
    expect(uploads.map((upload) => [upload.name, upload.label])).toEqual([
      ["resume", "Resume/CV"],
      ["cover_letter", "Cover letter"],
    ]);
    expect(mappings.map((m) => m.kind)).toEqual(["resume", "coverLetter"]);
    const plan = planFill(fields, [], profile, { attach: { uploads, mappings, documents } });
    expect(plan.attachments.map((a) => a.fileName)).toEqual(["Tessa_Marlowe_Resume.pdf", "Tessa_Marlowe_Cover_Letter.pdf"]);
  });
});
