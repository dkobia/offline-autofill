// Protocol types shared between the extension surfaces (background, content, panel).
// Type-only imports from core are allowed; runtime imports are not.

import type {
  AnswerCandidate,
  CollectedField,
  DocumentKind,
  FillOutcome,
  FillPlan,
  FormContext,
  FormOutline,
  FormSummary,
  Profile,
  ReadValue,
  SaveOutcome,
  StoredDocument,
  UploadField,
  WriteRequest,
} from "@offline-autofill/core";

export type {
  AnswerCandidate,
  CandidateTarget,
  CollectedField,
  DocumentKind,
  FillOutcome,
  FillPlan,
  FormContext,
  FormOutline,
  FormSummary,
  Profile,
  ReadValue,
  SavedAnswer,
  SaveOutcome,
  StoredDocument,
  UploadField,
  WriteRequest,
} from "@offline-autofill/core";

/** Which local runtime the extension talks to. */
export type EngineKind = "ollama" | "lmstudio" | "llamacpp" | "custom";

export interface Settings {
  engine: EngineKind;
  /** Base URL of the local server, e.g. "http://localhost:11434". Localhost only. */
  endpoint: string;
  /** Model identifier as the server knows it, e.g. "llama3.2" or "qwen2.5:7b". */
  model: string;
  /** Ask the local model about fields the heuristics could not map. Off means heuristics only. */
  useModel: boolean;
  /** Fill fields that already contain a value. */
  overwrite: boolean;
  /** Describe the form (what it is for, how to complete it) with every scan. */
  summary: boolean;
}

/** Result of probing the configured engine endpoint. */
export type EngineStatus =
  | { state: "ok"; models: string[] }
  | { state: "unreachable"; detail?: string }
  /** Reachable but the server rejects browser-extension origins (Ollama without OLLAMA_ORIGINS). */
  | { state: "forbidden" }
  | { state: "error"; detail: string };

export type EngineErrorCode = "engine-unreachable" | "origin-forbidden" | "model-missing" | "engine-error";

// ---- Panel -> background one-shot messages ------------------------------------------

/** A document as the panel hands it over: metadata plus the bytes, base64 (messages are JSON). */
export interface NewDocument {
  kind: DocumentKind;
  description: string;
  fileName: string;
  mimeType: string;
  data: string;
}

/**
 * One approved write: a value for a field, or a stored document for an
 * upload. The panel names documents by id only; the background attaches
 * the bytes on the way to the tab.
 */
export type FillRequest = { ref: string; value: string } | { ref: string; documentId: string };

export type BackgroundRequest =
  | { type: "get-settings" }
  | { type: "save-settings"; settings: Settings }
  | { type: "probe-engine"; settings: Settings }
  | { type: "get-profile" }
  | { type: "save-profile"; profile: Profile }
  | { type: "list-documents" }
  | { type: "add-document"; document: NewDocument }
  | { type: "update-document"; id: string; kind: DocumentKind; description: string }
  | { type: "remove-document"; id: string }
  | { type: "scan-page" }
  | { type: "describe-page" }
  | { type: "fill-page"; tabId: number; requests: FillRequest[] }
  /** `planned` is the reviewed plan's values by ref, so a field holding the extension's own fill is not offered back. */
  | { type: "read-answers"; planned?: PlannedValue[] }
  | { type: "save-answers"; chosen: AnswerCandidate[] };

/** A value the fill plan assigned to a field, as the panel remembers it. */
export interface PlannedValue {
  ref: string;
  value: string;
}

export interface GetSettingsResponse {
  settings: Settings;
}

export interface ProbeEngineResponse {
  status: EngineStatus;
}

export interface GetProfileResponse {
  profile: Profile;
}

/** The stored documents, metadata only, after any change; `error` says why a change did not take. */
export interface ListDocumentsResponse {
  documents: StoredDocument[];
  error?: string;
}

export type AddDocumentErrorCode = "too-large" | "empty" | "storage";

export type AddDocumentResponse =
  | { ok: true; documents: StoredDocument[] }
  | { ok: false; error: AddDocumentErrorCode; message: string };

export type ScanErrorCode = "no-tab" | "page-unsupported" | "no-fields" | "profile-empty";

/** A field nobody could map, as the panel lists it. */
export interface UnmappedField {
  ref: string;
  label: string;
}

export type ScanResponse =
  | {
      ok: true;
      tabId: number;
      plan: FillPlan;
      /** Visible, editable, unblocked fields the scan considered. */
      fieldCount: number;
      /** Editable, unblocked file inputs the scan considered. */
      uploadCount: number;
      /** Fields and uploads nobody could map. */
      unmapped: UnmappedField[];
      /** Fields and uploads refused on sight (passwords, cards, ids). */
      blockedCount: number;
      usedModel: boolean;
      /** Set when the model was wanted but failed; the plan is then heuristics only. */
      modelError?: { code: EngineErrorCode; message: string };
    }
  | { ok: false; error: ScanErrorCode; message: string };

export interface FillResponse {
  outcome: FillOutcome;
}

export type DescribeErrorCode = "no-tab" | "page-unsupported" | "no-fields";

/** What the form is: the rules' outline always, the model's description when one was consulted and answered. */
export type DescribeResponse =
  | {
      ok: true;
      tabId: number;
      outline: FormOutline;
      summary?: FormSummary;
      usedModel: boolean;
      /** Set when the model was wanted but failed; the outline stands on its own. */
      modelError?: { code: EngineErrorCode; message: string };
    }
  | { ok: false; error: DescribeErrorCode; message: string };

export type ReadAnswersErrorCode = "no-tab" | "page-unsupported" | "no-fields";

/**
 * What the page could teach the profile: the fields the user filled by
 * hand, each with where it would be kept. Values are read from the page
 * only for this request and stored only by save-answers.
 */
export type ReadAnswersResponse =
  | { ok: true; tabId: number; candidates: AnswerCandidate[] }
  | { ok: false; error: ReadAnswersErrorCode; message: string };

/** The profile after the chosen answers were saved into it, and what actually changed. */
export interface SaveAnswersResponse {
  profile: Profile;
  outcome: SaveOutcome;
}

// ---- Background -> content -----------------------------------------------------------

export type ContentRequest =
  | { type: "collect-fields" }
  | { type: "apply-fill"; requests: WriteRequest[] }
  | { type: "describe-form" }
  | { type: "get-page-url" }
  /** The page's fields and the values of those the user filled in; asked only when the user clicks "Save answers". */
  | { type: "collect-answers" };

export interface CollectFieldsResponse {
  fields: CollectedField[];
  uploads: UploadField[];
}

export interface ApplyFillResponse {
  outcome: FillOutcome;
}

/** Fields plus the page context the summary is built from, in one round trip. */
export interface DescribeFormResponse {
  fields: CollectedField[];
  context: FormContext;
}

export interface GetPageUrlResponse {
  url: string;
}

export interface CollectAnswersResponse {
  fields: CollectedField[];
  values: ReadValue[];
}
