// Client for OpenAI-compatible local servers: LM Studio, llama.cpp server,
// and anything else exposing /v1/models and /v1/chat/completions on
// localhost. Mapping and the form summary each ask for a json_schema response
// format; a server that rejects that (HTTP 400) is retried with a plain
// request, since core's parsers cope with prose around the JSON.

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
import type { EngineKind, EngineStatus } from "@offline-autofill/shared";
import { EngineError, SUMMARY_MAX_TOKENS, statusError, type ChatRequest, type EngineClient, type FetchFn } from "./types";

interface ModelsResponse {
  data?: { id?: string }[];
}

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string } | string;
}

export class OpenAiCompatEngine implements EngineClient {
  private readonly endpoint: string;

  constructor(
    readonly name: EngineKind,
    endpoint: string,
    private readonly model: string,
    // Bound: browsers throw "Illegal invocation" when fetch is called with a
    // `this` other than the global, which `this.fetchFn(...)` would do.
    private readonly fetchFn: FetchFn = globalThis.fetch.bind(globalThis),
  ) {
    // Accept endpoints pasted with or without the /v1 suffix.
    this.endpoint = endpoint.replace(/\/+$/, "").replace(/\/v1$/, "");
  }

  async probe(signal?: AbortSignal): Promise<EngineStatus> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.endpoint}/v1/models`, signal ? { signal } : {});
    } catch (error) {
      return { state: "unreachable", detail: String(error) };
    }
    if (response.status === 403) {
      return { state: "forbidden" };
    }
    if (!response.ok) {
      return { state: "error", detail: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as ModelsResponse;
    const models = (body.data ?? []).map((model) => model.id ?? "").filter((id) => id.length > 0);
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

  private async chat({ system, user, schema, schemaName, maxTokens }: ChatRequest, signal?: AbortSignal): Promise<string> {
    const plain: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
    };
    if (maxTokens !== undefined) {
      plain.max_tokens = maxTokens;
    }
    // LM Studio honors this for thinking models (reasoning tokens drop to
    // ~0) and ignores it otherwise. Only sent to LM Studio: other servers
    // may reject fields they don't know.
    if (this.name === "lmstudio") {
      plain.reasoning_effort = "none";
    }
    const structured = {
      ...plain,
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      },
    };
    let response = await this.post(structured, signal);
    if (response.status === 400) {
      response = await this.post(plain, signal);
    }
    if (!response.ok) {
      throw statusError(response.status, await errorDetail(response));
    }
    const body = (await response.json()) as ChatResponse;
    if (body.error) {
      throw new EngineError("engine-error", typeof body.error === "string" ? body.error : (body.error.message ?? "Unknown error"));
    }
    return body.choices?.[0]?.message?.content ?? "";
  }

  private async post(payload: unknown, signal?: AbortSignal): Promise<Response> {
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    };
    if (signal) {
      init.signal = signal;
    }
    try {
      return await this.fetchFn(`${this.endpoint}/v1/chat/completions`, init);
    } catch (error) {
      throw new EngineError("engine-unreachable", String(error));
    }
  }
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string };
    if (typeof body.error === "string") {
      return body.error;
    }
    return body.error?.message ?? "";
  } catch {
    return "";
  }
}
