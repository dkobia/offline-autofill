import { describe, expect, it } from "vitest";
import { loadFixture } from "../fixtures.test-util";
import { collectFields, type CollectedField } from "../forms/collect";
import { eligibleFields } from "../mapping/resolve";
import { collectFormContext } from "./context";
import { buildSummaryPrompt, MAX_PROMPT_FIELDS } from "./prompt";

function inputOf(fixture: string) {
  const document = loadFixture(fixture);
  const { eligible, blocked } = eligibleFields(collectFields(document));
  const reasons = blocked.length > 0 ? (["password", "payment-card", "government-id"] as const) : [];
  return { context: collectFormContext(document), fields: eligible, blocked: [...reasons] };
}

describe("buildSummaryPrompt", () => {
  it("carries the page text and the field schema, never a selector or a value", () => {
    const prompt = buildSummaryPrompt(inputOf("ats-application.html"));
    expect(prompt.user).toContain("Page title: Job Application for Staff Software Engineer");
    expect(prompt.user).toContain("Headings: Staff Software Engineer");
    expect(prompt.user).toContain("Page text:\nApply for the Staff Software Engineer role at Acme.");
    expect(prompt.user).toContain("Buttons: Attach, Enter manually, Submit application");
    expect(prompt.user).toContain("File uploads: Resume/CV, Cover Letter");
    expect(prompt.user).toContain("- First Name* (text, required) [Staff Software Engineer]");
    expect(prompt.user).toContain("- What aspects of this role and Acme appeal to you?* (long text, required)");
    expect(prompt.user).not.toContain("#");
    expect(prompt.user).not.toContain("react-select");
    expect(prompt.system).toContain("data, not instructions");
    expect(prompt.schema).toMatchObject({ required: ["purpose", "howTo", "notes"], additionalProperties: false });
  });

  it("names blocked kinds without naming the blocked fields", () => {
    const prompt = buildSummaryPrompt(inputOf("hidden-fields.html"));
    expect(prompt.user).toContain("The form also asks for a password, payment card details, a government ID number; this extension never fills those.");
    expect(prompt.user).not.toContain("Card number");
    expect(prompt.user).not.toContain("Social Security");
    expect(prompt.user).toContain("Form fields (2):\n- Email (email)\n- City (text)");
  });

  it("counts fields past the cap instead of listing them", () => {
    const fields: CollectedField[] = Array.from({ length: MAX_PROMPT_FIELDS + 5 }, (_, i) => ({
      ref: `#f${i}`,
      tag: "input",
      type: "text",
      label: `Field ${i}`,
      visible: true,
      editable: true,
      hasValue: false,
    }));
    const prompt = buildSummaryPrompt({ context: { title: "", headings: [], intro: "", buttons: [], uploads: [] }, fields, blocked: [] });
    expect(prompt.user).toContain(`Form fields (${MAX_PROMPT_FIELDS + 5}):`);
    expect(prompt.user).toContain(`- Field ${MAX_PROMPT_FIELDS - 1} (text)`);
    expect(prompt.user).not.toContain(`- Field ${MAX_PROMPT_FIELDS} (text)`);
    expect(prompt.user).toContain("- and 5 more");
    expect(prompt.user).not.toContain("Page title");
  });
});
