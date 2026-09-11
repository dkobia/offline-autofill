import type { Settings } from "@offline-autofill/shared";
import { describe, expect, it } from "vitest";
import { describeStatusShort, effectiveStatus, statusView } from "./status-view";

const settings: Settings = { engine: "ollama", endpoint: "http://localhost:11434", model: "llama3.2", useModel: true, overwrite: false, summary: true };

describe("statusView", () => {
  it("is ready when the model is listed", () => {
    expect(statusView(settings, { state: "ok", models: ["llama3.2:latest"] }, "chrome")).toEqual({
      dot: "ok",
      label: "Ready",
      banner: null,
    });
  });

  it("reports rules-only when the model is switched off, whatever the engine does", () => {
    const view = statusView({ ...settings, useModel: false }, { state: "unreachable" }, "chrome");
    expect(view).toEqual({ dot: "ok", label: "Rules only", banner: null });
  });

  it("shows a probing dot before the first probe answers", () => {
    expect(statusView(settings, null, "chrome").dot).toBe("probing");
  });

  it("warns, never blocks, when the engine is down", () => {
    const view = statusView(settings, { state: "unreachable", detail: "ECONNREFUSED" }, "firefox");
    expect(view.dot).toBe("warn");
    expect(view.label).toBe("Rules only");
    expect(view.banner?.tone).toBe("warn");
    expect(view.banner?.title).toContain("isn’t reachable");
    expect(view.banner?.showRetry).toBe(true);
    const text = JSON.stringify(view.banner);
    expect(text).toContain("OLLAMA_ORIGINS");
    expect(text).toContain("built-in rules");
    expect(text).toContain("localhost under the extension");
    expect(text).toContain("ECONNREFUSED");
  });

  it("explains forbidden origins for Ollama and generically for others", () => {
    expect(JSON.stringify(statusView(settings, { state: "forbidden" }, "chrome").banner)).toContain("ollama serve");
    const other = statusView({ ...settings, engine: "lmstudio" }, { state: "forbidden" }, "chrome");
    expect(JSON.stringify(other.banner)).toContain("HTTP 403");
  });

  it("asks for a model when none is set or the set one is missing", () => {
    expect(statusView({ ...settings, model: "" }, { state: "ok", models: ["x"] }, "chrome").label).toBe("No model");
    const missing = statusView(settings, { state: "ok", models: ["mistral"] }, "chrome");
    expect(missing.label).toBe("Check model");
    expect(JSON.stringify(missing.banner)).toContain("ollama pull llama3.2");
  });
});

describe("statusView for the built-in model", () => {
  const builtIn: Settings = { ...settings, engine: "builtin", model: "" };

  it("is ready without a model name", () => {
    expect(statusView(builtIn, { state: "ok", models: ["Gemini Nano"] }, "chrome")).toEqual({ dot: "ok", label: "Ready", banner: null });
  });

  it("offers the download when the model is not there yet", () => {
    const view = statusView(builtIn, { state: "downloadable" }, "chrome");
    expect(view.dot).toBe("warn");
    expect(view.label).toBe("No model");
    expect(view.banner?.title).toContain("isn’t downloaded yet");
    expect(view.banner?.showDownload).toBe(true);
    expect(view.banner?.showRetry).toBe(false);
    expect(JSON.stringify(view.banner)).toContain("built-in rules");
  });

  it("shows progress for a download this panel started, and a recheck for one it did not", () => {
    const own = statusView(builtIn, { state: "downloading", progress: 0.426 }, "chrome");
    expect(own.dot).toBe("probing");
    expect(own.label).toBe("Downloading 42%");
    expect(own.banner?.showRetry).toBe(false);
    expect(own.banner?.showDownload).toBe(false);
    expect(JSON.stringify(own.banner)).toContain("42% downloaded");

    const other = statusView(builtIn, { state: "downloading" }, "chrome");
    expect(other.label).toBe("Downloading");
    expect(other.banner?.showRetry).toBe(true);
  });

  it("explains an unsupported device and points at the servers", () => {
    const view = statusView(builtIn, { state: "unsupported" }, "chrome");
    expect(view.dot).toBe("warn");
    expect(view.label).toBe("Rules only");
    expect(view.banner?.showRetry).toBe(true);
    const text = JSON.stringify(view.banner);
    expect(text).toContain("Chrome 138");
    expect(text).toContain("22 GB");
    expect(text).toContain("Ollama");
    expect(text).toContain("built-in rules");
  });

  it("still reports an error from the browser", () => {
    const view = statusView(builtIn, { state: "error", detail: "boom" }, "chrome");
    expect(view.banner?.title).toContain("returned an error");
    expect(JSON.stringify(view.banner)).toContain("boom");
  });
});

describe("effectiveStatus", () => {
  const builtIn: Settings = { ...settings, engine: "builtin", model: "" };
  const probed = { state: "downloadable" as const };

  it("lets a running download own the built-in engine's status, and its failure too", () => {
    expect(effectiveStatus(builtIn, probed, { progress: 0.3 })).toEqual({ state: "downloading", progress: 0.3 });
    expect(effectiveStatus(builtIn, null, { progress: 0 })).toEqual({ state: "downloading", progress: 0 });
    expect(effectiveStatus(builtIn, probed, { failed: "NetworkError" })).toEqual({ state: "error", detail: "NetworkError" });
  });

  it("shows the probe when nothing is downloading, or when a server is selected mid-download", () => {
    expect(effectiveStatus(builtIn, probed, null)).toBe(probed);
    expect(effectiveStatus(builtIn, null, null)).toBeNull();
    const ollama = { state: "unreachable" as const };
    expect(effectiveStatus(settings, ollama, { progress: 0.5 })).toBe(ollama);
    expect(effectiveStatus(settings, null, { failed: "x" })).toBeNull();
  });
});

describe("describeStatusShort", () => {
  it("names the engine in every state", () => {
    expect(describeStatusShort({ state: "ok", models: [] }, "lmstudio")).toBe("LM Studio is running.");
    expect(describeStatusShort({ state: "forbidden" }, "ollama")).toContain("OLLAMA_ORIGINS");
    expect(describeStatusShort({ state: "unreachable" }, "llamacpp")).toContain("isn’t reachable");
    expect(describeStatusShort({ state: "error", detail: "boom" }, "custom")).toContain("boom");
    expect(describeStatusShort({ state: "ok", models: ["Gemini Nano"] }, "builtin")).toBe("Chrome’s built-in model is ready.");
    expect(describeStatusShort({ state: "downloadable" }, "builtin")).toContain("isn’t downloaded yet");
    expect(describeStatusShort({ state: "downloading" }, "builtin")).toContain("downloading");
    expect(describeStatusShort({ state: "unsupported" }, "builtin")).toContain("isn’t available on this device");
  });
});
