// Client for the browser's built-in model (Chrome's Gemini Nano, through the
// Prompt API), reached through the platform's BuiltInModel seam. There is no
// server: probing asks the browser whether the model is there, and mapping
// and the form summary are each one session (system prompt, one user prompt
// constrained to the JSON schema core builds, destroy).
//
// The model is never downloaded from here. Chrome starts that download only
// from a page the user just interacted with, and it is a few gigabytes; the
// panel offers it, and until it is done every call fails with
// "model-unavailable" and the rules carry on alone.
//
// The model's context is small (a few thousand tokens) and the schema counts
// against it. A mapping that does not fit is split in half and asked in
// pieces; a summary that does not fit is asked again without the page text.

import {
  buildMappingPrompt,
  buildSummaryPrompt,
  buildUploadPrompt,
  parseMappingResponse,
  parseSummaryResponse,
  parseUploadResponse,
  type AnswerSpec,
  type CollectedField,
  type FieldMapping,
  type FormSummary,
  type MapFieldsOptions,
  type SummaryInput,
  type UploadField,
  type UploadMapping,
} from "@offline-autofill/core";
import type { EngineStatus } from "@offline-autofill/shared";
import type { BuiltInAvailability, BuiltInModel } from "../../platform/types";
import { EngineError, type EngineClient } from "./types";

/** What the status UI lists as the one model the engine has. */
export const BUILT_IN_MODEL_NAME = "Gemini Nano";

/** Why the model cannot answer right now, in the words the panel shows beside the plan. */
export function unavailableMessage(availability: Exclude<BuiltInAvailability, "available">): string {
  switch (availability) {
    case "downloadable":
      return "Chrome’s built-in model isn’t downloaded yet";
    case "downloading":
      return "Chrome is still downloading its built-in model";
    case "unavailable":
      return "Chrome’s built-in model isn’t available on this device";
  }
}

export class BuiltInEngine implements EngineClient {
  readonly name = "builtin";

  constructor(private readonly model: BuiltInModel | undefined) {}

  async probe(): Promise<EngineStatus> {
    if (!this.model) {
      return { state: "unsupported" };
    }
    let availability: BuiltInAvailability;
    try {
      availability = await this.model.availability();
    } catch (error) {
      return { state: "error", detail: errorText(error) };
    }
    switch (availability) {
      case "available":
        return { state: "ok", models: [BUILT_IN_MODEL_NAME] };
      case "downloadable":
        return { state: "downloadable" };
      case "downloading":
        return { state: "downloading" };
      default:
        return { state: "unsupported" };
    }
  }

  async mapFields(fields: CollectedField[], options: MapFieldsOptions = {}): Promise<FieldMapping[]> {
    const model = await this.ready();
    return this.mapBatch(model, fields, options.answers ?? [], options.signal);
  }

  /**
   * One prompt for the batch; a batch the context cannot hold is split in
   * two and each half asked on its own (the ids are per prompt, so every
   * half reads back by its own table). A single field that still does not
   * fit is not the field's fault (the vocabulary and schema are the bulk)
   * and is reported rather than silently dropped.
   */
  private async mapBatch(model: BuiltInModel, fields: CollectedField[], answers: readonly AnswerSpec[], signal?: AbortSignal): Promise<FieldMapping[]> {
    const prompt = buildMappingPrompt(fields, answers);
    let content: string;
    try {
      content = await this.ask(model, prompt.system, prompt.user, prompt.schema, signal);
    } catch (error) {
      if (!isQuotaError(error) || fields.length < 2) {
        throw toEngineError(error, "The form is too large for Chrome’s built-in model.");
      }
      const middle = Math.ceil(fields.length / 2);
      const first = await this.mapBatch(model, fields.slice(0, middle), answers, signal);
      const second = await this.mapBatch(model, fields.slice(middle), answers, signal);
      return [...first, ...second];
    }
    return parseMappingResponse(content, prompt.ids, prompt.keys);
  }

  async mapUploads(uploads: UploadField[], signal?: AbortSignal): Promise<UploadMapping[]> {
    const model = await this.ready();
    const prompt = buildUploadPrompt(uploads);
    let content: string;
    try {
      content = await this.ask(model, prompt.system, prompt.user, prompt.schema, signal);
    } catch (error) {
      throw toEngineError(error, "The form has too many uploads for Chrome’s built-in model.");
    }
    return parseUploadResponse(content, prompt.ids);
  }

  async summarizeForm(input: SummaryInput, signal?: AbortSignal): Promise<FormSummary | undefined> {
    const model = await this.ready();
    const prompt = buildSummaryPrompt(input);
    let content: string;
    try {
      content = await this.ask(model, prompt.system, prompt.user, prompt.schema, signal);
    } catch (error) {
      if (!isQuotaError(error) || !input.context.intro) {
        throw toEngineError(error, "The page is too large for Chrome’s built-in model.");
      }
      // The page text is the one part of the prompt that grows with the
      // page; the outline of the form alone still describes it.
      const shorter = buildSummaryPrompt({ ...input, context: { ...input.context, intro: "" } });
      try {
        content = await this.ask(model, shorter.system, shorter.user, shorter.schema, signal);
      } catch (retryError) {
        throw toEngineError(retryError, "The page is too large for Chrome’s built-in model.");
      }
    }
    return parseSummaryResponse(content);
  }

  /** The model, once it is there to ask; otherwise the reason it is not, as the panel will show it. */
  private async ready(): Promise<BuiltInModel> {
    if (!this.model) {
      throw new EngineError("model-unavailable", "This browser has no built-in model");
    }
    let availability: BuiltInAvailability;
    try {
      availability = await this.model.availability();
    } catch (error) {
      throw new EngineError("engine-error", errorText(error));
    }
    if (availability !== "available") {
      throw new EngineError("model-unavailable", unavailableMessage(availability));
    }
    return this.model;
  }

  /** One exchange in a fresh session, destroyed afterwards whatever happens. */
  private async ask(model: BuiltInModel, system: string, user: string, schema: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const session = await model.create(signal ? { system, signal } : { system });
    try {
      return await session.prompt(user, signal ? { schema, signal } : { schema });
    } finally {
      session.destroy();
    }
  }
}

/** The Prompt API rejects a prompt the context cannot hold with a QuotaExceededError. */
function isQuotaError(error: unknown): boolean {
  return error instanceof Error && error.name === "QuotaExceededError";
}

function toEngineError(error: unknown, quotaMessage: string): EngineError {
  if (error instanceof EngineError) {
    return error;
  }
  if (isQuotaError(error)) {
    return new EngineError("engine-error", quotaMessage);
  }
  return new EngineError("engine-error", errorText(error));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
