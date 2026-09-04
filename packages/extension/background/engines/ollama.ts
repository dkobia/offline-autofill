// Client for Ollama's native API (http://localhost:11434 by default).
// Probing lists models with GET /api/tags; mapping and the form summary are
// each one non-streaming POST /api/chat whose `format` is the JSON schema
// core builds, so the model can only answer in the shape core expects. A 403
// means Ollama is running but rejects the extension's origin, which the UI
// turns into OLLAMA_ORIGINS instructions.

import {
  buildMappingPrompt,
  buildSummaryPrompt,
  buildUploadPrompt,
  parseMappingResponse,
  parseSummaryResponse,
  parseUploadResponse,
  type CollectedField,
  type FieldMapping,
  type MapFieldsOptions,
  type FormSummary,
  type SummaryInput,
  type UploadField,
  type UploadMapping,
} from "@offline-autofill/core";
import type { EngineStatus } from "@offline-autofill/shared";
import { EngineError, SUMMARY_MAX_TOKENS, statusError, type ChatRequest, type EngineClient, type FetchFn } from "./types";

interface OllamaTagsResponse {
  models?: { name?: string }[];
}

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

export class OllamaEngine implements EngineClient {
  readonly name = "ollama";

  constructor(
    private readonly endpoint: string,
    private readonly model: string,
    // Bound: browsers throw "Illegal invocation" when fetch is called with a
    // `this` other than the global, which `this.fetchFn(...)` would do.
    private readonly fetchFn: FetchFn = globalThis.fetch.bind(globalThis),
  ) {}

  async probe(signal?: AbortSignal): Promise<EngineStatus> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.endpoint}/api/tags`, signal ? { signal } : {});
    } catch (error) {
      return { state: "unreachable", detail: String(error) };
    }
    if (response.status === 403) {
      return { state: "forbidden" };
    }
    if (!response.ok) {
      return { state: "error", detail: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as OllamaTagsResponse;
    const models = (body.models ?? []).map((model) => model.name ?? "").filter((name) => name.length > 0);
    return { state: "ok", models };
  }

  async mapFields(fields: CollectedField[], options: MapFieldsOptions = {}): Promise<FieldMapping[]> {
    const prompt = buildMappingPrompt(fields, options.answers ?? []);
    const content = await this.chat({ system: prompt.system, user: prompt.user, schema: prompt.schema, schemaName: "field_mappings" }, options.signal);
    return parseMappingResponse(content, prompt.ids, prompt.keys);
  }

  async mapUploads(uploads: UploadField[], signal?: AbortSignal): Promise<UploadMapping[]> {
    const prompt = buildUploadPrompt(uploads);
    const content = await this.chat({ system: prompt.system, user: prompt.user, schema: prompt.schema, schemaName: "upload_mappings" }, signal);
    return parseUploadResponse(content, prompt.ids);
  }

  async summarizeForm(input: SummaryInput, signal?: AbortSignal): Promise<FormSummary | undefined> {
    const prompt = buildSummaryPrompt(input);
    const content = await this.chat({ ...prompt, schemaName: "form_summary", maxTokens: SUMMARY_MAX_TOKENS }, signal);
    return parseSummaryResponse(content);
  }

  private async chat({ system, user, schema, maxTokens }: ChatRequest, signal?: AbortSignal): Promise<string> {
    const options: Record<string, number> = { temperature: 0 };
    if (maxTokens !== undefined) {
      options.num_predict = maxTokens;
    }
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
        format: schema,
        // Thinking models otherwise spend their budget reasoning and answer
        // with nothing; non-thinking models ignore the flag.
        think: false,
        options,
      }),
    };
    if (signal) {
      init.signal = signal;
    }
    let response: Response;
    try {
      response = await this.fetchFn(`${this.endpoint}/api/chat`, init);
    } catch (error) {
      throw new EngineError("engine-unreachable", String(error));
    }
    if (!response.ok) {
      throw statusError(response.status, await errorDetail(response));
    }
    const body = (await response.json()) as OllamaChatResponse;
    if (body.error) {
      throw new EngineError("engine-error", body.error);
    }
    return body.message?.content ?? "";
  }
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : "";
  } catch {
    return "";
  }
}
