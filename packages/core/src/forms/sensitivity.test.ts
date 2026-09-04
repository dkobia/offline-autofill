import { describe, expect, it } from "vitest";
import { loadFixture } from "../fixtures.test-util";
import { collectFields, type CollectedField } from "./collect";
import { assessField } from "./sensitivity";

function field(partial: Partial<CollectedField>): CollectedField {
  return { ref: "#x", tag: "input", type: "text", visible: true, editable: true, hasValue: false, ...partial };
}

describe("assessField", () => {
  it.each([
    [{ type: "password" }, "password"],
    [{ autocomplete: "current-password" }, "password"],
    [{ autocomplete: "billing cc-number" }, "payment-card"],
    [{ autocomplete: "one-time-code" }, "one-time-code"],
    [{ label: "Card number" }, "payment-card"],
    [{ name: "cardNumber" }, "payment-card"],
    [{ placeholder: "CVV" }, "payment-card"],
    [{ label: "Social Security number" }, "government-id"],
    [{ id: "taxpayerId" }, "government-id"],
    [{ label: "IBAN" }, "bank-account"],
    [{ name: "routing_number" }, "bank-account"],
    [{ label: "PIN" }, "password"],
    [{ label: "Verification code" }, "one-time-code"],
  ] as const)("blocks %j as %s", (partial, reason) => {
    expect(assessField(field(partial))).toEqual({ blocked: true, reason });
  });

  it("lets ordinary fields through", () => {
    expect(assessField(field({ label: "First name", autocomplete: "given-name" }))).toEqual({ blocked: false });
    expect(assessField(field({ name: "shipping" }))).toEqual({ blocked: false }); // no "pin" inside words
    expect(assessField(field({ label: "Printing options" }))).toEqual({ blocked: false });
  });

  it("a friendly autocomplete cannot launder a labelled password", () => {
    expect(assessField(field({ autocomplete: "name", label: "New password" })).blocked).toBe(true);
  });

  it("blocks the sensitive fields of the login fixture", () => {
    const fields = collectFields(loadFixture("hidden-fields.html"));
    const blocked = fields.filter((f) => assessField(f).blocked).map((f) => f.name);
    expect(blocked).toEqual(["pass", "card", "ssn"]);
  });
});
