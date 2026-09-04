import type { CollectedField, SummaryInput, UploadField } from "@offline-autofill/core";
import { describe, expect, it, vi } from "vitest";
import { createEngineClient, EngineError } from "./index";
import { OllamaEngine } from "./ollama";
import { OpenAiCompatEngine } from "./openai-compat";
import type { FetchFn } from "./types";

const fields: CollectedField[] = [
  { ref: "#a", tag: "input", type: "text", visible: true, editable: true, hasValue: false, label: "Preferred pronouns" },
  { ref: "#b", tag: "textarea", type: "text", visible: true, editable: true, hasValue: false, label: "Duties" },
];

const summaryInput: SummaryInput = {
  context: { title: "Apply", headings: ["Apply now"], intro: "Tell us about yourself.", buttons: ["Submit"], submit: "Submit", uploads: ["Resume"], blockedUploads: [] },
  fields,
  blocked: ["password"],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("OllamaEngine", () => {
  it("probes model tags and reports forbidden origins", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValueOnce(json(200, { models: [{ name: "llama3.2:latest" }] }));
    const engine = new OllamaEngine("http://localhost:11434", "llama3.2", fetchFn);
    expect(await engine.probe()).toEqual({ state: "ok", models: ["llama3.2:latest"] });
    expect(fetchFn.mock.calls[0]![0]).toBe("http://localhost:11434/api/tags");

    fetchFn.mockResolvedValueOnce(new Response("", { status: 403 }));
    expect(await engine.probe()).toEqual({ state: "forbidden" });
    fetchFn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await engine.probe()).state).toBe("unreachable");
  });

  it("sends the schema-constrained chat request and parses the mapping", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValueOnce(
      json(200, { message: { content: '{"mappings":[{"field":"f2","key":"employment.description","entry":0}]}' } }),
    );
    const engine = new OllamaEngine("http://localhost:11434", "llama3.2", fetchFn);
    const mappings = await engine.mapFields(fields);
    expect(mappings).toEqual([{ ref: "#b", key: "employment.description", entry: 0, source: "model", confidence: 0.6 }]);

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/api/chat");
    const payload = JSON.parse(init!.body as string);
    expect(payload.model).toBe("llama3.2");
    expect(payload.stream).toBe(false);
    expect(payload.format.properties.mappings.items.properties.field.enum).toEqual(["f1", "f2"]);
    expect(payload.options.temperature).toBe(0);
    expect(payload.messages[1].content).toContain("Preferred pronouns");
    expect(payload.messages[1].content).not.toContain("#a");
  });

  it("asks for the form summary with a generation cap and reads it back", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValueOnce(
      json(200, { message: { content: '{"purpose":"A job application.","howTo":["Fill in your details"],"notes":[]}' } }),
    );
    const engine = new OllamaEngine("http://localhost:11434", "llama3.2", fetchFn);
    expect(await engine.summarizeForm(summaryInput)).toEqual({ purpose: "A job application.", howTo: ["Fill in your details"], notes: [] });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/api/chat");
    const payload = JSON.parse(init!.body as string);
    expect(payload.stream).toBe(false);
    expect(payload.think).toBe(false);
    expect(payload.format.required).toEqual(["purpose", "howTo", "notes"]);
    expect(payload.options).toEqual({ temperature: 0, num_predict: 4096 });
    expect(payload.messages[1].content).toContain("Page title: Apply");
    expect(payload.messages[1].content).toContain("a password");
  });

  it("returns undefined for an unusable summary answer and keeps mapping uncapped", async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(json(200, { message: { content: "no json here" } }))
      .mockResolvedValueOnce(json(200, { message: { content: '{"mappings":[]}' } }));
    const engine = new OllamaEngine("http://localhost:11434", "llama3.2", fetchFn);
    expect(await engine.summarizeForm(summaryInput)).toBeUndefined();
    await engine.mapFields(fields);
    expect(JSON.parse(fetchFn.mock.calls[1]![1]!.body as string).options).toEqual({ temperature: 0 });
  });

  it("maps HTTP failures onto engine error codes", async () => {
    const fetchFn = vi.fn<FetchFn>();
    const engine = new OllamaEngine("http://localhost:11434", "nope", fetchFn);
    fetchFn.mockResolvedValueOnce(json(404, { error: "model 'nope' not found" }));
    await expect(engine.mapFields(fields)).rejects.toMatchObject({ code: "model-missing", message: "model 'nope' not found" });
    fetchFn.mockResolvedValueOnce(new Response("", { status: 403 }));
    await expect(engine.mapFields(fields)).rejects.toMatchObject({ code: "origin-forbidden" });
    fetchFn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(engine.mapFields(fields)).rejects.toMatchObject({ code: "engine-unreachable" });
    fetchFn.mockResolvedValueOnce(json(200, { error: "out of memory" }));
    await expect(engine.mapFields(fields)).rejects.toMatchObject({ code: "engine-error", message: "out of memory" });
  });
});

describe("OpenAiCompatEngine", () => {
  it("probes /v1/models", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValueOnce(json(200, { data: [{ id: "qwen2.5-7b" }] }));
    const engine = new OpenAiCompatEngine("lmstudio", "http://localhost:1234/v1", "qwen2.5-7b", fetchFn);
    expect(await engine.probe()).toEqual({ state: "ok", models: ["qwen2.5-7b"] });
    expect(fetchFn.mock.calls[0]![0]).toBe("http://localhost:1234/v1/models");
  });

  it("asks for a json_schema response and reads choices", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValueOnce(
      json(200, { choices: [{ message: { content: '{"mappings":[{"field":"f1","key":null}]}' } }] }),
    );
    const engine = new OpenAiCompatEngine("llamacpp", "http://localhost:8080", "local", fetchFn);
    expect(await engine.mapFields(fields)).toEqual([]);
    const payload = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    expect(payload.response_format.type).toBe("json_schema");
    expect(payload.response_format.json_schema.schema.required).toEqual(["mappings"]);
  });

  it("puts the saved questions in the prompt and accepts their keys back", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValueOnce(
      json(200, { choices: [{ message: { content: '{"mappings":[{"field":"f1","key":"answer.a1"},{"field":"f2","key":"answer.zz"}]}' } }] }),
    );
    const engine = new OpenAiCompatEngine("llamacpp", "http://localhost:8080", "local", fetchFn);
    const mappings = await engine.mapFields(fields, { answers: [{ key: "answer.a1", question: "Desired salary" }] });
    expect(mappings).toEqual([{ ref: "#a", key: "answer.a1", entry: 0, source: "model", confidence: 0.6 }]);
    const payload = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    expect(JSON.stringify(payload.messages)).toContain("answer.a1");
    expect(JSON.stringify(payload.messages)).toContain("Desired salary");
    expect(payload.response_format.json_schema.schema.properties.mappings.items.properties.key.anyOf[0].enum).toContain("answer.a1");
  });

  it("caps summary generation and asks LM Studio to skip reasoning", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValueOnce(
      json(200, { choices: [{ message: { content: '{"purpose":"Checkout.","howTo":[],"notes":["Ships worldwide"]}' } }] }),
    );
    const engine = new OpenAiCompatEngine("lmstudio", "http://localhost:1234", "local", fetchFn);
    expect(await engine.summarizeForm(summaryInput)).toEqual({ purpose: "Checkout.", howTo: [], notes: ["Ships worldwide"] });
    const payload = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    expect(payload.max_tokens).toBe(4096);
    expect(payload.reasoning_effort).toBe("none");
    expect(payload.response_format.json_schema.name).toBe("form_summary");
  });

  it("sends no cap and no reasoning flag for mapping on other servers", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValueOnce(json(200, { choices: [{ message: { content: '{"mappings":[]}' } }] }));
    const engine = new OpenAiCompatEngine("llamacpp", "http://localhost:8080", "local", fetchFn);
    await engine.mapFields(fields);
    const payload = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    expect(payload.max_tokens).toBeUndefined();
    expect(payload.reasoning_effort).toBeUndefined();
  });

  it("retries without response_format when the server rejects it", async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(json(400, { error: { message: "response_format not supported" } }))
      .mockResolvedValueOnce(json(200, { choices: [{ message: { content: 'Sure: {"mappings":[{"field":"f1","key":"contact.email"}]}' } }] }));
    const engine = new OpenAiCompatEngine("custom", "http://localhost:8080", "local", fetchFn);
    const mappings = await engine.mapFields(fields);
    expect(mappings.map((m) => m.key)).toEqual(["contact.email"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchFn.mock.calls[1]![1]!.body as string).response_format).toBeUndefined();
  });
});

describe("createEngineClient", () => {
  it("refuses non-local endpoints even if storage was tampered with", () => {
    expect(() =>
      createEngineClient({ engine: "ollama", endpoint: "https://api.example.com", model: "x", useModel: true, overwrite: false, summary: true }),
    ).toThrow(EngineError);
  });

  it("picks the client by engine kind", () => {
    const base = { endpoint: "http://localhost:1", model: "m", useModel: true, overwrite: false, summary: true } as const;
    expect(createEngineClient({ ...base, engine: "ollama" })).toBeInstanceOf(OllamaEngine);
    expect(createEngineClient({ ...base, engine: "lmstudio" })).toBeInstanceOf(OpenAiCompatEngine);
    expect(createEngineClient({ ...base, engine: "lmstudio" }).name).toBe("lmstudio");
  });
});

describe("upload mapping", () => {
  const uploads: UploadField[] = [{ ref: "#cv", label: "Lebenslauf", accept: ".pdf", editable: true, hasValue: false }];

  it("Ollama asks with the kind schema and reads the answer back", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValueOnce(json(200, { message: { content: '{"mappings":[{"upload":"u1","kind":"resume"}]}' } }));
    const engine = new OllamaEngine("http://localhost:11434", "llama3.2", fetchFn);
    expect(await engine.mapUploads(uploads)).toEqual([{ ref: "#cv", kind: "resume", source: "model", confidence: 0.6 }]);
    const payload = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    expect(payload.format.properties.mappings.items.properties.upload.enum).toEqual(["u1"]);
    expect(payload.format.properties.mappings.items.properties.kind.anyOf[0].enum).toContain("resume");
    expect(payload.options).toEqual({ temperature: 0 });
    expect(payload.messages[1].content).toContain("Lebenslauf");
    expect(payload.messages[1].content).not.toContain("#cv");
  });

  it("OpenAI-compatible servers get the same request as a json_schema response format", async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(json(200, { choices: [{ message: { content: '{"mappings":[{"upload":"u1","kind":"coverLetter"}]}' } }] }));
    const engine = new OpenAiCompatEngine("lmstudio", "http://localhost:1234", "m", fetchFn);
    expect(await engine.mapUploads(uploads)).toEqual([{ ref: "#cv", kind: "coverLetter", source: "model", confidence: 0.6 }]);
    const payload = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    expect(payload.response_format.json_schema.name).toBe("upload_mappings");
    expect(payload.max_tokens).toBeUndefined();
  });
});
