import type { CollectedField, SummaryInput, UploadField } from "@offline-autofill/core";
import { describe, expect, it, vi } from "vitest";
import type { BuiltInAvailability, BuiltInModel, BuiltInSession } from "../../platform/types";
import { BuiltInEngine } from "./built-in";
import { createEngineClient } from "./index";

const fields: CollectedField[] = [
  { ref: "#a", tag: "input", type: "text", visible: true, editable: true, hasValue: false, label: "Preferred pronouns" },
  { ref: "#b", tag: "textarea", type: "text", visible: true, editable: true, hasValue: false, label: "Duties" },
  { ref: "#c", tag: "input", type: "text", visible: true, editable: true, hasValue: false, label: "Website" },
];

const uploads: UploadField[] = [{ ref: "#f", label: "Resume", editable: true, hasValue: false }];

const summaryInput: SummaryInput = {
  context: { title: "Apply", headings: ["Apply now"], intro: "Tell us about yourself.", buttons: ["Submit"], submit: "Submit", uploads: ["Resume"], blockedUploads: [] },
  fields,
  blocked: ["password"],
};

interface Exchange {
  system: string | undefined;
  user: string;
  schema: Record<string, unknown>;
  signal: AbortSignal | undefined;
}

function quotaError(): Error {
  const error = new Error("The input is too large");
  error.name = "QuotaExceededError";
  return error;
}

/** A model that answers each prompt from `answer` and records every exchange and destroy. */
function fakeModel(availability: BuiltInAvailability, answer: (exchange: Exchange) => string | Error) {
  const exchanges: Exchange[] = [];
  let destroyed = 0;
  const model: BuiltInModel = {
    availability: vi.fn(async () => availability),
    create: vi.fn(async (options = {}): Promise<BuiltInSession> => {
      return {
        prompt: async (user, { schema, signal }) => {
          const exchange: Exchange = { system: options.system, user, schema, signal };
          exchanges.push(exchange);
          const result = answer(exchange);
          if (result instanceof Error) {
            throw result;
          }
          return result;
        },
        destroy: () => void destroyed++,
      };
    }),
  };
  return { model, exchanges, destroyed: () => destroyed };
}

describe("BuiltInEngine", () => {
  it("probes the browser's availability into engine states", async () => {
    expect(await new BuiltInEngine(undefined).probe()).toEqual({ state: "unsupported" });
    for (const [availability, state] of [
      ["available", { state: "ok", models: ["Gemini Nano"] }],
      ["downloadable", { state: "downloadable" }],
      ["downloading", { state: "downloading" }],
      ["unavailable", { state: "unsupported" }],
    ] as const) {
      expect(await new BuiltInEngine(fakeModel(availability, () => "{}").model).probe()).toEqual(state);
    }
    const failing: BuiltInModel = { availability: async () => Promise.reject(new Error("boom")), create: vi.fn() };
    expect(await new BuiltInEngine(failing).probe()).toEqual({ state: "error", detail: "boom" });
  });

  it("maps fields in one session: system prompt first, the user prompt constrained to the schema, then destroy", async () => {
    const { model, exchanges, destroyed } = fakeModel("available", () => '{"mappings":[{"field":"f2","key":"employment.description","entry":0}]}');
    const engine = new BuiltInEngine(model);
    const signal = new AbortController().signal;
    const mappings = await engine.mapFields(fields, { signal });
    expect(mappings).toEqual([{ ref: "#b", key: "employment.description", entry: 0, source: "model", confidence: 0.6 }]);
    expect(exchanges).toHaveLength(1);
    const [exchange] = exchanges;
    expect(exchange!.system).toContain("fixed profile vocabulary");
    expect(exchange!.user).toContain("Preferred pronouns");
    expect(exchange!.user).not.toContain("#a");
    expect((exchange!.schema as { required: string[] }).required).toEqual(["mappings"]);
    expect(exchange!.signal).toBe(signal);
    expect(vi.mocked(model.create).mock.calls[0]![0]).toMatchObject({ signal });
    expect(destroyed()).toBe(1);
  });

  it("splits a mapping the context cannot hold and reads each half by its own ids", async () => {
    const { model, exchanges, destroyed } = fakeModel("available", ({ user }) => {
      const count = user.split("\n").filter((line) => line.startsWith('{"id":"f')).length;
      if (count > 1) {
        return quotaError();
      }
      // Each half is numbered from f1 again; the answer names the one field it was asked about.
      return user.includes("Duties") ? '{"mappings":[{"field":"f1","key":"employment.description","entry":0}]}' : '{"mappings":[{"field":"f1","key":null}]}';
    });
    const mappings = await new BuiltInEngine(model).mapFields(fields);
    expect(mappings).toEqual([{ ref: "#b", key: "employment.description", entry: 0, source: "model", confidence: 0.6 }]);
    // 3 fields: one refused, split into 2 + 1; the 2 refused again and split into 1 + 1.
    expect(exchanges).toHaveLength(5);
    expect(destroyed()).toBe(5);
  });

  it("reports a single field that still does not fit instead of dropping it", async () => {
    const { model } = fakeModel("available", () => quotaError());
    await expect(new BuiltInEngine(model).mapFields(fields.slice(0, 1))).rejects.toMatchObject({
      code: "engine-error",
      message: "The form is too large for Chrome’s built-in model.",
    });
  });

  it("refuses with model-unavailable until the model is there, without creating a session", async () => {
    for (const [availability, message] of [
      ["downloadable", "Chrome’s built-in model isn’t downloaded yet"],
      ["downloading", "Chrome is still downloading its built-in model"],
      ["unavailable", "Chrome’s built-in model isn’t available on this device"],
    ] as const) {
      const { model } = fakeModel(availability, () => "{}");
      await expect(new BuiltInEngine(model).mapFields(fields)).rejects.toMatchObject({ code: "model-unavailable", message });
      await expect(new BuiltInEngine(model).summarizeForm(summaryInput)).rejects.toMatchObject({ code: "model-unavailable", message });
      expect(model.create).not.toHaveBeenCalled();
    }
    await expect(new BuiltInEngine(undefined).mapUploads(uploads)).rejects.toMatchObject({ code: "model-unavailable" });
  });

  it("maps uploads to document kinds", async () => {
    const { model, exchanges } = fakeModel("available", () => '{"mappings":[{"upload":"u1","kind":"resume"}]}');
    expect(await new BuiltInEngine(model).mapUploads(uploads)).toEqual([{ ref: "#f", kind: "resume", source: "model", confidence: 0.6 }]);
    expect(exchanges[0]!.user).toContain("Resume");
  });

  it("summarizes the form, and asks again without the page text when it does not fit", async () => {
    const { model, exchanges } = fakeModel("available", ({ user }) =>
      user.includes("Tell us about yourself.") ? quotaError() : '{"purpose":"A job application.","howTo":["Fill in your details"],"notes":[]}',
    );
    expect(await new BuiltInEngine(model).summarizeForm(summaryInput)).toEqual({ purpose: "A job application.", howTo: ["Fill in your details"], notes: [] });
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0]!.user).toContain("Page text:");
    expect(exchanges[1]!.user).not.toContain("Page text:");
    expect(exchanges[1]!.user).toContain("Page title: Apply");
    expect(exchanges[1]!.user).toContain("a password");
  });

  it("gives up on a summary that does not fit even without the page text", async () => {
    const { model, exchanges } = fakeModel("available", () => quotaError());
    await expect(new BuiltInEngine(model).summarizeForm(summaryInput)).rejects.toMatchObject({
      code: "engine-error",
      message: "The page is too large for Chrome’s built-in model.",
    });
    expect(exchanges).toHaveLength(2);
  });

  it("returns undefined for an unusable summary answer and wraps other failures", async () => {
    const { model } = fakeModel("available", () => "no json here");
    expect(await new BuiltInEngine(model).summarizeForm(summaryInput)).toBeUndefined();
    const { model: broken } = fakeModel("available", () => new Error("model crashed"));
    await expect(new BuiltInEngine(broken).mapFields(fields)).rejects.toMatchObject({ code: "engine-error", message: "model crashed" });
  });
});

describe("createEngineClient", () => {
  it("builds the built-in engine without touching the endpoint", () => {
    const { model } = fakeModel("available", () => "{}");
    const settings = { engine: "builtin" as const, endpoint: "https://not-local.example", model: "", useModel: true, overwrite: false, summary: true };
    expect(createEngineClient(settings, { builtIn: model })).toBeInstanceOf(BuiltInEngine);
    expect(createEngineClient(settings).name).toBe("builtin");
  });
});
