import { describe, expect, it } from "vitest";
import { WHY_ANSWER, answeredScreening } from "../answered.test-util";
import { loadFixture, parseDocument } from "../fixtures.test-util";
import { collectFields } from "./collect";
import { collectAnswers, readValues } from "./values";

describe("readValues", () => {
  const document = answeredScreening();
  const fields = collectFields(document);
  const refOf = (name: string) => fields.find((f) => f.name === name)!.ref;

  it("reads typed text, an option's label for selects and radios, and nothing from a fresh page", () => {
    const refs = ["email", "linkedin", "pronouns", "salary", "authorized", "sponsorship", "why", "source", "q_17"].map(refOf);
    expect(readValues(document, refs).map((v) => v.value)).toEqual([
      "ada@example.com",
      "https://linkedin.com/in/ada",
      "she/her",
      "£90,000",
      "Yes",
      "No",
      WHY_ANSWER,
      "A friend",
      "42",
    ]);
    const fresh = loadFixture("screening-questions.html");
    expect(readValues(fresh, refs)).toEqual([]);
  });

  it("never reads a password, a hidden input, or a ref that resolves to nothing", () => {
    const refs = [refOf("password"), refOf("token"), "#nope", "not a selector"];
    expect(readValues(document, refs)).toEqual([]);
  });

  it("skips disabled, read-only, and hidden controls, checkboxes, and a select left on its placeholder", () => {
    const page = parseDocument(`
      <input id="a" value="typed" disabled />
      <input id="b" value="typed" readonly />
      <div hidden><input id="c" value="typed" /></div>
      <select id="d"><option value="">Select...</option><option value="x">X</option></select>
      <input id="e" type="checkbox" checked />
      <input id="f" value="  typed  " />
    `);
    expect(readValues(page, ["#a", "#b", "#c", "#d", "#e", "#f"])).toEqual([{ ref: "#f", value: "typed" }]);
  });

  it("honours a stricter environment", () => {
    const page = parseDocument(`<input id="a" value="typed" />`);
    expect(readValues(page, ["#a"])).toEqual([{ ref: "#a", value: "typed" }]);
    expect(readValues(page, ["#a"], { isVisible: () => false })).toEqual([]);
  });
});

describe("readValues on combobox widgets", () => {
  it("reads the displayed choice when the input is empty, and the typed text otherwise", () => {
    const document = loadFixture("ats-application.html");
    expect(readValues(document, ["#question_7", "#question_6"])).toEqual([{ ref: "#question_7", value: "No" }]);
    (document.getElementById("question_6") as HTMLInputElement).value = "5 years";
    expect(readValues(document, ["#question_6"])).toEqual([{ ref: "#question_6", value: "5 years" }]);
  });
});

describe("collectAnswers", () => {
  it("returns the fields of the moment with the values of the eligible ones that hold a value", () => {
    const document = answeredScreening();
    const { fields, values } = collectAnswers(document);
    const nameOf = (ref: string) => fields.find((f) => f.ref === ref)!.name;
    expect(values.map((v) => nameOf(v.ref))).toEqual(["email", "linkedin", "pronouns", "salary", "authorized", "sponsorship", "why", "source", "q_17"]);
    document.querySelector('label[for="salary"]')!.textContent = "Social Security Number";
    const again = collectAnswers(document);
    expect(again.values.map((v) => nameOf(v.ref))).not.toContain("salary");
    expect(again.fields.find((f) => f.name === "salary")!.label).toBe("Social Security Number");
  });
});
