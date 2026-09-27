// Client for OpenAI-compatible local servers: LM Studio, llama.cpp server,
// oMLX, and anything else exposing /v1/models and /v1/chat/completions on
// localhost. An API key, when configured, goes out as a bearer token on every
// request, and is masked in any error text the server sends back. Mapping and the form summary each ask for a json_schema response
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
    private readonly apiKey = "",
  ) {
    // Accept endpoints pasted with or without the /v1 suffix.
    this.endpoint = endpoint.replace(/\/+$/, "").replace(/\/v1$/, "");
  }

  /** Request init with the bearer token, when there is one, and the abort signal. */
  private init(signal?: AbortSignal, init: RequestInit = {}): RequestInit {
    const headers = new Headers(init.headers);
    if (this.apiKey.length > 0) {
      headers.set("authorization", `Bearer ${this.apiKey}`);
    }
    return { ...init, headers, ...(signal ? { signal } : {}) };
  }

  /**
   * Server text with the API key masked: it reaches the panel's banners and
   * notes, and a server that echoes the key it rejected must not put it on
   * screen.
   */
  private mask(text: string): string {
    return this.apiKey.length > 0 ? text.split(this.apiKey).join("••••") : text;
  }

  private async errorDetail(response: Response): Promise<string> {
    return this.mask(await errorDetail(response));
  }

  async probe(signal?: AbortSignal): Promise<EngineStatus> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.endpoint}/v1/models`, this.init(signal));
    } catch (error) {
      return { state: "unreachable", detail: String(error) };
    }
    if (response.status === 401) {
      const detail = await this.errorDetail(response);
      return detail ? { state: "unauthorized", detail } : { state: "unauthorized" };
    }
    if (response.status === 403) {
      return { state: "forbidden" };
    }
    if (!response.ok) {
      return { state: "error", detail: `HTTP ${response.status}` };
    }
    let body: ModelsResponse;
    try {
      body = await readJson<ModelsResponse>(response);
    } catch (error) {
      return { state: "error", detail: (error as Error).message };
    }
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
    // oMLX only trims thinking for reasoning_effort "none" (measured on
    // Qwen3.8-27B: 173 reasoning characters instead of 242); a zero thinking
    // budget turns it off, and non-thinking models accept it.
    if (this.name === "omlx") {
      plain.thinking_budget = 0;
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
      throw statusError(response.status, await this.errorDetail(response));
    }
    const body = await readJson<ChatResponse>(response);
    if (body.error) {
      throw new EngineError("engine-error", this.mask(typeof body.error === "string" ? body.error : (body.error.message ?? "Unknown error")));
    }
    return body.choices?.[0]?.message?.content ?? "";
  }

  private async post(payload: unknown, signal?: AbortSignal): Promise<Response> {
    const init = this.init(signal, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    try {
      return await this.fetchFn(`${this.endpoint}/v1/chat/completions`, init);
    } catch (error) {
      throw new EngineError("engine-unreachable", String(error));
    }
  }
}

/**
 * The response body as JSON. A body that isn't JSON fails with a fixed
 * message: the parser's own error quotes the start of the body, which could
 * carry an echoed API key into the panel.
 */
async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new EngineError("engine-error", "The server sent a response that isn’t valid JSON.");
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
