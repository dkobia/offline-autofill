import type { FieldMapper, FormSummarizer, UploadMapper } from "@offline-autofill/core";
import type { EngineErrorCode, EngineStatus } from "@offline-autofill/shared";

/** Thrown by engine clients; the code maps 1:1 onto the protocol's error codes. */
export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** Injectable fetch so engine clients are unit testable in Node. */
export type FetchFn = typeof fetch;

/** Core's model contracts plus what the settings UI needs: reachability and models. */
export interface EngineClient extends FieldMapper, UploadMapper, FormSummarizer {
  probe(signal?: AbortSignal): Promise<EngineStatus>;
}

/** One schema-constrained, non-streaming chat turn; both clients speak this internally. */
export interface ChatRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  /** Name for servers that want the schema labelled (OpenAI-style response_format). */
  schemaName: string;
  /** Runaway guard on generated tokens; omitted for answers the schema already bounds. */
  maxTokens?: number;
}

/**
 * Generation cap for the form summary. The answer itself is a few hundred
 * tokens; the headroom is for thinking models, whose reasoning counts
 * against the cap and would otherwise leave no room for the answer.
 */
export const SUMMARY_MAX_TOKENS = 4096;

/** Shared response triage for both HTTP clients. */
export function statusError(status: number, detail: string): EngineError {
  if (status === 403) {
    return new EngineError("origin-forbidden", "The server rejected the extension's origin.");
  }
  if (status === 404) {
    return new EngineError("model-missing", detail || "Model not found.");
  }
  return new EngineError("engine-error", detail || `HTTP ${status}`);
}
