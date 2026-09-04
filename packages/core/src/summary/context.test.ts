import { describe, expect, it } from "vitest";
import { loadFixture, parseDocument } from "../fixtures.test-util";
import { collectFields } from "../forms/collect";
import { uploadLabel } from "../forms/uploads";
import { eligibleFields } from "../mapping/resolve";
import { collectFormContext, MAX_HEADINGS, MAX_INTRO_CHARS } from "./context";
import { outlineForm } from "./outline";
import { buildSummaryPrompt } from "./prompt";

describe("collectFormContext (ats-application.html)", () => {
  const context = collectFormContext(loadFixture("ats-application.html"));

  it("reads the title, headings, and intro prose", () => {
    expect(context.title).toBe("Job Application for Staff Software Engineer");
    expect(context.headings).toEqual(["Staff Software Engineer"]);
    expect(context.intro).toBe(
      "Apply for the Staff Software Engineer role at Acme. Fields marked with an asterisk are required.\nAccepted file types: pdf, doc, docx, txt, rtf",
    );
  });

  it("lists buttons once each and picks out the submit button", () => {
    expect(context.buttons).toEqual(["Attach", "Enter manually", "Submit application"]);
    expect(context.submit).toBe("Submit application");
  });

  it("names uploads by the prose beside them, not the generic control label", () => {
    expect(context.uploads).toEqual(["Resume/CV", "Cover Letter"]);
  });
});

describe("collectFormContext (other fixtures)", () => {
  it("treats a type-less button inside a form as the submit button", () => {
    const context = collectFormContext(loadFixture("contact-form.html"));
    expect(context.submit).toBe("Continue");
    expect(context.headings).toEqual(["Contact details"]);
    expect(context.uploads).toEqual([]);
  });

  it("has no submit when the only button is type=button outside a form", () => {
    const context = collectFormContext(loadFixture("job-application.html"));
    expect(context.submit).toBeUndefined();
    expect(context.buttons).toEqual(["Submit application"]);
    expect(context.headings).toEqual(["Application form", "About you", "Education", "Work history", "Anything else"]);
  });
});

describe("collectFormContext (budgets and visibility)", () => {
  it("skips hidden headings, paragraphs, and buttons", () => {
    const document = parseDocument(`
      <h1>Shown</h1><h2 hidden>Hidden</h2>
      <p>Visible text.</p><p style="display:none">Secret text.</p>
      <button hidden>Ghost</button><input type="submit" value="Go" />
    `);
    const context = collectFormContext(document);
    expect(context.headings).toEqual(["Shown"]);
    expect(context.intro).toBe("Visible text.");
    expect(context.buttons).toEqual(["Go"]);
    expect(context.submit).toBe("Go");
  });

  it("caps headings and clips the intro to its character budget", () => {
    const headings = Array.from({ length: 12 }, (_, i) => `<h2>Heading ${i}</h2>`).join("");
    const paragraphs = Array.from({ length: 10 }, (_, i) => `<p>${"word ".repeat(60)}${i}</p>`).join("");
    const context = collectFormContext(parseDocument(headings + paragraphs));
    expect(context.headings).toHaveLength(MAX_HEADINGS);
    expect(context.intro.length).toBeLessThanOrEqual(MAX_INTRO_CHARS + 1);
    expect(context.intro.split("\n").length).toBeLessThan(10);
  });

  it("names a file input from its explicit label when that label is specific", () => {
    const document = parseDocument(`<label for="cv">Curriculum vitae</label><input id="cv" type="file" />`);
    expect(collectFormContext(document).uploads).toEqual(["Curriculum vitae"]);
  });

  it("falls back to a generic name and skips disabled file inputs, including by fieldset", () => {
    const document = parseDocument(`
      <div><input type="file" /></div>
      <input type="file" disabled />
      <fieldset disabled><label for="x">Portfolio</label><input id="x" type="file" /></fieldset>
    `);
    expect(collectFormContext(document).uploads).toEqual(["File upload"]);
  });

  it("keeps a specific label that merely starts with a verb", () => {
    const document = parseDocument(`
      <div><label for="a">Upload resume</label><input id="a" type="file" /></div>
      <div><label for="b">Attach your file</label><div>Cover letter</div><input id="b" type="file" /></div>
      <div><label for="c">Choose file</label><input id="c" type="file" /></div>
    `);
    expect(collectFormContext(document).uploads).toEqual(["Upload resume", "Cover letter", "File upload"]);
  });

  it("never takes a neighbouring control, or its wrapper, as the upload's name", () => {
    const document = parseDocument(`
      <div>
        <select><option>Engineering</option></select>
        <button type="button">Browse</button>
        <input id="a" type="file" />
      </div>
      <div><label for="x">Team</label><input id="x" /></div>
      <div><label for="b">Upload</label><input id="b" type="file" /></div>
    `);
    expect(collectFormContext(document).uploads).toEqual(["File upload", "File upload"]);
  });

  it("treats a decorated generic label as generic", () => {
    const document = parseDocument(`<div><span>Transcript *</span><label for="t">Upload*</label><input id="t" type="file" /></div>`);
    expect(collectFormContext(document).uploads).toEqual(["Transcript"]);
  });

  it("uploadLabel walks up to the wrapper's previous sibling", () => {
    const document = parseDocument(`
      <div id="lbl">Portfolio (PDF)</div>
      <div><label for="f">Upload</label><input id="f" type="file" /></div>
    `);
    expect(uploadLabel(document.getElementById("f")!, document)).toBe("Portfolio (PDF)");
  });
});

describe("collectFormContext (blocked uploads)", () => {
  it("names a refused upload by reason only, never by label, and the outline and prompt follow", () => {
    const document = parseDocument(`
      <form>
        <label for="r">Resume</label><input id="r" type="file" />
        <label for="p">Passport scan</label><input id="p" type="file" />
        <label for="b">Bank statement</label><input id="b" type="file" />
        <label for="e">Email</label><input id="e" type="email" />
      </form>
    `);
    const context = collectFormContext(document);
    expect(context.uploads).toEqual(["Resume"]);
    expect(context.blockedUploads).toEqual(["government-id", "bank-account"]);
    const { eligible, blocked } = eligibleFields(collectFields(document));
    const outline = outlineForm(eligible, blocked, context);
    expect(outline.blocked).toEqual(["government-id", "bank-account"]);
    expect(outline.uploads).toEqual(["Resume"]);
    const prompt = buildSummaryPrompt({ context, fields: eligible, blocked: outline.blocked });
    expect(prompt.user).not.toContain("Passport");
    expect(prompt.user).not.toContain("Bank statement");
    expect(prompt.user).toContain("File uploads: Resume");
    expect(prompt.user).toContain("a government ID number, bank account details; this extension never fills those");
  });
});

describe("collectFormContext buttons out of the tab order", () => {
  it("drops widget chrome but keeps a submit button whatever its tabindex", () => {
    const page = parseDocument(`
      <form>
        <div class="select__control"><input type="text" role="combobox" aria-autocomplete="list" /><button type="button" tabindex="-1" aria-label="Toggle flyout">v</button></div>
        <button type="button" tabindex="-1">Add another job</button>
        <button type="submit" tabindex="-1">Submit application</button>
      </form>
    `);
    const context = collectFormContext(page);
    expect(context.buttons).toEqual(["Add another job", "Submit application"]);
    expect(context.submit).toBe("Submit application");
  });
});
