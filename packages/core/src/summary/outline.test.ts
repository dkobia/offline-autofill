import { describe, expect, it } from "vitest";
import { loadFixture } from "../fixtures.test-util";
import { collectFields } from "../forms/collect";
import { eligibleFields } from "../mapping/resolve";
import { collectFormContext } from "./context";
import { blockReasonPhrase, outlineForm } from "./outline";

function outlineOf(fixture: string) {
  const document = loadFixture(fixture);
  const { eligible, blocked } = eligibleFields(collectFields(document));
  return outlineForm(eligible, blocked, collectFormContext(document));
}

describe("outlineForm", () => {
  it("counts fields, required fields, questions, and uploads on the ATS form", () => {
    const outline = outlineOf("ats-application.html");
    expect(outline.fieldCount).toBe(14);
    expect(outline.requiredCount).toBe(9);
    expect(outline.questionCount).toBe(6);
    expect(outline.uploads).toEqual(["Resume/CV", "Cover Letter"]);
    expect(outline.submit).toBe("Submit application");
    expect(outline.blocked).toEqual([]);
  });

  it("lists the sections in page order", () => {
    const outline = outlineOf("job-application.html");
    expect(outline.sections).toEqual(["About you", "Education", "Work history", "Anything else"]);
    expect(outline.questionCount).toBe(2);
    // The only button is type=button outside a form; its label still reads as the submit action.
    expect(outline.submit).toBe("Submit application");
  });

  it("reports blocked kinds once each and never counts them as fields", () => {
    const outline = outlineOf("hidden-fields.html");
    // Email and the prefilled City; the readonly Country and the honeypots are out.
    expect(outline.fieldCount).toBe(2);
    expect(outline.blocked).toEqual(["password", "payment-card", "government-id"]);
    expect(outline.submit).toBeUndefined();
  });

  it("phrases every block reason", () => {
    expect(blockReasonPhrase("password")).toBe("a password");
    expect(blockReasonPhrase("one-time-code")).toBe("a one-time code");
    expect(blockReasonPhrase("payment-card")).toBe("payment card details");
    expect(blockReasonPhrase("bank-account")).toBe("bank account details");
    expect(blockReasonPhrase("government-id")).toBe("a government ID number");
  });
});
