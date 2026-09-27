import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, acceptsApiKey, availableEngines, endpointAfterSwitch, defaultSettings, isLocalEndpoint, isModelAvailable, modelSelected, normalizeSettings } from "./settings";

describe("isLocalEndpoint", () => {
  it.each([
    ["http://localhost:11434", true],
    ["http://127.0.0.1:8080", true],
    ["https://localhost", true],
    ["http://[::1]:11434", false],
    ["http://ollama.example.com", false],
    ["http://localhost.evil.com", false],
    ["ftp://localhost", false],
    ["not a url", false],
  ])("%s -> %s", (endpoint, expected) => {
    expect(isLocalEndpoint(endpoint)).toBe(expected);
  });
});

describe("normalizeSettings", () => {
  it("returns defaults for garbage", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ engine: "cloud", endpoint: "https://api.example.com" })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and trims trailing slashes", () => {
    expect(
      normalizeSettings({ engine: "lmstudio", endpoint: "http://localhost:1234/", model: " x ", apiKey: "k", useModel: false, overwrite: true, summary: false }),
    ).toEqual({ engine: "lmstudio", endpoint: "http://localhost:1234", model: "x", apiKey: "k", useModel: false, overwrite: true, summary: false });
  });

  it("defaults oMLX to the address it listens on", () => {
    expect(normalizeSettings({ engine: "omlx" }).endpoint).toBe("http://127.0.0.1:8000");
  });

  it("keeps a trimmed API key only for engines that take one", () => {
    expect(normalizeSettings({ engine: "omlx", apiKey: "  key  " }).apiKey).toBe("key");
    expect(normalizeSettings({ engine: "llamacpp", apiKey: "key" }).apiKey).toBe("key");
    expect(normalizeSettings({ engine: "ollama", apiKey: "key" }).apiKey).toBe("");
    expect(normalizeSettings({ engine: "builtin", apiKey: "key" }).apiKey).toBe("");
    expect(normalizeSettings({ engine: "omlx", apiKey: 42 }).apiKey).toBe("");
    expect(normalizeSettings({ engine: "omlx" }).apiKey).toBe("");
  });

  it("replaces a remote endpoint with the engine's local default", () => {
    expect(normalizeSettings({ engine: "llamacpp", endpoint: "https://remote.example" }).endpoint).toBe("http://localhost:8080");
  });

  it("falls back to the platform's defaults, and keeps a saved engine whatever they are", () => {
    const builtIn = defaultSettings(true);
    expect(normalizeSettings(undefined, builtIn)).toEqual(builtIn);
    expect(normalizeSettings({ engine: "cloud" }, builtIn).engine).toBe("builtin");
    expect(normalizeSettings({ engine: "ollama", model: "llama3.2" }, builtIn)).toMatchObject({ engine: "ollama", model: "llama3.2" });
    expect(normalizeSettings({ engine: "builtin" })).toMatchObject({ engine: "builtin", endpoint: "http://localhost:11434" });
  });
});

describe("defaultSettings", () => {
  it("is the built-in model where the browser has one and Ollama elsewhere", () => {
    expect(defaultSettings(true)).toEqual({ ...DEFAULT_SETTINGS, engine: "builtin" });
    expect(defaultSettings(false)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("availableEngines", () => {
  it("offers the built-in model first, and only where the browser has one", () => {
    expect(availableEngines(true)).toEqual(["builtin", "ollama", "lmstudio", "llamacpp", "omlx", "custom"]);
    expect(availableEngines(false)).toEqual(["ollama", "lmstudio", "llamacpp", "omlx", "custom"]);
  });
});

describe("endpointAfterSwitch", () => {
  it("swaps a default endpoint for the new engine's, there and back", () => {
    const toOllama = endpointAfterSwitch("http://127.0.0.1:8000", "omlx", "ollama");
    expect(toOllama).toBe("http://localhost:11434");
    expect(endpointAfterSwitch(toOllama, "ollama", "omlx")).toBe("http://127.0.0.1:8000");
    expect(endpointAfterSwitch("", "custom", "lmstudio")).toBe("http://localhost:1234");
  });

  it("keeps an address the user typed", () => {
    expect(endpointAfterSwitch("http://localhost:9000", "custom", "omlx")).toBe("http://localhost:9000");
  });
});

describe("acceptsApiKey", () => {
  it("is the OpenAI-compatible servers: not Ollama, which has no auth, nor the built-in model", () => {
    for (const engine of ["omlx", "lmstudio", "llamacpp", "custom"] as const) {
      expect(acceptsApiKey(engine)).toBe(true);
    }
    expect(acceptsApiKey("ollama")).toBe(false);
    expect(acceptsApiKey("builtin")).toBe(false);
  });
});

describe("modelSelected", () => {
  it("needs the switch on, and a model name only for a server", () => {
    expect(modelSelected(defaultSettings(true))).toBe(true);
    expect(modelSelected({ ...defaultSettings(true), useModel: false })).toBe(false);
    expect(modelSelected(DEFAULT_SETTINGS)).toBe(false);
    expect(modelSelected({ ...DEFAULT_SETTINGS, model: "llama3.2" })).toBe(true);
  });
});

describe("isModelAvailable", () => {
  it("resolves bare Ollama names to :latest and trusts empty lists", () => {
    expect(isModelAvailable("llama3.2", ["llama3.2:latest"], "ollama")).toBe(true);
    expect(isModelAvailable("llama3.2", ["llama3.2:latest"], "lmstudio")).toBe(false);
    expect(isModelAvailable("anything", [], "custom")).toBe(true);
    expect(isModelAvailable("x", ["y"], "ollama")).toBe(false);
  });
});
