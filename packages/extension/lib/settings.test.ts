import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isLocalEndpoint, isModelAvailable, normalizeSettings } from "./settings";

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
});

describe("isModelAvailable", () => {
  it("resolves bare Ollama names to :latest and trusts empty lists", () => {
    expect(isModelAvailable("llama3.2", ["llama3.2:latest"], "ollama")).toBe(true);
    expect(isModelAvailable("llama3.2", ["llama3.2:latest"], "lmstudio")).toBe(false);
    expect(isModelAvailable("anything", [], "custom")).toBe(true);
    expect(isModelAvailable("x", ["y"], "ollama")).toBe(false);
  });
});
