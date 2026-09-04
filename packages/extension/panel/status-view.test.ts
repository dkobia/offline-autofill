import type { Settings } from "@offline-autofill/shared";
import { describe, expect, it } from "vitest";
import { describeStatusShort, statusView } from "./status-view";

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

describe("describeStatusShort", () => {
  it("names the engine in every state", () => {
    expect(describeStatusShort({ state: "ok", models: [] }, "lmstudio")).toBe("LM Studio is running.");
    expect(describeStatusShort({ state: "forbidden" }, "ollama")).toContain("OLLAMA_ORIGINS");
    expect(describeStatusShort({ state: "unreachable" }, "llamacpp")).toContain("isn’t reachable");
    expect(describeStatusShort({ state: "error", detail: "boom" }, "custom")).toContain("boom");
  });
});
