import { describe, expect, it } from "vitest";
import { loadFixture, parseDocument } from "../fixtures.test-util";
import { collectUploads, uploadLabel } from "./uploads";

describe("collectUploads", () => {
  it("describes the ATS form's buried uploads by the group that names them", () => {
    const uploads = collectUploads(loadFixture("ats-application.html"));
    expect(uploads).toEqual([
      {
        ref: "#resume",
        label: "Resume/CV",
        id: "resume",
        accept: ".pdf,.doc,.docx,.txt,.rtf",
        sectionText: "Staff Software Engineer",
        required: true,
        editable: true,
        hasValue: false,
      },
      {
        ref: "#cover_letter",
        label: "Cover Letter",
        id: "cover_letter",
        accept: ".pdf,.doc,.docx,.txt,.rtf",
        sectionText: "Staff Software Engineer",
        editable: true,
        hasValue: false,
      },
    ]);
  });

  it("carries name, section, required, and multiple", () => {
    const [upload] = collectUploads(loadFixture("job-application.html"));
    expect(upload).toMatchObject({ label: "Resume", name: "resume_file", accept: ".pdf,.docx", sectionText: "Anything else" });
    const document = parseDocument(`<fieldset><legend>Documents</legend><input type="file" name="docs" multiple required /></fieldset>`);
    expect(collectUploads(document)[0]).toMatchObject({ name: "docs", sectionText: "Documents", multiple: true, required: true });
  });

  it("does not take a neighbouring field's label for an upload's", () => {
    const document = parseDocument(`
      <label for="p">Phone</label><input id="p" type="tel" />
      <div><div><label for="f">Attach</label><input id="f" type="file" /></div></div>
      <fieldset><legend>Transcript</legend><div><div><input id="t" type="file" /></div></div></fieldset>
    `);
    const uploads = collectUploads(document);
    expect(uploads[0]).not.toHaveProperty("label");
    expect(uploads[1]).toMatchObject({ id: "t", label: "Transcript" });
  });

  it("leaves the label out when only a generic control label exists", () => {
    const document = parseDocument(`<label for="f">Attach</label><input id="f" type="file" />`);
    expect(collectUploads(document)[0]).not.toHaveProperty("label");
  });

  it("marks disabled uploads, including by fieldset, as not editable", () => {
    const document = parseDocument(`<fieldset disabled><input type="file" id="a" /></fieldset><input type="file" id="b" disabled /><input type="file" id="c" />`);
    expect(collectUploads(document).map((u) => [u.id, u.editable])).toEqual([
      ["a", false],
      ["b", false],
      ["c", true],
    ]);
  });

  it("uploadLabel walks up to the wrapper's previous sibling", () => {
    const document = parseDocument(`
      <div id="lbl">Portfolio (PDF)</div>
      <div><label for="f">Upload</label><input id="f" type="file" /></div>
    `);
    expect(uploadLabel(document.getElementById("f")!, document)).toBe("Portfolio (PDF)");
  });
});
