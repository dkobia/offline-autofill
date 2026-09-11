import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, availableEngines, defaultSettings, isLocalEndpoint, isModelAvailable, modelSelected, normalizeSettings } from "./settings";

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
      normalizeSettings({ engine: "lmstudio", endpoint: "http://localhost:1234/", model: " x ", useModel: false, overwrite: true, summary: false }),
    ).toEqual({ engine: "lmstudio", endpoint: "http://localhost:1234", model: "x", useModel: false, overwrite: true, summary: false });
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
    expect(availableEngines(true)).toEqual(["builtin", "ollama", "lmstudio", "llamacpp", "custom"]);
    expect(availableEngines(false)).toEqual(["ollama", "lmstudio", "llamacpp", "custom"]);
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
