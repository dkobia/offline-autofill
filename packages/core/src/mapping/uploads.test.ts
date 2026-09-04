import { describe, expect, it, vi } from "vitest";
import { loadFixture, parseDocument } from "../fixtures.test-util";
import { collectUploads, type UploadField } from "../forms/uploads";
import { assessUpload, buildUploadPrompt, eligibleUploads, mapUploadsByHeuristics, parseUploadResponse, resolveUploads, type UploadMapper } from "./uploads";

function upload(overrides: Partial<UploadField>): UploadField {
  return { ref: "#u", editable: true, hasValue: false, ...overrides };
}

describe("mapUploadsByHeuristics", () => {
  it("maps the ATS uploads by label", () => {
    const { mapped, unmapped } = mapUploadsByHeuristics(collectUploads(loadFixture("ats-application.html")));
    expect(mapped).toEqual([
      { ref: "#resume", kind: "resume", source: "heuristic", confidence: 0.9 },
      { ref: "#cover_letter", kind: "coverLetter", source: "heuristic", confidence: 0.9 },
    ]);
    expect(unmapped).toEqual([]);
  });

  it("falls back to identifiers, then an image-only accept", () => {
    expect(mapUploadsByHeuristics([upload({ name: "cv_upload" })]).mapped[0]).toMatchObject({ kind: "resume", confidence: 0.8 });
    expect(mapUploadsByHeuristics([upload({ id: "coverLetterFile" })]).mapped[0]).toMatchObject({ kind: "coverLetter", confidence: 0.8 });
    expect(mapUploadsByHeuristics([upload({ accept: "image/png, image/jpeg" })]).mapped[0]).toMatchObject({ kind: "photo", confidence: 0.7 });
    expect(mapUploadsByHeuristics([upload({ accept: ".pdf,image/*" })]).unmapped).toHaveLength(1);
  });

  it("leaves question-shaped labels and unknown ones to the model", () => {
    const { unmapped } = mapUploadsByHeuristics([
      upload({ ref: "#q", label: "Do you have a portfolio you would like to share with us?" }),
      upload({ ref: "#s", label: "Supporting documents" }),
    ]);
    expect(unmapped.map((u) => u.ref)).toEqual(["#q", "#s"]);
  });
});

describe("eligibleUploads", () => {
  it("blocks identity, card, and bank uploads and drops disabled ones", () => {
    const document = parseDocument(`
      <label for="p">Passport scan</label><input id="p" type="file" />
      <label for="c">Card statement</label><input id="c" type="file" name="credit_card_copy" />
      <label for="d">Resume</label><input id="d" type="file" disabled />
      <label for="r">Resume</label><input id="r" type="file" />
    `);
    const { eligible, blocked } = eligibleUploads(collectUploads(document));
    expect(blocked.map((u) => u.id)).toEqual(["p", "c"]);
    expect(eligible.map((u) => u.id)).toEqual(["r"]);
  });
});

describe("resolveUploads", () => {
  it("asks the mapper only about unmapped uploads with something to read, and keeps only answers for them", async () => {
    const uploads = [
      upload({ ref: "#a", label: "Resume/CV" }),
      upload({ ref: "#b", label: "Lebenslauf" }),
      upload({ ref: "#c" }),
      upload({ ref: "#d", label: "Passport" }),
    ];
    const mapper: UploadMapper = {
      name: "fake",
      mapUploads: vi.fn(async () => [
        { ref: "#b", kind: "resume" as const, source: "model" as const, confidence: 0.6 },
        { ref: "#a", kind: "photo" as const, source: "model" as const, confidence: 0.6 },
      ]),
    };
    const result = await resolveUploads(uploads, mapper);
    expect((mapper.mapUploads as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toEqual([uploads[1]]);
    expect(result.mappings.map((m) => [m.ref, m.kind, m.source])).toEqual([
      ["#a", "resume", "heuristic"],
      ["#b", "resume", "model"],
    ]);
    expect(result.unmapped.map((u) => u.ref)).toEqual(["#c"]);
    expect(result.blocked.map((u) => u.ref)).toEqual(["#d"]);
    expect(result.usedModel).toBe(true);
  });

  it("does not consult the mapper when nothing is left", async () => {
    const mapper: UploadMapper = { name: "fake", mapUploads: vi.fn(async () => []) };
    const result = await resolveUploads([upload({ label: "Resume" })], mapper);
    expect(mapper.mapUploads).not.toHaveBeenCalled();
    expect(result.usedModel).toBe(false);
  });
});

describe("buildUploadPrompt", () => {
  it("lists kinds and uploads and never a document", () => {
    const prompt = buildUploadPrompt([upload({ ref: "#x", label: "Lebenslauf", name: "cv", accept: ".pdf", sectionText: "Unterlagen" })]);
    expect(prompt.user).toContain("- resume: Resume or curriculum vitae");
    expect(prompt.user).not.toContain("- other:");
    expect(prompt.user).toContain('{"id":"u1","label":"Lebenslauf","name":"cv","accept":".pdf","section":"Unterlagen"}');
    expect(prompt.user).not.toContain("#x");
    expect(prompt.ids.get("u1")).toBe("#x");
    const items = (prompt.schema as { properties: { mappings: { items: { properties: { upload: { enum: string[] }; kind: { anyOf: { enum?: string[] }[] } } } } } }).properties.mappings.items;
    expect(items.properties.upload.enum).toEqual(["u1"]);
    expect(items.properties.kind.anyOf[0]!.enum).not.toContain("other");
  });
});

describe("parseUploadResponse", () => {
  const ids = new Map([
    ["u1", "#a"],
    ["u2", "#b"],
  ]);

  it("reads fenced JSON and drops nulls, unknown ids, unplannable kinds, and repeats", () => {
    const text = '```json\n{"mappings":[{"upload":"u1","kind":"resume"},{"upload":"u1","kind":"photo"},{"upload":"u2","kind":null},{"upload":"u9","kind":"resume"},{"upload":"u2","kind":"other"}]}\n```';
    expect(parseUploadResponse(text, ids)).toEqual([{ ref: "#a", kind: "resume", source: "model", confidence: 0.6 }]);
  });

  it("returns nothing for prose", () => {
    expect(parseUploadResponse("I cannot help with that.", ids)).toEqual([]);
  });
});

describe("sensitive documents", () => {
  it.each([
    ["Government-issued ID", "government-id"],
    ["Upload a photo of your ID card", "government-id"],
    ["Proof of identity", "government-id"],
    ["Proof of address", "government-id"],
    ["Passport scan", "government-id"],
    ["Birth certificate", "government-id"],
    ["Payment card copy", "payment-card"],
    ["Card scan (front)", "payment-card"],
    ["Card statement", "payment-card"],
    ["Bank statement", "bank-account"],
    ["Voided check", "bank-account"],
    ["Pay stubs (last 3)", "bank-account"],
  ])("blocks %s as %s", (label, reason) => {
    expect(assessUpload(upload({ label }))).toEqual({ blocked: true, reason });
  });

  it("blocks an innocuous label under an identity heading, and never maps a blocked upload", () => {
    const photo = upload({ label: "Photo", accept: "image/*", sectionText: "Identity verification" });
    expect(assessUpload(photo)).toEqual({ blocked: true, reason: "government-id" });
    expect(
      eligibleUploads([photo, upload({ ref: "#id", label: "Government-issued ID", accept: "image/*" }), upload({ ref: "#card", label: "Card scan", accept: "image/*" })])
        .eligible,
    ).toEqual([]);
  });

  it("does not block ordinary documents", () => {
    for (const label of ["Resume/CV", "Professional certifications", "Headshot", "Portfolio"]) {
      expect(assessUpload(upload({ label })).blocked).toBe(false);
    }
  });
});

describe("question-shaped uploads", () => {
  it("go to the model whatever their identifiers or accept say", () => {
    const { mapped, unmapped } = mapUploadsByHeuristics([
      upload({ ref: "#q", label: "Do you have a resume you would like to share with us?", name: "resume", accept: "image/*" }),
    ]);
    expect(mapped).toEqual([]);
    expect(unmapped.map((u) => u.ref)).toEqual(["#q"]);
  });

  it("an upload with only a section heading is still worth asking about", async () => {
    const mapper: UploadMapper = { name: "fake", mapUploads: vi.fn(async () => []) };
    await resolveUploads([upload({ ref: "#s", sectionText: "Unterlagen" })], mapper);
    expect(mapper.mapUploads).toHaveBeenCalledOnce();
  });
});
