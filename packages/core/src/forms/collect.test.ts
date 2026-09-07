import { describe, expect, it } from "vitest";
import { loadFixture, parseDocument } from "../fixtures.test-util";
import { chosenOption, collectFields, comboboxDisplayedValue } from "./collect";
import { resolveRef } from "./selector";
import { readValues } from "./values";

describe("collectFields (contact-form.html)", () => {
  const document = loadFixture("contact-form.html");
  const fields = collectFields(document);
  const byName = new Map(fields.map((field) => [field.name, field]));

  it("describes labelled inputs with their autocomplete tokens", () => {
    const given = byName.get("given")!;
    expect(given.label).toBe("First name");
    expect(given.autocomplete).toBe("given-name");
    expect(given.type).toBe("text");
    expect(given.visible).toBe(true);
    expect(given.editable).toBe(true);
    expect(given.hasValue).toBe(false);
    expect(byName.get("phone")!.placeholder).toBe("+1 555 000 0000");
  });

  it("flags required controls from the attribute or aria-required", () => {
    expect(byName.get("given")!.required).toBeUndefined();
    const doc = parseDocument(`<input id="a" required /><input id="b" aria-required="true" /><input id="c" aria-required="false" />`);
    const flags = collectFields(doc).map((field) => field.required);
    expect(flags).toEqual([true, true, undefined]);
  });

  it("marks a radio group required when any member is", () => {
    const doc = parseDocument(`
      <input type="radio" name="a" value="1" /><input type="radio" name="a" value="2" required />
      <input type="radio" name="b" value="1" /><input type="radio" name="b" value="2" />
    `);
    const groups = new Map(collectFields(doc).map((field) => [field.name, field]));
    expect(groups.get("a")!.required).toBe(true);
    expect(groups.get("b")!.required).toBeUndefined();
  });

  it("emits select options and the enclosing legend", () => {
    const state = byName.get("state")!;
    expect(state.type).toBe("select");
    expect(state.sectionText).toBe("Shipping address");
    expect(state.options).toEqual([
      { value: "CA", label: "California" },
      { value: "NY", label: "New York" },
      { value: "WA", label: "Washington" },
    ]);
  });

  it("merges a radio group into one field with options", () => {
    const method = byName.get("method")!;
    expect(method.type).toBe("radio");
    expect(method.label).toBe("Preferred contact method");
    expect(method.options).toEqual([
      { value: "email", label: "Email" },
      { value: "phone", label: "Phone" },
    ]);
    expect(fields.filter((field) => field.name === "method")).toHaveLength(1);
  });

  it("keeps hidden inputs but marks them invisible, and skips buttons", () => {
    expect(byName.get("csrf")!.visible).toBe(false);
    expect(byName.get("csrf")!.type).toBe("hidden");
    expect(fields.some((field) => field.type === "submit")).toBe(false);
  });

  it("produces refs that resolve back to exactly one element", () => {
    for (const field of fields) {
      const element = resolveRef(document, field.ref);
      expect(element, field.ref).toBeDefined();
      if (field.name) {
        expect(element!.getAttribute("name")).toBe(field.name);
      }
    }
  });
});

describe("collectFields (job-application.html)", () => {
  const fields = collectFields(loadFixture("job-application.html"));
  const byName = new Map(fields.map((field) => [field.name, field]));

  it("falls back to nearby prose when there is no label element", () => {
    expect(byName.get("applicant_first")!.label).toBeUndefined();
    expect(byName.get("applicant_first")!.nearbyText).toBe("Legal first name");
    expect(byName.get("education[1][school]")!.nearbyText).toBe("Institution attended");
  });

  it("attaches the nearest preceding heading as section text", () => {
    expect(byName.get("applicant_first")!.sectionText).toBe("About you");
    expect(byName.get("education[1][school]")!.sectionText).toBe("Education");
    expect(byName.get("job_0_company")!.sectionText).toBe("Work history");
    expect(byName.get("motivation")!.sectionText).toBe("Anything else");
  });

  it("describes textareas as text", () => {
    expect(byName.get("motivation")!.tag).toBe("textarea");
    expect(byName.get("motivation")!.type).toBe("text");
  });
});

describe("collectFields (hidden-fields.html)", () => {
  const fields = collectFields(loadFixture("hidden-fields.html"));
  const byName = new Map(fields.map((field) => [field.name, field]));

  it("marks honeypots invisible via inline style, hidden, and aria-hidden", () => {
    expect(byName.get("trap_email")!.visible).toBe(false);
    expect(byName.get("trap_phone")!.visible).toBe(false);
    expect(byName.get("trap_name")!.visible).toBe(false);
    expect(byName.get("user")!.visible).toBe(true);
  });

  it("reports existing values and read-only controls", () => {
    expect(byName.get("city")!.hasValue).toBe(true);
    expect(byName.get("country")!.editable).toBe(false);
  });

  it("honors a custom visibility environment", () => {
    const strict = collectFields(loadFixture("hidden-fields.html"), { isVisible: () => false });
    expect(strict.every((field) => !field.visible)).toBe(true);
  });
});

describe("collectFields (ats-application.html)", () => {
  const fields = collectFields(loadFixture("ats-application.html"));
  const byId = new Map(fields.map((field) => [field.id, field]));

  it("never collects file inputs, whatever they are labelled", () => {
    expect(byId.has("resume")).toBe(false);
    expect(byId.has("cover_letter")).toBe(false);
    expect(fields.some((field) => field.label === "Attach")).toBe(false);
  });

  it("flags react-select search inputs as comboboxes and plain inputs not", () => {
    expect(byId.get("country")!.combobox).toBe(true);
    expect(byId.get("candidate-location")!.combobox).toBe(true);
    expect(byId.get("question_2")!.combobox).toBe(true);
    expect(byId.get("first_name")!.combobox).toBeUndefined();
    expect(byId.get("question_5")!.combobox).toBeUndefined();
  });

  it("reads the combobox label through aria-labelledby", () => {
    expect(byId.get("country")!.label).toBe("Country*");
    expect(byId.get("candidate-location")!.label).toBe("Location (City)*");
  });

  it("names the phone group by its legend, visually hidden or not", () => {
    expect(byId.get("country")!.sectionText).toBe("Phone");
    expect(byId.get("phone")!.sectionText).toBe("Phone");
  });

  it("marks the hidden required inputs beside each combobox invisible", () => {
    const anonymous = fields.filter((field) => !field.id);
    expect(anonymous.length).toBeGreaterThan(0);
    expect(anonymous.every((field) => !field.visible)).toBe(true);
  });
});

describe("label resolution", () => {
  it("uses wrapping labels, aria-labelledby, and strips nested control text", () => {
    const document = parseDocument(`
      <label>Nickname <input name="nick" /></label>
      <span id="t1">Home</span> <span id="t2">town</span>
      <input name="town" aria-labelledby="t1 t2" />
      <p>Your favourite colour</p><input name="colour" />
    `);
    const byName = new Map(collectFields(document).map((field) => [field.name, field]));
    expect(byName.get("nick")!.label).toBe("Nickname");
    expect(byName.get("town")!.label).toBe("Home town");
    expect(byName.get("colour")!.nearbyText).toBe("Your favourite colour");
  });

  it("drops autocomplete on/off and unknown input types become text", () => {
    const document = parseDocument(`<input name="a" autocomplete="off" type="fancy" />`);
    const [field] = collectFields(document);
    expect(field!.autocomplete).toBeUndefined();
    expect(field!.type).toBe("text");
  });

  it("treats descendants of a disabled fieldset as disabled, except its first legend", () => {
    const document = parseDocument(`
      <fieldset disabled>
        <legend>Billing <input name="in_legend" /></legend>
        <input name="in_fieldset" />
        <div><select name="nested"><option value="a">A</option></select></div>
      </fieldset>
      <fieldset><input name="outside" /></fieldset>
    `);
    const byName = new Map(collectFields(document).map((field) => [field.name, field]));
    expect(byName.get("in_legend")!.editable).toBe(true);
    expect(byName.get("in_fieldset")!.editable).toBe(false);
    expect(byName.get("nested")!.editable).toBe(false);
    expect(byName.get("outside")!.editable).toBe(true);
  });

  it("offers a radio group only when one radio is both visible and editable", () => {
    const document = parseDocument(`
      <input type="radio" name="g" value="x" disabled hidden /><input type="radio" name="g" value="y" />
      <input type="radio" name="h" value="x" disabled /><input type="radio" name="h" value="y" disabled />
      <input type="radio" name="k" value="x" disabled /><input type="radio" name="k" value="y" hidden />
    `);
    const byName = new Map(collectFields(document).map((field) => [field.name, field]));
    expect(byName.get("g")).toMatchObject({ visible: true, editable: true });
    expect(byName.get("h")!.editable).toBe(false);
    // Visible but disabled, and enabled but hidden: no radio can actually take the choice.
    expect(byName.get("k")).toMatchObject({ visible: false, editable: false });
  });

  it("does not mistake a datalist-backed input for a combobox", () => {
    const document = parseDocument(`
      <input name="a" list="opts" role="combobox" /><datalist id="opts"></datalist>
      <input name="b" aria-haspopup="listbox" />
      <input name="c" aria-autocomplete="both" />
    `);
    const byName = new Map(collectFields(document).map((field) => [field.name, field]));
    expect(byName.get("a")!.combobox).toBeUndefined();
    expect(byName.get("b")!.combobox).toBe(true);
    expect(byName.get("c")!.combobox).toBe(true);
  });
});

describe("hasValue and the live state", () => {
  it("counts a radio the user clicked and an option the user picked, but not a select left on its default", () => {
    const page = parseDocument(`
      <label><input type="radio" name="r" value="a" /> A</label>
      <label><input type="radio" name="r" value="b" /> B</label>
      <select id="s"><option value="x">X</option><option value="y">Y</option></select>
      <select id="p"><option value="">Select...</option><option value="y">Y</option></select>
    `);
    const before = collectFields(page);
    expect(before.map((f) => f.hasValue)).toEqual([false, false, false]);
    (page.querySelector('input[value="b"]') as HTMLInputElement).checked = true;
    (page.querySelectorAll("#s option")[1] as HTMLOptionElement).selected = true;
    const after = collectFields(page);
    expect(after.map((f) => f.hasValue)).toEqual([true, true, false]);
    expect(chosenOption(page.getElementById("s")!)?.textContent).toBe("Y");
    expect(chosenOption(page.getElementById("p")!)).toBeUndefined();
  });
});

describe("comboboxDisplayedValue", () => {
  it("reads the choice a react-select widget shows beside its input, and nothing from a fresh one", () => {
    const fields = collectFields(loadFixture("ats-application.html"));
    const byId = new Map(fields.map((f) => [f.id, f]));
    expect(byId.get("question_7")).toMatchObject({ combobox: true, hasValue: true, required: true });
    expect(byId.get("question_6")).toMatchObject({ combobox: true, hasValue: false });
    expect(byId.get("country")!.hasValue).toBe(false);
    const document = loadFixture("ats-application.html");
    expect(comboboxDisplayedValue(document.getElementById("question_7")!)).toBe("No");
    expect(comboboxDisplayedValue(document.getElementById("country")!)).toBeUndefined();
  });

  it("never mistakes the label, the placeholder, the live region, or an inline stylesheet for a choice", () => {
    const page = parseDocument(`
      <div>
        <label for="c">Country</label>
        <span aria-live="polite">option United States selected</span>
        <div class="control">
          <div class="value-container">
            <style data-emotion="css 1jqq78o-placeholder">.css-1jqq78o-placeholder{color:hsl(0, 0%, 50%);}</style>
            <div class="placeholder">Select...</div>
            <input id="c" type="text" role="combobox" aria-autocomplete="list" />
          </div>
          <button aria-label="Toggle">v</button>
        </div>
      </div>
    `);
    expect(comboboxDisplayedValue(page.getElementById("c")!)).toBeUndefined();
  });
});

describe("live state over markup defaults", () => {
  it("follows the user away from a radio or option the page had marked as the default", () => {
    const page = parseDocument(`
      <label><input id="a" type="radio" name="r" value="a" checked /> A</label>
      <label><input id="b" type="radio" name="r" value="b" /> B</label>
      <select id="s"><option value="x">X</option><option value="y" selected>Y</option></select>
    `);
    expect(collectFields(page).map((f) => f.hasValue)).toEqual([true, true]);
    (page.getElementById("a") as HTMLInputElement).checked = false;
    (page.getElementById("b") as HTMLInputElement).checked = true;
    expect(readValues(page, ["#a"])).toEqual([{ ref: "#a", value: "B" }]);
    const options = page.querySelectorAll("#s option") as NodeListOf<HTMLOptionElement>;
    options[1]!.selected = false;
    options[0]!.selected = true;
    // The user moved from the page's default to the first option: that is the choice, never the stale default.
    expect(chosenOption(page.getElementById("s")!)?.textContent).toBe("X");
    expect(readValues(page, ["#s"])).toEqual([{ ref: "#s", value: "X" }]);
    const fresh = parseDocument(`<select id="s"><option value="x">X</option><option value="y">Y</option></select>`);
    expect(chosenOption(fresh.getElementById("s")!)).toBeUndefined();
  });
});

describe("comboboxDisplayedValue decoys", () => {
  it("ignores help, error, and described-by text beside the widget, and text too long to be a choice", () => {
    const page = parseDocument(`
      <div class="control">
        <div class="value-container">
          <input id="c" type="text" role="combobox" aria-autocomplete="list" aria-describedby="c-hint" />
          <span id="c-hint">Pick the country you live in</span>
        </div>
        <p class="field-error">Required</p>
        <p role="alert">Please choose one</p>
      </div>
    `);
    expect(comboboxDisplayedValue(page.getElementById("c")!)).toBeUndefined();
    const long = parseDocument(`<div><input id="c" type="text" role="combobox" aria-autocomplete="list" /><div class="single-value">${"x".repeat(300)}</div></div>`);
    expect(comboboxDisplayedValue(long.getElementById("c")!)).toBeUndefined();
    // Text that does not name itself as a selection is not one, however short.
    const stray = parseDocument(`<div><input id="c" type="text" role="combobox" aria-autocomplete="list" /><span>Required</span></div>`);
    expect(comboboxDisplayedValue(stray.getElementById("c")!)).toBeUndefined();
    const named = parseDocument(`<div><input id="c" type="text" role="combobox" aria-autocomplete="list" /><span class="vs__selected">Canada</span></div>`);
    expect(comboboxDisplayedValue(named.getElementById("c")!)).toBe("Canada");
  });
});
