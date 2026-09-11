import { describe, expect, it, vi } from "vitest";
import { builtInModelOf, downloadFraction } from "./built-in-model";

/** Node has no ProgressEvent; a plain event carrying the same fields is what the wrapper reads. */
function progressEvent(fields: { loaded?: number; total?: number }): Event {
  return Object.assign(new Event("downloadprogress"), fields);
}

function fakeApi(availability: LanguageModelAvailability, answer = "{}") {
  const session: LanguageModelSession = { prompt: vi.fn(async () => answer), destroy: vi.fn() };
  const api: LanguageModelStatic = {
    availability: vi.fn(async () => availability),
    create: vi.fn(async (options?: LanguageModelCreateOptions) => {
      const monitor = new EventTarget();
      options?.monitor?.(monitor);
      monitor.dispatchEvent(progressEvent({ loaded: 0.5, total: 1 }));
      return session;
    }),
  };
  return { api, session };
}

describe("builtInModelOf", () => {
  it("reports an old Chrome, without the global, as unavailable and refuses to create", async () => {
    const model = builtInModelOf(undefined);
    expect(await model.availability()).toBe("unavailable");
    await expect(model.create()).rejects.toThrow("no built-in model");
  });

  it("asks for text in and out, pins sampling, seats the system prompt first, and constrains the answer", async () => {
    const { api, session } = fakeApi("available", '{"ok":true}');
    const model = builtInModelOf(api);
    expect(await model.availability()).toBe("available");
    expect(api.availability).toHaveBeenCalledWith({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });

    const created = await model.create({ system: "Be terse." });
    const init = vi.mocked(api.create).mock.calls[0]![0]!;
    expect(init.initialPrompts).toEqual([{ role: "system", content: "Be terse." }]);
    expect(init).toMatchObject({ temperature: 0, topK: 1 });

    const schema = { type: "object" };
    expect(await created.prompt("Hi", { schema })).toBe('{"ok":true}');
    expect(session.prompt).toHaveBeenCalledWith("Hi", { responseConstraint: schema });
    created.destroy();
    expect(session.destroy).toHaveBeenCalledOnce();
  });

  it("passes the abort signal through and reports download progress", async () => {
    const { api, session } = fakeApi("downloadable");
    const model = builtInModelOf(api);
    const onProgress = vi.fn();
    const controller = new AbortController();
    const created = await model.create({ signal: controller.signal, onProgress });
    expect(vi.mocked(api.create).mock.calls[0]![0]!.signal).toBe(controller.signal);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    await created.prompt("x", { schema: {}, signal: controller.signal });
    expect(vi.mocked(session.prompt).mock.calls[0]![1]!.signal).toBe(controller.signal);
  });

  it("sends no system prompt when there is none", async () => {
    const { api } = fakeApi("available");
    await builtInModelOf(api).create();
    expect(vi.mocked(api.create).mock.calls[0]![0]!.initialPrompts).toBeUndefined();
  });
});

describe("downloadFraction", () => {
  it("reads a fraction as is and normalizes byte counts", () => {
    expect(downloadFraction(progressEvent({ loaded: 0.25 }))).toBe(0.25);
    expect(downloadFraction(progressEvent({ loaded: 1, total: 1 }))).toBe(1);
    expect(downloadFraction(progressEvent({ loaded: 500, total: 2000 }))).toBe(0.25);
    expect(downloadFraction(new Event("downloadprogress"))).toBe(0);
    expect(downloadFraction(progressEvent({ loaded: 3 }))).toBe(1);
  });
});
