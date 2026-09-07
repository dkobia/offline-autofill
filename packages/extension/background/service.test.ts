// Drives the background through a fake Platform whose "tab" is a linkedom
// fixture running the real content-side core calls. End to end without a
// browser: scan -> plan -> fill.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAssignments,
  buildSummaryPrompt,
  collectFields,
  collectFormContext,
  collectUploads,
  collectAnswers,
  type AnswerCandidate,
  type CollectedField,
  type FieldMapping,
  type FormSummary,
  type StoredDocument,
  type SummaryInput,
  type UploadField,
  type UploadMapping,
  type WriteRequest,
} from "@offline-autofill/core";
import type {
  AddDocumentResponse,
  ContentRequest,
  DescribeResponse,
  FillResponse,
  GetProfileResponse,
  ListDocumentsResponse,
  ReadAnswersResponse,
  SaveAnswersResponse,
  ScanResponse,
  Settings,
} from "@offline-autofill/shared";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import type { MessageHandler, Platform } from "../platform/types";
import { EngineError, type EngineClient } from "./engines";
import { splitRef } from "./frame-refs";
import { startBackground } from "./service";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures");

/** A fixture file name, or literal HTML for one-off pages. */
function loadFixture(source: string): Document {
  const html = source.startsWith("<") ? source : readFileSync(join(fixturesDir, source), "utf8");
  return parseHTML(html).document as unknown as Document;
}

interface Harness {
  send(message: unknown): Promise<unknown>;
  storage: Map<string, unknown>;
  document: Document;
  engine: EngineClient;
  /** Every write request the tab received, in order. */
  writes: WriteRequest[];
  /** How many times the tab was asked for the user's answers. */
  reads: { count: number };
  /** Storage keys whose writes or removals fail from now on. */
  failWrites: Set<string>;
  failRemoves: Set<string>;
  /** The fake platform, for tests that swap one method. */
  platform: Platform;
  /** The documents of the tab's subframes, by frame id. */
  frames: Map<number, Document>;
}

interface HarnessOptions {
  createEngine?: (settings: Settings) => EngineClient;
  summaryTimeoutMs?: number;
  /** Storage keys whose writes fail, to exercise rollback. */
  failWrites?: Set<string>;
  /** Fixtures for the tab's subframes, by frame id; the top frame (0) is `fixture`. */
  frames?: Record<number, string>;
  /** Frames the browser lists but that never answer (no content script, no access). */
  deadFrames?: number[];
}

function harness(fixture: string, engine?: Partial<EngineClient>, options: HarnessOptions = {}): Harness {
  const storage = new Map<string, unknown>();
  const document = loadFixture(fixture);
  const writes: WriteRequest[] = [];
  const reads = { count: 0 };
  const failWrites = options.failWrites ?? new Set<string>();
  const failRemoves = new Set<string>();
  const frames = new Map<number, Document>(Object.entries(options.frames ?? {}).map(([id, source]) => [Number(id), loadFixture(source)]));
  const deadFrames = new Set(options.deadFrames ?? []);
  let handler: MessageHandler | undefined;
  const platform: Platform = {
    name: "chrome",
    getSetting: async (key, fallback) => (storage.has(key) ? (storage.get(key) as never) : fallback),
    setSetting: async (key, value) => {
      if (failWrites.has(key)) {
        throw new Error("quota exceeded");
      }
      storage.set(key, value);
    },
    removeSetting: async (key) => {
      if (failRemoves.has(key)) {
        throw new Error("storage busy");
      }
      storage.delete(key);
    },
    sendMessage: async () => undefined,
    sendTabMessage: async (_tabId, message, frameId) => {
      const target = frameId === 0 ? document : frames.get(frameId);
      if (!target || deadFrames.has(frameId)) {
        throw new Error("Could not establish connection. Receiving end does not exist.");
      }
      const request = message as ContentRequest;
      switch (request.type) {
        case "collect-fields":
          return { fields: collectFields(target), uploads: collectUploads(target) };
        case "describe-form":
          return { fields: collectFields(target), context: collectFormContext(target) };
        case "apply-fill":
          writes.push(...request.requests);
          return { outcome: await applyAssignments(target, request.requests) };
        case "collect-answers":
          reads.count += 1;
          return collectAnswers(target);
        default:
          return undefined;
      }
    },
    onMessage: (h) => void (handler = h),
    getActiveTab: async () => ({ id: 7, complete: true }),
    listFrames: async () => [0, ...new Set([...frames.keys(), ...deadFrames])].sort((a, b) => a - b),
    injectContentScript: async () => undefined,
    initPanelBehavior: () => undefined,
  };
  const client: EngineClient = {
    name: "fake",
    probe: vi.fn(async () => ({ state: "ok" as const, models: ["m"] })),
    mapFields: vi.fn(async () => [] as FieldMapping[]),
    mapUploads: vi.fn(async () => [] as UploadMapping[]),
    summarizeForm: vi.fn(async () => undefined as FormSummary | undefined),
    ...engine,
  };
  const deps: Parameters<typeof startBackground>[0] = { platform, createEngine: options.createEngine ?? (() => client) };
  if (options.summaryTimeoutMs !== undefined) {
    deps.summaryTimeoutMs = options.summaryTimeoutMs;
  }
  startBackground(deps);
  return {
    send: (message) => handler!(message, undefined) ?? Promise.resolve(undefined),
    storage,
    document,
    engine: client,
    writes,
    reads,
    failWrites,
    failRemoves,
    platform,
    frames,
  };
}

const cv = { kind: "resume" as const, description: "Tailored", fileName: "cv.pdf", mimeType: "application/pdf", data: btoa("%PDF-1.4 fake") };

/** What a browser gives a file input; linkedom has neither DataTransfer nor a files property. */
class FakeDataTransfer {
  files: File[] = [];
  items = { add: (file: File) => void this.files.push(file) };
}

async function withDataTransfer<T>(run: () => Promise<T>): Promise<T> {
  const world = globalThis as { DataTransfer?: unknown };
  world.DataTransfer = FakeDataTransfer;
  try {
    return await run();
  } finally {
    delete world.DataTransfer;
  }
}

const profile = {
  identity: { firstName: "Ada", lastName: "Lovelace" },
  contact: { email: "ada@example.com" },
  address: [{ line1: "12 St James's Square", city: "London", region: "CA", country: "United Kingdom" }],
};

const settings: Settings = { engine: "ollama", endpoint: "http://localhost:11434", model: "m", useModel: true, overwrite: false, summary: true };

const summary: FormSummary = { purpose: "A job application.", howTo: ["Fill in the sections"], notes: [] };

describe("background service", () => {
  it("normalizes settings and profile on save and load", async () => {
    const h = harness("contact-form.html");
    const saved = (await h.send({ type: "save-settings", settings: { engine: "lmstudio", endpoint: "https://evil" } })) as {
      settings: Settings;
    };
    expect(saved.settings.endpoint).toBe("http://localhost:1234");
    const loaded = (await h.send({ type: "get-settings" })) as { settings: Settings };
    expect(loaded.settings).toEqual(saved.settings);

    await h.send({ type: "save-profile", profile: { identity: { firstName: " Ada ", bogus: "x" } } });
    const { profile: stored } = (await h.send({ type: "get-profile" })) as GetProfileResponse;
    expect(stored.identity).toEqual({ firstName: "Ada" });
  });

  it("refuses to scan with an empty profile", async () => {
    const h = harness("contact-form.html");
    const result = (await h.send({ type: "scan-page" })) as ScanResponse;
    expect(result).toMatchObject({ ok: false, error: "profile-empty" });
  });

  it("scans, plans, and fills without consulting the model when nothing is left over", async () => {
    const h = harness("contact-form.html");
    await h.send({ type: "save-profile", profile });
    await h.send({ type: "save-settings", settings });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);

    expect(scan.usedModel).toBe(true); // leftovers (radio group, checkbox) were offered
    expect(h.engine.mapFields).toHaveBeenCalledOnce();
    const offered = (h.engine.mapFields as ReturnType<typeof vi.fn>).mock.calls[0]![0] as CollectedField[];
    expect(offered.map((f) => f.name)).toEqual(["method", "newsletter"]);

    const values = new Map(scan.plan.assignments.map((a) => [a.ref, a.value]));
    expect(values.get("#given")).toBe("Ada");
    expect(values.get("#state")).toBe("CA");
    expect(values.get("#country")).toBe("GB");
    expect(scan.blockedCount).toBe(0);

    const fill = (await h.send({
      type: "fill-page",
      tabId: scan.tabId,
      requests: scan.plan.assignments.map((a) => ({ ref: a.ref, value: a.value })),
    })) as FillResponse;
    expect(fill.outcome.failed).toEqual([]);
    expect((h.document.getElementById("given") as HTMLInputElement).value).toBe("Ada");
    expect((h.document.getElementById("country") as HTMLSelectElement).value).toBe("GB");
  });

  it("falls back to heuristics and reports the model error when the engine fails", async () => {
    const h = harness("job-application.html", {
      mapFields: vi.fn(async () => {
        throw new EngineError("origin-forbidden", "403");
      }),
    });
    await h.send({ type: "save-profile", profile });
    await h.send({ type: "save-settings", settings });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);
    expect(scan.modelError).toEqual({ code: "origin-forbidden", message: "403" });
    expect(scan.usedModel).toBe(false);
    expect(scan.plan.assignments.some((a) => a.key === "identity.firstName")).toBe(true);
    expect(scan.unmapped.map((u) => u.label)).toEqual(["Preferred pronouns", "Why do you want to work here?"]);
  });

  it("skips the model entirely when the setting is off or no model is configured", async () => {
    const h = harness("job-application.html");
    await h.send({ type: "save-profile", profile });
    await h.send({ type: "save-settings", settings: { ...settings, useModel: false } });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    expect(scan.ok && scan.usedModel).toBe(false);
    expect(h.engine.mapFields).not.toHaveBeenCalled();
  });

  it("never plans blocked or hidden fields", async () => {
    const h = harness("hidden-fields.html");
    await h.send({ type: "save-profile", profile });
    await h.send({ type: "save-settings", settings });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);
    expect(scan.blockedCount).toBe(3);
    expect(scan.plan.assignments.map((a) => a.ref)).toEqual(["#user"]);
  });

  it("describes a page by rules alone, without a profile, when the model is off", async () => {
    const h = harness("job-application.html");
    await h.send({ type: "save-settings", settings: { ...settings, useModel: false } });
    const result = (await h.send({ type: "describe-page" })) as DescribeResponse;
    if (!result.ok) throw new Error(result.message);
    expect(result.usedModel).toBe(false);
    expect(result.summary).toBeUndefined();
    expect(result.outline.sections).toEqual(["About you", "Education", "Work history", "Anything else"]);
    expect(result.outline.submit).toBe("Submit application");
    expect(h.engine.summarizeForm).not.toHaveBeenCalled();
  });

  it("adds the model's description and serves a repeat from the cache", async () => {
    const h = harness("job-application.html", { summarizeForm: vi.fn(async () => summary) });
    await h.send({ type: "save-settings", settings });
    const first = (await h.send({ type: "describe-page" })) as DescribeResponse;
    expect(first).toMatchObject({ ok: true, usedModel: true, summary });
    const second = (await h.send({ type: "describe-page" })) as DescribeResponse;
    expect(second).toMatchObject({ ok: true, usedModel: true, summary });
    expect(h.engine.summarizeForm).toHaveBeenCalledOnce();

    // A different model is a different answer.
    await h.send({ type: "save-settings", settings: { ...settings, model: "other" } });
    await h.send({ type: "describe-page" });
    expect(h.engine.summarizeForm).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight model call between concurrent identical requests", async () => {
    let release!: (value: FormSummary) => void;
    const h = harness("job-application.html", {
      summarizeForm: vi.fn(() => new Promise<FormSummary | undefined>((resolve) => void (release = resolve))),
    });
    await h.send({ type: "save-settings", settings });
    const first = h.send({ type: "describe-page" });
    const second = h.send({ type: "describe-page" });
    await vi.waitFor(() => expect(h.engine.summarizeForm).toHaveBeenCalled());
    release(summary);
    const results = (await Promise.all([first, second])) as DescribeResponse[];
    expect(results.every((r) => r.ok && r.summary === summary)).toBe(true);
    expect(h.engine.summarizeForm).toHaveBeenCalledOnce();
  });

  it("keeps the outline when the engine cannot even be created", async () => {
    const h = harness("job-application.html", undefined, {
      createEngine: () => {
        throw new EngineError("engine-error", "Endpoint is not local: https://evil");
      },
    });
    await h.send({ type: "save-settings", settings });
    const result = (await h.send({ type: "describe-page" })) as DescribeResponse;
    expect(result).toMatchObject({ ok: true, usedModel: false, modelError: { code: "engine-error", message: "Endpoint is not local: https://evil" } });
    if (result.ok) expect(result.outline.fieldCount).toBeGreaterThan(0);
  });

  it("reports a timeout the same way to the caller that started the call and to one that joined it", async () => {
    const h = harness(
      "job-application.html",
      {
        summarizeForm: vi.fn(
          (_input, signal?: AbortSignal) =>
            new Promise<FormSummary | undefined>((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason))),
        ),
      },
      { summaryTimeoutMs: 300 },
    );
    await h.send({ type: "save-settings", settings });
    const first = h.send({ type: "describe-page" });
    await vi.waitFor(() => expect(h.engine.summarizeForm).toHaveBeenCalled(), { interval: 5 });
    const second = h.send({ type: "describe-page" });
    const results = (await Promise.all([first, second])) as DescribeResponse[];
    for (const result of results) {
      expect(result).toMatchObject({ ok: true, usedModel: false, modelError: { code: "engine-error", message: "The model took too long to answer." } });
    }
    expect(h.engine.summarizeForm).toHaveBeenCalledOnce();
  });

  it("never consults the model when the summary is switched off", async () => {
    const h = harness("job-application.html", { summarizeForm: vi.fn(async () => summary) });
    await h.send({ type: "save-settings", settings: { ...settings, summary: false } });
    const result = (await h.send({ type: "describe-page" })) as DescribeResponse;
    expect(result).toMatchObject({ ok: true, usedModel: false });
    if (result.ok) expect(result.summary).toBeUndefined();
    expect(h.engine.summarizeForm).not.toHaveBeenCalled();
  });

  it("hands the model eligible fields and blocked kinds, never the blocked fields", async () => {
    const h = harness("hidden-fields.html", { summarizeForm: vi.fn(async () => summary) });
    await h.send({ type: "save-settings", settings });
    const result = (await h.send({ type: "describe-page" })) as DescribeResponse;
    if (!result.ok) throw new Error(result.message);
    expect(result.outline.blocked).toEqual(["password", "payment-card", "government-id"]);
    const input = (h.engine.summarizeForm as ReturnType<typeof vi.fn>).mock.calls[0]![0] as SummaryInput;
    expect(input.fields.map((f) => f.name)).toEqual(["user", "city"]);
    expect(input.blocked).toEqual(["password", "payment-card", "government-id"]);
    expect(input.context.title).toBe("Sign in");
  });

  it("keeps the outline and reports the model error when the engine fails or answers nothing", async () => {
    const failing = harness("job-application.html", {
      summarizeForm: vi.fn(async () => {
        throw new EngineError("model-missing", "no such model");
      }),
    });
    await failing.send({ type: "save-settings", settings });
    const failed = (await failing.send({ type: "describe-page" })) as DescribeResponse;
    expect(failed).toMatchObject({ ok: true, usedModel: false, modelError: { code: "model-missing", message: "no such model" } });
    if (failed.ok) expect(failed.outline.fieldCount).toBeGreaterThan(0);

    const silent = harness("job-application.html");
    await silent.send({ type: "save-settings", settings });
    const empty = (await silent.send({ type: "describe-page" })) as DescribeResponse;
    expect(empty).toMatchObject({ ok: true, usedModel: true });
    if (empty.ok) expect(empty.summary).toBeUndefined();
  });

  it("refuses pages without fields", async () => {
    const h = harness("<html><head><title>Blank</title></head><body><p>Nothing here.</p></body></html>");
    const result = (await h.send({ type: "describe-page" })) as DescribeResponse;
    expect(result).toMatchObject({ ok: false, error: "no-fields" });
  });
});

describe("documents", () => {
  it("stores a document's bytes under their own key and lists metadata only", async () => {
    const h = harness("contact-form.html");
    const added = (await h.send({ type: "add-document", document: cv })) as AddDocumentResponse;
    if (!added.ok) throw new Error(added.message);
    const [stored] = added.documents;
    expect(stored).toMatchObject({ kind: "resume", description: "Tailored", fileName: "cv.pdf", mimeType: "application/pdf", size: 13 });
    expect(typeof stored!.id).toBe("string");
    expect(Date.parse(stored!.addedAt)).not.toBeNaN();
    expect(h.storage.get(`document:${stored!.id}`)).toBe(cv.data);
    expect(JSON.stringify(h.storage.get("documents"))).not.toContain(cv.data);
    const listed = (await h.send({ type: "list-documents" })) as ListDocumentsResponse;
    expect(listed.documents).toEqual(added.documents);
  });

  it("refuses empty and oversized files, and rolls back when storage fails", async () => {
    const h = harness("contact-form.html");
    expect(await h.send({ type: "add-document", document: { ...cv, data: "" } })).toMatchObject({ ok: false, error: "empty" });
    expect(await h.send({ type: "add-document", document: { ...cv, data: "A".repeat(14 * 1024 * 1024) } })).toMatchObject({ ok: false, error: "too-large" });
    const failing = harness("contact-form.html", undefined, { failWrites: new Set(["documents"]) });
    const result = (await failing.send({ type: "add-document", document: cv })) as AddDocumentResponse;
    expect(result).toMatchObject({ ok: false, error: "storage" });
    expect([...failing.storage.keys()].filter((key) => key.startsWith("document:"))).toEqual([]);
  });

  it("updates kind and description, and removes bytes with the entry", async () => {
    const h = harness("contact-form.html");
    const added = (await h.send({ type: "add-document", document: cv })) as AddDocumentResponse;
    if (!added.ok) throw new Error(added.message);
    const id = added.documents[0]!.id;
    const updated = (await h.send({ type: "update-document", id, kind: "coverLetter", description: " for Acme " })) as ListDocumentsResponse;
    expect(updated.documents[0]).toMatchObject({ id, kind: "coverLetter", description: "for Acme" });
    const removed = (await h.send({ type: "remove-document", id })) as ListDocumentsResponse;
    expect(removed.documents).toEqual([]);
    expect(h.storage.has(`document:${id}`)).toBe(false);
  });

  it("scans with an empty profile once a document exists, plans the attachment, and attaches it on fill", async () => {
    const h = harness("ats-application.html");
    await h.send({ type: "save-settings", settings: { ...settings, useModel: false } });
    await h.send({ type: "add-document", document: cv });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);
    expect(scan.plan.assignments).toEqual([]);
    expect(scan.plan.attachments).toHaveLength(1);
    expect(scan.plan.attachments[0]).toMatchObject({ ref: "#resume", kind: "resume", fileName: "cv.pdf", label: "Resume/CV", source: "heuristic" });
    // The profile is empty, so every mapped field is skipped "no-value"; the upload skip is the one of interest.
    expect(scan.plan.skipped.filter((s) => s.key.startsWith("document."))).toEqual([
      { ref: "#cover_letter", key: "document.coverLetter", reason: "no-document", label: "Cover Letter" },
    ]);
    expect(scan.uploadCount).toBe(2);
    expect(scan.unmapped.map((u) => u.label)).not.toContain("Resume/CV");

    const fill = (await withDataTransfer(() =>
      h.send({
        type: "fill-page",
        tabId: scan.tabId,
        requests: [
          { ref: "#resume", documentId: scan.plan.attachments[0]!.documentId },
          { ref: "#cover_letter", documentId: "gone" },
        ],
      }),
    )) as FillResponse;
    expect(fill.outcome).toEqual({ filled: ["#resume"], failed: [{ ref: "#cover_letter", reason: "unresolvable" }] });
    expect(h.writes).toEqual([{ ref: "#resume", file: { name: "cv.pdf", type: "application/pdf", data: cv.data } }]);
    expect((h.document.getElementById("resume") as HTMLInputElement).files![0]!.name).toBe("cv.pdf");
  });

  it("asks the model only about uploads the rules could not place, and counts the answer", async () => {
    const h = harness(
      `<form><label for="t">Email</label><input id="t" name="email" /><label for="a">Resume</label><input id="a" type="file" /><label for="b">Lebenslauf</label><input id="b" type="file" /><label for="c">Passport</label><input id="c" type="file" /></form>`,
      {
        mapUploads: vi.fn(async () => [{ ref: "#b", kind: "resume" as const, source: "model" as const, confidence: 0.6 }]),
      },
    );
    await h.send({ type: "save-settings", settings });
    await h.send({ type: "save-profile", profile });
    await h.send({ type: "add-document", document: cv });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);
    const asked = (h.engine.mapUploads as ReturnType<typeof vi.fn>).mock.calls[0]![0] as UploadField[];
    expect(asked.map((u) => u.ref)).toEqual(["#b"]);
    expect(scan.plan.attachments.map((a) => [a.ref, a.source])).toEqual([
      ["#a", "heuristic"],
      ["#b", "model"],
    ]);
    expect(scan.blockedCount).toBe(1);
    expect(scan.usedModel).toBe(true);
  });

  it("keeps the rules' attachments when the model fails on uploads", async () => {
    const h = harness(`<form><label for="a">Resume</label><input id="a" type="file" /><label for="b">Lebenslauf</label><input id="b" type="file" /><input name="email" /></form>`, {
      mapUploads: vi.fn(async () => {
        throw new EngineError("engine-error", "boom");
      }),
    });
    await h.send({ type: "save-settings", settings });
    await h.send({ type: "add-document", document: cv });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);
    expect(scan.plan.attachments.map((a) => a.ref)).toEqual(["#a"]);
    expect(scan.modelError).toEqual({ code: "engine-error", message: "boom" });
    expect(scan.unmapped.map((u) => u.label)).toContain("Lebenslauf");
  });
});

describe("documents (robustness)", () => {
  it("serializes overlapping edits so neither is lost", async () => {
    const h = harness("contact-form.html");
    const a = (await h.send({ type: "add-document", document: cv })) as AddDocumentResponse;
    const b = (await h.send({ type: "add-document", document: { ...cv, fileName: "letter.pdf", kind: "coverLetter" } })) as AddDocumentResponse;
    if (!a.ok || !b.ok) throw new Error("add failed");
    const [first, second] = b.documents;
    const [r1, r2] = (await Promise.all([
      h.send({ type: "update-document", id: first!.id, kind: "resume", description: "one" }),
      h.send({ type: "update-document", id: second!.id, kind: "coverLetter", description: "two" }),
    ])) as ListDocumentsResponse[];
    expect(r1?.error).toBeUndefined();
    expect(r2?.error).toBeUndefined();
    const { documents } = (await h.send({ type: "list-documents" })) as ListDocumentsResponse;
    expect(documents.map((d) => d.description)).toEqual(["one", "two"]);
  });

  it("reports a failed edit and keeps the stored state", async () => {
    const h = harness("contact-form.html");
    const added = (await h.send({ type: "add-document", document: cv })) as AddDocumentResponse;
    if (!added.ok) throw new Error(added.message);
    h.failWrites.add("documents");
    const result = (await h.send({ type: "update-document", id: added.documents[0]!.id, kind: "other", description: "x" })) as ListDocumentsResponse;
    expect(result.error).toContain("Couldn’t save");
    expect(result.documents[0]).toMatchObject({ kind: "resume", description: "Tailored" });
  });

  it("puts the entry back when the bytes cannot be removed, so nothing is orphaned", async () => {
    const h = harness("contact-form.html");
    const added = (await h.send({ type: "add-document", document: cv })) as AddDocumentResponse;
    if (!added.ok) throw new Error(added.message);
    const id = added.documents[0]!.id;
    h.failRemoves.add(`document:${id}`);
    const result = (await h.send({ type: "remove-document", id })) as ListDocumentsResponse;
    expect(result.error).toContain("Couldn’t remove");
    expect(result.documents.map((d) => d.id)).toEqual([id]);
    expect(h.storage.has(`document:${id}`)).toBe(true);
    expect((h.storage.get("documents") as StoredDocument[]).map((d) => d.id)).toEqual([id]);
  });

  it("describes a form that is uploads alone, naming a refused one by kind only", async () => {
    const h = harness(`<form><label for="r">Resume</label><input id="r" type="file" /><label for="p">Passport scan</label><input id="p" type="file" /></form>`, {
      summarizeForm: vi.fn(async () => summary),
    });
    await h.send({ type: "save-settings", settings });
    const result = (await h.send({ type: "describe-page" })) as DescribeResponse;
    if (!result.ok) throw new Error(result.message);
    expect(result.outline.uploads).toEqual(["Resume"]);
    expect(result.outline.blocked).toEqual(["government-id"]);
    const input = (h.engine.summarizeForm as ReturnType<typeof vi.fn>).mock.calls[0]![0] as SummaryInput;
    expect(JSON.stringify(input)).not.toContain("Passport");
  });
});

describe("documents (round 2)", () => {
  it("drops the upload labels of an older content script rather than trusting them", async () => {
    const h = harness("contact-form.html", { summarizeForm: vi.fn(async () => summary) });
    // The old collector: every label in uploads, no blockedUploads at all.
    const legacy = { title: "Onboarding", headings: [], intro: "", buttons: [], uploads: ["Resume", "Passport scan"] };
    const original = h.platform.sendTabMessage;
    h.platform.sendTabMessage = async (tabId, message, frameId) =>
      (message as ContentRequest).type === "describe-form" ? { fields: collectFields(h.document), context: legacy } : original(tabId, message, frameId);
    await h.send({ type: "save-settings", settings });
    const result = (await h.send({ type: "describe-page" })) as DescribeResponse;
    if (!result.ok) throw new Error(result.message);
    expect(result.outline.uploads).toEqual([]);
    expect(result.outline.blocked).toEqual([]);
    const input = (h.engine.summarizeForm as ReturnType<typeof vi.fn>).mock.calls[0]![0] as SummaryInput;
    expect(JSON.stringify(input)).not.toContain("Passport");
    expect(JSON.stringify(input)).not.toContain("Resume");
  });

  it("remembers bytes a double failure left behind and deletes them on the next operation", async () => {
    const h = harness("contact-form.html");
    const added = (await h.send({ type: "add-document", document: cv })) as AddDocumentResponse;
    if (!added.ok) throw new Error(added.message);
    const id = added.documents[0]!.id;
    h.failRemoves.add(`document:${id}`);
    let writes = 0;
    const platformSet = h.platform.setSetting;
    h.platform.setSetting = async (key, value) => {
      if (key === "documents" && ++writes === 2) throw new Error("disk full");
      return platformSet(key, value);
    };
    const result = (await h.send({ type: "remove-document", id })) as ListDocumentsResponse;
    expect(result.documents).toEqual([]);
    expect(h.storage.get("document-orphans")).toEqual([id]);
    expect(h.storage.has(`document:${id}`)).toBe(true);
    // Storage recovers; the next operation of any kind cleans up.
    h.failRemoves.clear();
    await h.send({ type: "list-documents" });
    expect(h.storage.has(`document:${id}`)).toBe(false);
    expect(h.storage.get("document-orphans")).toEqual([]);
  });

  it("writes nothing when even the intent cannot be recorded, and keeps every trace when every later write fails", async () => {
    const h = harness("contact-form.html", undefined, { failWrites: new Set(["document-orphans"]) });
    expect(await h.send({ type: "add-document", document: cv })).toMatchObject({ ok: false, error: "storage" });
    expect([...h.storage.keys()]).toEqual([]);

    // The intent lands, then storage dies entirely: bytes may or may not be there, and the intent says so.
    const dying = harness("contact-form.html");
    const platformSet = dying.platform.setSetting;
    dying.platform.setSetting = async (key, value) => {
      if (key !== "document-orphans") throw new Error("storage gone");
      return platformSet(key, value);
    };
    dying.platform.removeSetting = async () => {
      throw new Error("storage gone");
    };
    expect(await dying.send({ type: "add-document", document: cv })).toMatchObject({ ok: false, error: "storage" });
    expect(dying.storage.get("document-orphans")).toHaveLength(1);
  });

  it("keeps a completed add or removal when clearing the intent fails afterwards", async () => {
    const h = harness("contact-form.html");
    // The orphan list becomes unreadable after the add's own reads are done.
    let reads = 0;
    const platformGet = h.platform.getSetting;
    h.platform.getSetting = async (key, fallback) => {
      if (key === "document-orphans" && ++reads === 3) throw new Error("read failed");
      return platformGet(key, fallback);
    };
    const added = (await h.send({ type: "add-document", document: cv })) as AddDocumentResponse;
    if (!added.ok) throw new Error(added.message);
    const id = added.documents[0]!.id;
    expect(h.storage.has(`document:${id}`)).toBe(true);
    expect((h.storage.get("documents") as StoredDocument[]).map((d) => d.id)).toEqual([id]);
    // The stale intent is cleared by the next operation, bytes untouched.
    h.platform.getSetting = platformGet;
    await h.send({ type: "list-documents" });
    expect(h.storage.get("document-orphans")).toEqual([]);
    expect(h.storage.has(`document:${id}`)).toBe(true);

    // The same for removal: read 3 of the orphan list is clearIntent's.
    reads = 0;
    h.platform.getSetting = async (key, fallback) => {
      if (key === "document-orphans" && ++reads === 3) throw new Error("read failed");
      return platformGet(key, fallback);
    };
    const removed = (await h.send({ type: "remove-document", id })) as ListDocumentsResponse;
    expect(removed.error).toBeUndefined();
    expect(removed.documents).toEqual([]);
    expect(h.storage.has(`document:${id}`)).toBe(false);
    expect(h.storage.get("documents")).toEqual([]);
  });

  it("never deletes an indexed document's bytes during a sweep, and clears the stale intent", async () => {
    const h = harness("contact-form.html");
    const added = (await h.send({ type: "add-document", document: cv })) as AddDocumentResponse;
    if (!added.ok) throw new Error(added.message);
    const id = added.documents[0]!.id;
    // As if the worker had died after the index write and before the intent was cleared.
    h.storage.set("document-orphans", [id]);
    const listed = (await h.send({ type: "list-documents" })) as ListDocumentsResponse;
    expect(listed.documents.map((d) => d.id)).toEqual([id]);
    expect(h.storage.has(`document:${id}`)).toBe(true);
    expect(h.storage.get("document-orphans")).toEqual([]);
  });

  it("still describes an upload-only form answered by an older content script, saying nothing about its uploads", async () => {
    const h = harness("contact-form.html");
    const legacy = { title: "Documents", headings: [], intro: "", buttons: [], uploads: ["Resume"] };
    const original = h.platform.sendTabMessage;
    h.platform.sendTabMessage = async (tabId, message, frameId) =>
      (message as ContentRequest).type === "describe-form" ? { fields: [], context: legacy } : original(tabId, message, frameId);
    await h.send({ type: "save-settings", settings: { ...settings, useModel: false } });
    const result = (await h.send({ type: "describe-page" })) as DescribeResponse;
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.outline.uploads).toEqual([]);
  });

  it("answers with what storage holds when a removal's rollback fails too", async () => {
    const h = harness("contact-form.html");
    const added = (await h.send({ type: "add-document", document: cv })) as AddDocumentResponse;
    if (!added.ok) throw new Error(added.message);
    const id = added.documents[0]!.id;
    h.failRemoves.add(`document:${id}`);
    // The index write that removes the entry succeeds; the restoring write does not.
    let writes = 0;
    const platformSet = h.platform.setSetting;
    h.platform.setSetting = async (key, value) => {
      if (key === "documents" && ++writes === 2) throw new Error("disk full");
      return platformSet(key, value);
    };
    const result = (await h.send({ type: "remove-document", id })) as ListDocumentsResponse;
    expect(result.error).toContain("Couldn’t remove");
    expect(result.documents).toEqual([]);
    expect(h.storage.has(`document:${id}`)).toBe(true);
  });

  it("remembers a failed add's bytes when they cannot be taken back out", async () => {
    const h = harness("contact-form.html", undefined, { failWrites: new Set(["documents"]) });
    const platformRemove = h.platform.removeSetting;
    h.platform.removeSetting = async () => {
      throw new Error("busy");
    };
    const result = (await h.send({ type: "add-document", document: cv })) as AddDocumentResponse;
    expect(result).toMatchObject({ ok: false, error: "storage" });
    const orphans = h.storage.get("document-orphans") as string[];
    expect(orphans).toHaveLength(1);
    expect(h.storage.has(`document:${orphans[0]}`)).toBe(true);
    h.platform.removeSetting = platformRemove;
    h.failWrites.clear();
    await h.send({ type: "list-documents" });
    expect(h.storage.has(`document:${orphans[0]}`)).toBe(false);
  });
});

describe("saved answers", () => {
  function typeInto(document: Document, selector: string, value: string): void {
    (document.querySelector(selector) as HTMLInputElement).value = value;
  }

  async function answered(): Promise<ReturnType<typeof harness>> {
    const h = harness("screening-questions.html");
    await h.send({ type: "save-profile", profile });
    await h.send({ type: "save-settings", settings });
    typeInto(h.document, "#email", "ada@example.com");
    typeInto(h.document, "#linkedin", "https://linkedin.com/in/ada");
    typeInto(h.document, "#salary", "£90,000");
    typeInto(h.document, "#why", "Because.");
    typeInto(h.document, "#password", "hunter2");
    return h;
  }

  it("reads what the user typed, never a password, and stores only the ticked answers", async () => {
    const h = await answered();
    const read = (await h.send({ type: "read-answers" })) as ReadAnswersResponse;
    if (!read.ok) throw new Error(read.message);
    expect(read.candidates.map((c) => [c.question, c.value])).toEqual([
      ["LinkedIn profile", "https://linkedin.com/in/ada"],
      ["Desired salary", "£90,000"],
      ["Why do you want to work here?", "Because."],
    ]);
    expect(h.reads.count).toBe(1);
    expect(read.candidates.some((c) => c.ref.includes("password"))).toBe(false);
    expect(h.engine.mapFields).not.toHaveBeenCalled();
    expect(((await h.send({ type: "get-profile" })) as GetProfileResponse).profile.answers).toEqual([]);

    const chosen = read.candidates.filter((c) => c.question !== "Desired salary");
    const saved = (await h.send({ type: "save-answers", chosen })) as SaveAnswersResponse;
    expect(saved.outcome).toEqual({ answers: 1, updates: 0, keys: 1, skipped: 0 });
    expect(saved.profile.contact.linkedin).toBe("https://linkedin.com/in/ada");
    expect(saved.profile.answers).toEqual([expect.objectContaining({ question: "Why do you want to work here?", answer: "Because.", multiline: true })]);
    expect(((await h.send({ type: "get-profile" })) as GetProfileResponse).profile).toEqual(saved.profile);
  });

  it("fills a saved answer on the next form by the rules, and shows the model the question only", async () => {
    const h = harness("job-application.html");
    await h.send({ type: "save-profile", profile: { ...profile, answers: [{ id: "a1", question: "Why do you want to work here?", answer: "Because.", multiline: true }] } });
    await h.send({ type: "save-settings", settings });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);
    expect(scan.plan.assignments.find((a) => a.key === "answer.a1")).toMatchObject({ value: "Because.", source: "heuristic" });
    expect(scan.unmapped.map((u) => u.label)).toEqual(["Preferred pronouns"]);
    const [, options] = (h.engine.mapFields as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(options).toEqual({ answers: [{ key: "answer.a1", question: "Why do you want to work here?", multiline: true }] });
    expect(JSON.stringify(options)).not.toContain("Because.");
  });

  it("answers plainly when there is nothing to read", async () => {
    const h = harness("screening-questions.html");
    await h.send({ type: "save-profile", profile });
    const read = (await h.send({ type: "read-answers" })) as ReadAnswersResponse;
    expect(read).toMatchObject({ ok: true, candidates: [] });
    const empty = harness("<html><body><p>Nothing here</p></body></html>");
    expect(await empty.send({ type: "read-answers" })).toMatchObject({ ok: false, error: "no-fields" });
  });

  it("saves against the stored profile, not the panel's copy", async () => {
    const h = await answered();
    await h.send({ type: "save-profile", profile: { ...profile, contact: { email: "ada@example.com", phone: "123" } } });
    const chosen: AnswerCandidate[] = [
      { ref: "#salary", label: "Desired salary *", question: "Desired salary", value: "£90,000", multiline: false, target: { kind: "answer" } },
    ];
    const saved = (await h.send({ type: "save-answers", chosen })) as SaveAnswersResponse;
    expect(saved.profile.contact.phone).toBe("123");
    expect(saved.profile.answers.map((a) => a.question)).toEqual(["Desired salary"]);
    expect(await h.send({ type: "save-answers", chosen: "junk" })).toMatchObject({ profile: saved.profile });
  });
});

describe("saved answers from combobox widgets", () => {
  it("offers the choice a react-select widget shows, and plans it again from the saved answer", async () => {
    const h = harness("ats-application.html");
    await h.send({ type: "save-profile", profile });
    await h.send({ type: "save-settings", settings: { ...settings, useModel: false } });
    const read = (await h.send({ type: "read-answers" })) as ReadAnswersResponse;
    if (!read.ok) throw new Error(read.message);
    expect(read.candidates.map((c) => [c.question, c.value])).toEqual([["Have you previously worked at or consulted for Acme?", "No"]]);
    const saved = (await h.send({ type: "save-answers", chosen: read.candidates })) as SaveAnswersResponse;
    expect(saved.profile.answers).toEqual([expect.objectContaining({ question: "Have you previously worked at or consulted for Acme?", answer: "No" })]);
    // The widget still shows its choice, so the field is already filled and skipped; the mapping itself is by the rules.
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);
    expect(scan.plan.skipped).toContainEqual(expect.objectContaining({ key: `answer.${saved.profile.answers[0]!.id}`, reason: "already-filled" }));
  });
});

describe("saved answers (robustness)", () => {
  it("judges and names fields by the page as it is when read, not as it was when scanned", async () => {
    const h = harness("screening-questions.html");
    await h.send({ type: "save-profile", profile });
    await h.send({ type: "save-settings", settings: { ...settings, useModel: false } });
    await h.send({ type: "scan-page" });
    (h.document.querySelector("#salary") as HTMLInputElement).value = "£90,000";
    (h.document.querySelector("#source") as HTMLInputElement).value = "A friend";
    // Since the scan: one field became sensitive, another asks a different question.
    h.document.querySelector('label[for="salary"]')!.textContent = "Social Security Number";
    h.document.querySelector('label[for="source"]')!.textContent = "Who referred you?";
    const read = (await h.send({ type: "read-answers" })) as ReadAnswersResponse;
    if (!read.ok) throw new Error(read.message);
    expect(read.candidates.map((c) => [c.question, c.value])).toEqual([["Who referred you?", "A friend"]]);
  });

  it("does not offer back what the reviewed plan filled, but does offer a value the user changed", async () => {
    const h = harness("screening-questions.html");
    await h.send({ type: "save-profile", profile: { ...profile, contact: { email: "ada@example.com" }, answers: [{ id: "a1", question: "Desired salary", answer: "£80,000" }] } });
    await h.send({ type: "save-settings", settings: { ...settings, useModel: false } });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);
    await h.send({ type: "fill-page", tabId: scan.tabId, requests: scan.plan.assignments.map((a) => ({ ref: a.ref, value: a.value })) });
    const planned = scan.plan.assignments.map((a) => ({ ref: a.ref, value: a.value }));
    const asIs = (await h.send({ type: "read-answers", planned })) as ReadAnswersResponse;
    expect(asIs.ok && asIs.candidates).toEqual([]);
    (h.document.querySelector("#salary") as HTMLInputElement).value = "£95,000";
    const changed = (await h.send({ type: "read-answers", planned })) as ReadAnswersResponse;
    if (!changed.ok) throw new Error(changed.message);
    expect(changed.candidates).toEqual([expect.objectContaining({ question: "Desired salary", value: "£95,000", target: { kind: "update", id: "a1" } })]);
  });

  it("serializes saves, so two at once both land", async () => {
    const h = harness("screening-questions.html");
    await h.send({ type: "save-profile", profile });
    const candidate = (question: string, value: string): AnswerCandidate => ({ ref: `#${question}`, label: question, question, value, multiline: false, target: { kind: "answer" } });
    await Promise.all([
      h.send({ type: "save-answers", chosen: [candidate("Desired salary", "£90,000")] }),
      h.send({ type: "save-answers", chosen: [candidate("Notice period", "One month")] }),
    ]);
    const { profile: stored } = (await h.send({ type: "get-profile" })) as GetProfileResponse;
    expect(stored.answers.map((a) => a.question).sort()).toEqual(["Desired salary", "Notice period"]);
  });
});

describe("saved answers after a fill", () => {
  it("does not offer back a select the fill chose, but offers a value the user typed where the fill was not applied", async () => {
    const h = harness("job-application.html");
    await h.send({ type: "save-profile", profile: { ...profile, education: [{ degree: "Master's degree" }] } });
    await h.send({ type: "save-settings", settings: { ...settings, useModel: false } });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);
    const degree = scan.plan.assignments.find((a) => a.key === "education.degree" && a.value === "ma")!;
    const fill = (await h.send({ type: "fill-page", tabId: scan.tabId, requests: [{ ref: degree.ref, value: degree.value }] })) as FillResponse;
    expect(fill.outcome.filled).toEqual([degree.ref]);
    // The panel sends what was written, as the user sees it (the option's label).
    const planned = [{ ref: degree.ref, value: degree.display }];
    (h.document.querySelector('[name="pronouns"]') as HTMLInputElement).value = "she/her";
    const read = (await h.send({ type: "read-answers", planned })) as ReadAnswersResponse;
    if (!read.ok) throw new Error(read.message);
    expect(read.candidates.map((c) => [c.question, c.value])).toEqual([["Preferred pronouns", "she/her"]]);
  });
});

describe("frames", () => {
  // A careers page: the job description in the top frame, the application
  // form embedded from the applicant tracking system in a frame of its own.
  const careers =
    '<html><head><title>Careers at Acme</title></head><body><h1>Staff Software Engineer</h1><p>Lead the dashboard team.</p>' +
    '<button type="button">Share</button><iframe src="https://ats.example/embed/job_app?for=acme"></iframe></body></html>';

  function inFrame(h: Harness, ref: string): HTMLInputElement {
    const { frameId, ref: local } = splitRef(ref);
    const target = frameId === 0 ? h.document : h.frames.get(frameId)!;
    return target.querySelector(local) as HTMLInputElement;
  }

  it("finds the application form inside an embedded frame and fills it there", async () => {
    const h = harness(careers, undefined, { frames: { 42: "job-application.html" } });
    await h.send({ type: "save-profile", profile });
    await h.send({ type: "save-settings", settings });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);
    expect(scan.fieldCount).toBeGreaterThan(0);
    expect(scan.plan.assignments.length).toBeGreaterThan(0);
    expect(scan.plan.assignments.every((a) => a.ref.startsWith("42@"))).toBe(true);
    expect(scan.unmapped.every((u) => u.ref.startsWith("42@"))).toBe(true);
    const first = scan.plan.assignments.find((a) => a.key === "identity.firstName")!;

    const fill = (await h.send({
      type: "fill-page",
      tabId: scan.tabId,
      requests: scan.plan.assignments.map((a) => ({ ref: a.ref, value: a.value })),
    })) as FillResponse;
    expect(fill.outcome.failed).toEqual([]);
    expect(fill.outcome.filled).toEqual(scan.plan.assignments.map((a) => a.ref));
    expect(inFrame(h, first.ref).value).toBe("Ada");
    // The frame's document was written with its own refs, not the qualified ones.
    expect(h.writes.every((w) => !w.ref.includes("@"))).toBe(true);
    expect(h.document.querySelector("input")).toBeNull();
  });

  it("describes the page from all of its frames without a frame ref reaching the model", async () => {
    const h = harness(careers, { summarizeForm: vi.fn(async () => summary) }, { frames: { 42: "job-application.html" } });
    await h.send({ type: "save-settings", settings });
    const result = (await h.send({ type: "describe-page" })) as DescribeResponse;
    if (!result.ok) throw new Error(result.message);
    expect(result.outline.sections).toEqual(["About you", "Education", "Work history", "Anything else"]);
    expect(result.outline.submit).toBe("Submit application");
    expect(result.summary).toEqual(summary);
    const [input] = (h.engine.summarizeForm as ReturnType<typeof vi.fn>).mock.calls[0]! as [SummaryInput];
    expect(input.context.title).toBe("Careers at Acme");
    expect(input.context.headings.slice(0, 2)).toEqual(["Staff Software Engineer", "Application form"]);
    expect(input.context.intro.startsWith("Lead the dashboard team.")).toBe(true);
    expect(input.context.buttons).toContain("Share");
    const prompt = buildSummaryPrompt(input);
    expect(`${prompt.system}\n${prompt.user}`).not.toContain("42@");
  });

  it("reads answers typed inside a frame", async () => {
    const h = harness(careers, undefined, { frames: { 42: "screening-questions.html" } });
    await h.send({ type: "save-profile", profile });
    (h.frames.get(42)!.querySelector("#linkedin") as HTMLInputElement).value = "https://linkedin.com/in/ada";
    const read = (await h.send({ type: "read-answers" })) as ReadAnswersResponse;
    if (!read.ok) throw new Error(read.message);
    expect(read.candidates.map((c) => [c.ref, c.question, c.value])).toEqual([["42@#linkedin", "LinkedIn profile", "https://linkedin.com/in/ada"]]);
  });

  it("fills a page split across frames in one request, top frame first", async () => {
    const h = harness("contact-form.html", undefined, { frames: { 42: "job-application.html" } });
    await h.send({ type: "save-profile", profile });
    await h.send({ type: "save-settings", settings: { ...settings, useModel: false } });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);
    const refs = scan.plan.assignments.map((a) => a.ref);
    expect(refs).toContain("#given");
    expect(refs.some((ref) => ref.startsWith("42@"))).toBe(true);
    expect(refs.findIndex((ref) => ref.startsWith("42@"))).toBeGreaterThan(refs.indexOf("#given"));

    const fill = (await h.send({
      type: "fill-page",
      tabId: scan.tabId,
      requests: scan.plan.assignments.map((a) => ({ ref: a.ref, value: a.value })),
    })) as FillResponse;
    expect(fill.outcome.failed).toEqual([]);
    expect(fill.outcome.filled).toEqual(refs);
    expect((h.document.getElementById("given") as HTMLInputElement).value).toBe("Ada");
    const embedded = scan.plan.assignments.find((a) => a.ref.startsWith("42@") && a.key === "identity.firstName")!;
    expect(inFrame(h, embedded.ref).value).toBe("Ada");
  });

  it("skips a frame that never answers and fails only the writes aimed at it", async () => {
    const h = harness(careers, undefined, { frames: { 42: "job-application.html" }, deadFrames: [9] });
    await h.send({ type: "save-profile", profile });
    await h.send({ type: "save-settings", settings: { ...settings, useModel: false } });
    const scan = (await h.send({ type: "scan-page" })) as ScanResponse;
    if (!scan.ok) throw new Error(scan.message);
    const [first] = scan.plan.assignments;
    const fill = (await h.send({
      type: "fill-page",
      tabId: scan.tabId,
      requests: [
        { ref: first!.ref, value: first!.value },
        { ref: "9@#gone", value: "x" },
      ],
    })) as FillResponse;
    expect(fill.outcome.filled).toEqual([first!.ref]);
    expect(fill.outcome.failed).toEqual([{ ref: "9@#gone", reason: "unresolvable" }]);
  });

  it("still finds the form when only the embedded frame answers, and gives up when none does", async () => {
    const embedOnly = harness(careers, undefined, { frames: { 42: "job-application.html" }, deadFrames: [0] });
    await embedOnly.send({ type: "save-profile", profile });
    await embedOnly.send({ type: "save-settings", settings: { ...settings, useModel: false } });
    expect(await embedOnly.send({ type: "scan-page" })).toMatchObject({ ok: true });

    const none = harness(careers, undefined, { deadFrames: [0] });
    await none.send({ type: "save-profile", profile });
    expect(await none.send({ type: "scan-page" })).toMatchObject({ ok: false, error: "page-unsupported" });
    expect(await none.send({ type: "describe-page" })).toMatchObject({ ok: false, error: "page-unsupported" });
    expect(await none.send({ type: "read-answers" })).toMatchObject({ ok: false, error: "page-unsupported" });
  });
});
