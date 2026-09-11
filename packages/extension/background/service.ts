// Background orchestration: settings, the stored profile and documents, and
// the scan/fill round trips to the active tab. Parameterized over Platform
// and the engine factory so it is testable with fakes; the entry point
// (index.ts) wires in the real implementations.
//
// The background is the only surface that sees profile values, documents,
// and field schemas together (in core's planFill). The content script sees
// field schemas and, at fill time, the approved values and files; the model
// sees schemas and page text (for the form summary) only.
//
// Documents live in storage.local like the profile: a metadata index under
// DOCUMENTS_KEY and each file's bytes, base64, under its own key, so listing
// never reads a byte. Data is written before its index entry and removed
// after it, so the index never points at bytes that are not there.
//
// MV3 constraint honored by startBackground: no top-level await, and all
// listeners are registered synchronously when it is called at load.

import {
  MAX_DOCUMENT_BYTES,
  applyAnswers,
  base64ByteLength,
  buildSummaryPrompt,
  describeAnswers,
  eligibleFields,
  isProfileEmpty,
  mergeFormContexts,
  normalizeDocuments,
  normalizeProfile,
  outlineForm,
  planFill,
  proposeAnswers,
  resolveMappings,
  resolveUploads,
  type AnswerCandidate,
  type CollectedField,
  type FilePayload,
  type FormContext,
  type FormSummary,
  type Profile,
  type StoredDocument,
  type SummaryInput,
  type UploadField,
  type WriteRequest,
} from "@offline-autofill/core";
import type {
  AddDocumentResponse,
  ApplyFillResponse,
  BackgroundRequest,
  CollectFieldsResponse,
  ContentRequest,
  DescribeFormResponse,
  DescribeResponse,
  DocumentKind,
  EngineErrorCode,
  FillRequest,
  FillResponse,
  GetProfileResponse,
  GetSettingsResponse,
  ListDocumentsResponse,
  NewDocument,
  ProbeEngineResponse,
  CollectAnswersResponse,
  PlannedValue,
  ReadAnswersResponse,
  SaveAnswersResponse,
  ScanResponse,
  Settings,
  UnmappedField,
} from "@offline-autofill/shared";
import type { Platform } from "../platform/types";
import { defaultSettings, modelSelected, normalizeSettings } from "../lib/settings";
import { EngineError, type EngineClient } from "./engines";
import { qualifyRef, splitRef } from "./frame-refs";

export const SETTINGS_KEY = "settings";
export const PROFILE_KEY = "profile";
export const DOCUMENTS_KEY = "documents";
/**
 * Ids whose bytes may exist without an index entry. An id is written here
 * before its bytes are touched (adding, removing) and cleared once the
 * operation completes, so whatever a failure or a restart leaves behind is
 * known, and the next document operation deletes it.
 */
export const DOCUMENT_ORPHANS_KEY = "document-orphans";

/** Where a stored document's bytes live, base64. */
export function documentDataKey(id: string): string {
  return `document:${id}`;
}

/** A local model can take a while on weak hardware; past this the outline stands alone. */
export const SUMMARY_TIMEOUT_MS = 90_000;
/** Recent model descriptions, so a rescan of the same form after a fill is free. */
export const SUMMARY_CACHE_MAX = 20;

export interface BackgroundDeps {
  platform: Platform;
  createEngine: (settings: Settings) => EngineClient;
  /** Overridable for tests; production uses SUMMARY_TIMEOUT_MS. */
  summaryTimeoutMs?: number;
}

export function startBackground({ platform, createEngine, summaryTimeoutMs = SUMMARY_TIMEOUT_MS }: BackgroundDeps): void {
  platform.initPanelBehavior();

  /** A fresh install uses the browser's built-in model where there is one; a saved choice is kept as saved. */
  const defaults = defaultSettings(platform.builtInModel !== undefined);

  // Keyed by engine, model, endpoint, and the exact prompt text: the same
  // form on the same model gives the same answer (temperature 0). Lives and
  // dies with the service worker.
  const summaryCache = new Map<string, FormSummary>();
  /** Requests for the same key while one is in flight share its answer instead of queueing another. */
  const summaryInFlight = new Map<string, Promise<FormSummary | undefined>>();

  platform.onMessage((message) => {
    const request = message as BackgroundRequest;
    switch (request?.type) {
      case "get-settings":
        return loadSettings().then((settings): GetSettingsResponse => ({ settings }));
      case "save-settings": {
        const settings = normalizeSettings(request.settings, defaults);
        return platform.setSetting(SETTINGS_KEY, settings).then((): GetSettingsResponse => ({ settings }));
      }
      case "probe-engine":
        return probeEngine(normalizeSettings(request.settings, defaults));
      case "get-profile":
        return loadProfile().then((profile): GetProfileResponse => ({ profile }));
      case "save-profile": {
        const profile = normalizeProfile(request.profile);
        return withProfileLock(() => platform.setSetting(PROFILE_KEY, profile).then((): GetProfileResponse => ({ profile })));
      }
      case "list-documents":
        return withDocumentLock(async (): Promise<ListDocumentsResponse> => {
          await sweepOrphans();
          return { documents: await loadDocuments() };
        });
      case "add-document":
        return addDocument(request.document);
      case "update-document":
        return updateDocument(request.id, request.kind, request.description);
      case "remove-document":
        return removeDocument(request.id);
      case "scan-page":
        return scanPage();
      case "describe-page":
        return describePage();
      case "fill-page":
        return fillPage(request.tabId, request.requests);
      case "read-answers":
        return readAnswers(Array.isArray(request.planned) ? request.planned : []);
      case "save-answers":
        return saveAnswers(Array.isArray(request.chosen) ? request.chosen : []);
      default:
        return undefined;
    }
  });

  async function loadSettings(): Promise<Settings> {
    return normalizeSettings(await platform.getSetting(SETTINGS_KEY, undefined), defaults);
  }

  async function loadProfile(): Promise<Profile> {
    return normalizeProfile(await platform.getSetting(PROFILE_KEY, undefined));
  }

  async function loadDocuments(): Promise<StoredDocument[]> {
    return normalizeDocuments(await platform.getSetting(DOCUMENTS_KEY, undefined));
  }

  // Every change to the index is a read-modify-write; two at once (edits to
  // two cards saved back to back, two panels adding) would drop one. They
  // run one after another instead.
  let documentWrites: Promise<unknown> = Promise.resolve();
  let profileWrites: Promise<unknown> = Promise.resolve();

  /** Profile writes run one after another, so a save that reads, changes, and writes cannot lose another's change. */
  function withProfileLock<T>(run: () => Promise<T>): Promise<T> {
    const next = profileWrites.then(run, run);
    profileWrites = next.catch(() => undefined);
    return next;
  }

  function withDocumentLock<T>(run: () => Promise<T>): Promise<T> {
    const next = documentWrites.then(run, run);
    documentWrites = next.catch(() => undefined);
    return next;
  }

  function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function loadOrphans(): Promise<string[]> {
    const raw = await platform.getSetting<unknown>(DOCUMENT_ORPHANS_KEY, []);
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && id !== "") : [];
  }

  /** Records the intent to touch an id's bytes. Throws when storage will not take it, and then nothing else is attempted. */
  async function noteIntent(id: string): Promise<void> {
    const orphans = await loadOrphans();
    if (!orphans.includes(id)) {
      await platform.setSetting(DOCUMENT_ORPHANS_KEY, [...orphans, id]);
    }
  }

  /**
   * The operation completed; nothing is left to clean up for this id. Never
   * throws: it runs after the operation is done and must not undo it, and
   * the next sweep clears a stale intent anyway.
   */
  async function clearIntent(id: string): Promise<void> {
    try {
      const orphans = await loadOrphans();
      if (orphans.includes(id)) {
        await platform.setSetting(
          DOCUMENT_ORPHANS_KEY,
          orphans.filter((entry) => entry !== id),
        );
      }
    } catch {
      // Left for the next sweep.
    }
  }

  /**
   * Deletes what earlier failures or restarts left behind. An id still in
   * the index is a document whose operation completed but whose intent was
   * not cleared: its bytes stay, only the entry goes. Whatever still fails
   * stays listed for next time.
   */
  async function sweepOrphans(): Promise<void> {
    const orphans = await loadOrphans();
    if (orphans.length === 0) {
      return;
    }
    const indexed = new Set((await loadDocuments()).map((document) => document.id));
    const remaining: string[] = [];
    for (const id of orphans) {
      if (indexed.has(id)) {
        continue;
      }
      try {
        await platform.removeSetting(documentDataKey(id));
      } catch {
        remaining.push(id);
      }
    }
    if (remaining.length !== orphans.length) {
      await platform.setSetting(DOCUMENT_ORPHANS_KEY, remaining).catch(() => undefined);
    }
  }

  async function addDocument(input: NewDocument): Promise<AddDocumentResponse> {
    const data = typeof input?.data === "string" ? input.data : "";
    const size = base64ByteLength(data);
    if (size <= 0) {
      return { ok: false, error: "empty", message: "That file is empty." };
    }
    if (size > MAX_DOCUMENT_BYTES) {
      return { ok: false, error: "too-large", message: `That file is too big. Files up to ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB can be stored.` };
    }
    const [document] = normalizeDocuments([
      {
        id: crypto.randomUUID(),
        kind: input.kind,
        description: input.description,
        fileName: input.fileName,
        mimeType: input.mimeType,
        size,
        addedAt: new Date().toISOString(),
      },
    ]);
    if (!document) {
      return { ok: false, error: "empty", message: "That file has no name." };
    }
    return withDocumentLock(async () => {
      await sweepOrphans();
      try {
        // Intent first: if storage will not even take that, no bytes are written.
        await noteIntent(document.id);
      } catch (error) {
        return { ok: false, error: "storage", message: `Couldn’t store the file: ${errorText(error)}` };
      }
      let documents: StoredDocument[];
      try {
        await platform.setSetting(documentDataKey(document.id), data);
        documents = [...(await loadDocuments()), document];
        await platform.setSetting(DOCUMENTS_KEY, documents);
      } catch (error) {
        // Bytes without an index entry are unreachable: take them back out
        // now, or, that failing, leave the recorded intent for the next sweep.
        await platform
          .removeSetting(documentDataKey(document.id))
          .then(() => clearIntent(document.id))
          .catch(() => undefined);
        return { ok: false, error: "storage", message: `Couldn’t store the file: ${errorText(error)}` };
      }
      // Outside the try: the document is stored, and nothing after this may undo that.
      await clearIntent(document.id);
      return { ok: true, documents };
    });
  }

  function updateDocument(id: string, kind: DocumentKind, description: string): Promise<ListDocumentsResponse> {
    return withDocumentLock(async () => {
      await sweepOrphans();
      const before = await loadDocuments();
      const documents = normalizeDocuments(before.map((document) => (document.id === id ? { ...document, kind, description } : document)));
      try {
        await platform.setSetting(DOCUMENTS_KEY, documents);
        return { documents };
      } catch (error) {
        return { documents: before, error: `Couldn’t save the change: ${errorText(error)}` };
      }
    });
  }

  /**
   * The index entry goes first, then the bytes. If the bytes cannot be
   * removed the entry is put back, so the document stays visible and the
   * user can try again rather than leaving invisible bytes behind.
   */
  function removeDocument(id: string): Promise<ListDocumentsResponse> {
    return withDocumentLock(async () => {
      await sweepOrphans();
      const before = await loadDocuments();
      const documents = before.filter((document) => document.id !== id);
      try {
        // Intent first, so bytes that outlive their entry are always known.
        await noteIntent(id);
        await platform.setSetting(DOCUMENTS_KEY, documents);
      } catch (error) {
        await clearIntent(id);
        return { documents: before, error: `Couldn’t remove it: ${errorText(error)}` };
      }
      try {
        await platform.removeSetting(documentDataKey(id));
      } catch (error) {
        // Put the entry back so the bytes stay reachable and removable; if
        // even that fails, the recorded intent has the next sweep delete
        // them. What is answered is what storage actually holds.
        await platform
          .setSetting(DOCUMENTS_KEY, before)
          .then(() => clearIntent(id))
          .catch(() => undefined);
        return { documents: await loadDocuments(), error: `Couldn’t remove it: ${errorText(error)}` };
      }
      // Outside the try: the document is gone, and nothing after this may bring half of it back.
      await clearIntent(id);
      return { documents };
    });
  }

  /** A stored document as the tab receives it, or nothing when it is gone. */
  async function loadDocumentFile(id: string): Promise<FilePayload | undefined> {
    const document = (await loadDocuments()).find((entry) => entry.id === id);
    const data = await platform.getSetting<unknown>(documentDataKey(id), undefined);
    if (!document || typeof data !== "string" || data === "") {
      return undefined;
    }
    return { name: document.fileName, type: document.mimeType, data };
  }

  async function probeEngine(settings: Settings): Promise<ProbeEngineResponse> {
    try {
      return { status: await createEngine(settings).probe() };
    } catch (error) {
      return { status: { state: "error", detail: String(error) } };
    }
  }

  /** Sends to one frame's content script, injecting it first when the frame predates the extension load. */
  async function askFrame<T>(tabId: number, frameId: number, request: ContentRequest): Promise<T | undefined> {
    try {
      return (await platform.sendTabMessage(tabId, request, frameId)) as T;
    } catch {
      // No listener: inject and retry once. Browser-internal pages and cross-origin frames reject the injection too.
    }
    try {
      await platform.injectContentScript(tabId, frameId);
      return (await platform.sendTabMessage(tabId, request, frameId)) as T;
    } catch {
      return undefined;
    }
  }

  /**
   * A page is the set of its frames: an application form is routinely
   * embedded from another site. Every frame that answers is heard, top
   * frame first; a frame without a content script (a tab open since before
   * the extension loaded, a frame the browser will not let it into) is
   * skipped, and the caller decides what an empty answer means.
   */
  async function askFrames<T>(tabId: number, request: ContentRequest): Promise<FrameAnswer<T>[]> {
    const frames = await platform.listFrames(tabId);
    const answers = await Promise.all(frames.map((frameId) => askFrame<T>(tabId, frameId, request).then((answer) => ({ frameId, answer }))));
    const heard: FrameAnswer<T>[] = [];
    for (const { frameId, answer } of answers) {
      if (answer !== undefined) {
        heard.push({ frameId, answer });
      }
    }
    return heard;
  }

  async function scanPage(): Promise<ScanResponse> {
    const tab = await platform.getActiveTab();
    if (!tab) {
      return { ok: false, error: "no-tab", message: "No active tab." };
    }
    const [profile, documents] = await Promise.all([loadProfile(), loadDocuments()]);
    if (isProfileEmpty(profile) && documents.length === 0) {
      return { ok: false, error: "profile-empty", message: "Your profile is empty. Add some details or a document first." };
    }
    const answers = await askFrames<CollectFieldsResponse>(tab.id, { type: "collect-fields" });
    if (answers.length === 0) {
      return { ok: false, error: "page-unsupported", message: "This page cannot be filled (browser pages and some restricted sites)." };
    }
    const fields: CollectedField[] = answers.flatMap(({ frameId, answer }) => qualifyAll(frameId, listOf(answer.fields)));
    // A content script loaded before this version answers without uploads.
    const uploads: UploadField[] = answers.flatMap(({ frameId, answer }) => qualifyAll(frameId, listOf(answer.uploads)));
    if (fields.length === 0 && uploads.length === 0) {
      return { ok: false, error: "no-fields", message: "No form fields found on this page." };
    }

    const settings = await loadSettings();
    let mapper: EngineClient | undefined;
    let modelError: { code: EngineErrorCode; message: string } | undefined;
    if (modelSelected(settings)) {
      try {
        mapper = createEngine(settings);
      } catch (error) {
        modelError = describeError(error);
      }
    }

    /** The model failed: the heuristics alone still make a plan. Each pipeline falls back on its own. */
    const withModel = async <T>(run: (mapper?: EngineClient) => Promise<T>): Promise<T> => {
      if (!mapper) {
        return run();
      }
      try {
        return await run(mapper);
      } catch (error) {
        modelError = describeError(error);
        return run();
      }
    };
    const [resolved, resolvedUploads] = await Promise.all([
      withModel((engine) => resolveMappings(fields, engine, { answers: describeAnswers(profile.answers) })),
      withModel((engine) => resolveUploads(uploads, engine)),
    ]);

    const plan = planFill(fields, resolved.mappings, profile, {
      overwrite: settings.overwrite,
      attach: { uploads, mappings: resolvedUploads.mappings, documents },
    });
    const response: ScanResponse = {
      ok: true,
      tabId: tab.id,
      plan,
      fieldCount: fields.length - resolved.blocked.length,
      uploadCount: resolvedUploads.mappings.length + resolvedUploads.unmapped.length,
      unmapped: [...resolved.unmapped.map(unmappedOf), ...resolvedUploads.unmapped.map(unmappedUploadOf)],
      blockedCount: resolved.blocked.length + resolvedUploads.blocked.length,
      usedModel: resolved.usedModel || resolvedUploads.usedModel,
    };
    if (modelError) {
      response.modelError = modelError;
    }
    return response;
  }

  /**
   * What the page could teach the profile. The tab answers with its fields
   * and the values of the ones the scan would offer (visible, editable,
   * unblocked) that hold one, from a single pass, so the fields the values
   * are named by are the fields of that instant; the candidate rule then
   * says which are new and where each would go. `planned` is what the
   * reviewed plan filled, so those values are not offered back. No model,
   * no profile value leaves here: the candidates go to the panel for review
   * and are stored only by saveAnswers.
   */
  async function readAnswers(planned: PlannedValue[]): Promise<ReadAnswersResponse> {
    const tab = await platform.getActiveTab();
    if (!tab) {
      return { ok: false, error: "no-tab", message: "No active tab." };
    }
    const answers = (await askFrames<CollectAnswersResponse>(tab.id, { type: "collect-answers" })).filter(({ answer }) => Array.isArray(answer.fields));
    if (answers.length === 0) {
      return { ok: false, error: "page-unsupported", message: "This page cannot be read (browser pages and some restricted sites)." };
    }
    const fields = answers.flatMap(({ frameId, answer }) => qualifyAll(frameId, answer.fields));
    if (fields.length === 0) {
      return { ok: false, error: "no-fields", message: "No form fields found on this page." };
    }
    const values = answers.flatMap(({ frameId, answer }) => qualifyAll(frameId, listOf(answer.values)));
    const profile = await loadProfile();
    return { ok: true, tabId: tab.id, candidates: proposeAnswers({ fields, values, profile, planned }) };
  }

  /** Saves the ticked candidates into the stored profile, read fresh under the lock so no other save is lost. */
  function saveAnswers(chosen: AnswerCandidate[]): Promise<SaveAnswersResponse> {
    return withProfileLock(async () => {
      const { profile, outcome } = applyAnswers(await loadProfile(), chosen);
      await platform.setSetting(PROFILE_KEY, profile);
      return { profile, outcome };
    });
  }

  /**
   * What the form is: the rules' outline always, plus the model's description
   * when a model is configured. Needs no profile, so it works before one is
   * entered. A model failure or timeout leaves the outline standing.
   */
  async function describePage(): Promise<DescribeResponse> {
    const tab = await platform.getActiveTab();
    if (!tab) {
      return { ok: false, error: "no-tab", message: "No active tab." };
    }
    const answers = (await askFrames<DescribeFormResponse>(tab.id, { type: "describe-form" })).filter(({ answer }) => typeof answer.context === "object" && answer.context !== null);
    if (answers.length === 0) {
      return { ok: false, error: "page-unsupported", message: "This page cannot be read (browser pages and some restricted sites)." };
    }
    const fields = answers.flatMap(({ frameId, answer }) => qualifyAll(frameId, listOf(answer.fields)));
    const contexts = answers.map(({ answer }) => answer.context);
    // A form of uploads alone is still a form. A content script from before
    // this version answers without blockedUploads and with every upload label
    // in uploads, judged by nothing; those are left out rather than trusted.
    // On a careers page the top frame holds the job description and the
    // embedded frame the form; the summary reads both as one page.
    const context = mergeFormContexts(contexts.map(legacySafeContext));
    // Whether the page has any control at all is judged on what was sent,
    // legacy labels included; only what is said about them is withheld.
    const hasUploads = contexts.some((sent) => (sent.uploads?.length ?? 0) > 0 || (sent.blockedUploads?.length ?? 0) > 0);
    if (fields.length === 0 && !hasUploads) {
      return { ok: false, error: "no-fields", message: "No form fields found on this page." };
    }
    const { eligible, blocked } = eligibleFields(fields);
    const outline = outlineForm(eligible, blocked, context);
    const response: DescribeResponse = { ok: true, tabId: tab.id, outline, usedModel: false };

    // The panel skips the request when the summary is switched off; the
    // background checks too, so page text never reaches the model on the
    // word of a stale panel alone.
    const settings = await loadSettings();
    if (!settings.summary || !modelSelected(settings)) {
      return response;
    }
    const input: SummaryInput = { context, fields: eligible, blocked: outline.blocked };
    const key = [settings.engine, settings.model, settings.endpoint, buildSummaryPrompt(input).user].join("\u0000");
    const cached = summaryCache.get(key);
    if (cached) {
      return { ...response, summary: cached, usedModel: true };
    }
    let pending = summaryInFlight.get(key);
    if (!pending) {
      pending = askModel(settings, input);
      summaryInFlight.set(key, pending);
      void pending.catch(() => undefined).finally(() => summaryInFlight.delete(key));
    }
    try {
      const summary = await pending;
      response.usedModel = true;
      if (summary) {
        response.summary = summary;
        rememberSummary(key, summary);
      }
    } catch (error) {
      response.modelError = describeError(error);
    }
    return response;
  }

  /**
   * One engine call under the timeout. Engine creation and the timeout both
   * fail inside this promise, so every request sharing it reads the same
   * error, whether it started the call or joined it.
   */
  async function askModel(settings: Settings, input: SummaryInput): Promise<FormSummary | undefined> {
    const signal = AbortSignal.timeout(summaryTimeoutMs);
    try {
      return await createEngine(settings).summarizeForm(input, signal);
    } catch (error) {
      if (signal.aborted) {
        throw new EngineError("engine-error", "The model took too long to answer.");
      }
      throw error;
    }
  }

  function rememberSummary(key: string, summary: FormSummary): void {
    summaryCache.set(key, summary);
    if (summaryCache.size > SUMMARY_CACHE_MAX) {
      // Map iterates in insertion order, so the first key is the oldest.
      summaryCache.delete(summaryCache.keys().next().value!);
    }
  }

  /**
   * Values go to the tab as they are; documents are looked up by id and go
   * as files. A document removed since the scan fails its request here,
   * before the tab is asked. Each frame is written on its own, with the
   * refs as its document knows them, one frame after another so the
   * outcome keeps the plan's order.
   */
  async function fillPage(tabId: number, requests: FillRequest[]): Promise<FillResponse> {
    const byFrame = new Map<number, WriteRequest[]>();
    const failed: FillResponse["outcome"]["failed"] = [];
    for (const request of requests) {
      const { frameId, ref } = splitRef(request.ref);
      let write: WriteRequest;
      if ("documentId" in request) {
        const file = await loadDocumentFile(request.documentId);
        if (!file) {
          failed.push({ ref: request.ref, reason: "unresolvable" });
          continue;
        }
        write = { ref, file };
      } else {
        write = { ref, value: request.value };
      }
      const writes = byFrame.get(frameId) ?? [];
      writes.push(write);
      byFrame.set(frameId, writes);
    }
    const filled: string[] = [];
    for (const [frameId, writes] of byFrame) {
      const applied = await askFrame<ApplyFillResponse>(tabId, frameId, { type: "apply-fill", requests: writes });
      if (!applied) {
        failed.push(...writes.map((w) => ({ ref: qualifyRef(frameId, w.ref), reason: "unresolvable" as const })));
        continue;
      }
      filled.push(...applied.outcome.filled.map((ref) => qualifyRef(frameId, ref)));
      failed.push(...applied.outcome.failed.map((failure) => ({ ...failure, ref: qualifyRef(frameId, failure.ref) })));
    }
    return { outcome: { filled, failed } };
  }
}

/** What one frame's content script answered. */
interface FrameAnswer<T> {
  frameId: number;
  answer: T;
}

/** An array as sent, or nothing: a malformed or older answer is not trusted for what it lacks. */
function listOf<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/** The items as the rest of the extension refers to them: by a ref that names the frame. */
function qualifyAll<T extends { ref: string }>(frameId: number, items: T[]): T[] {
  return items.map((item) => ({ ...item, ref: qualifyRef(frameId, item.ref) }));
}

/**
 * A context as the current collector makes it, from one an older content
 * script may have sent (until its page reloads). The old collector judged
 * no upload, and a label alone cannot be judged here (the identifier and
 * section that would refuse it are gone), so its uploads are dropped: the
 * summary says nothing about attachments rather than something unsafe.
 */
function legacySafeContext(context: FormContext): FormContext {
  if (Array.isArray(context.blockedUploads)) {
    return context;
  }
  return { ...context, uploads: [], blockedUploads: [] };
}

function unmappedUploadOf(upload: UploadField): UnmappedField {
  return { ref: upload.ref, label: upload.label ?? upload.name ?? upload.id ?? "File upload" };
}

function unmappedOf(field: CollectedField): UnmappedField {
  return {
    ref: field.ref,
    label: field.label ?? field.ariaLabel ?? field.placeholder ?? field.nearbyText ?? field.name ?? field.id ?? field.ref,
  };
}

function describeError(error: unknown): { code: EngineErrorCode; message: string } {
  if (error instanceof EngineError) {
    return { code: error.code, message: error.message };
  }
  return { code: "engine-error", message: error instanceof Error ? error.message : String(error) };
}
