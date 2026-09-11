// Settings defaults and validation shared by background and panel.
// The localhost-only check enforces the project invariant that nothing ever
// leaves the device: any non-local endpoint is rejected. The browser's
// built-in model needs no endpoint and no model name; it is the default
// wherever the browser has one, so a fresh install has a model without
// installing anything.

import type { EngineKind, Settings } from "@offline-autofill/shared";

export const ENGINE_LABELS: Record<EngineKind, string> = {
  builtin: "Chrome built-in (Gemini Nano)",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  llamacpp: "llama.cpp server",
  custom: "Custom (OpenAI-compatible)",
};

/** The built-in model has no endpoint; Ollama's stands in so switching to a server prefills the usual one. */
export const DEFAULT_ENDPOINTS: Record<EngineKind, string> = {
  builtin: "http://localhost:11434",
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234",
  llamacpp: "http://localhost:8080",
  custom: "http://localhost:8080",
};

/** The defaults where the browser has no built-in model; see defaultSettings. */
export const DEFAULT_SETTINGS: Settings = {
  engine: "ollama",
  endpoint: DEFAULT_ENDPOINTS.ollama,
  model: "",
  useModel: true,
  overwrite: false,
  summary: true,
};

/** What a fresh install uses: the browser's built-in model when it has one, otherwise Ollama. */
export function defaultSettings(builtIn: boolean): Settings {
  return builtIn ? { ...DEFAULT_SETTINGS, engine: "builtin", endpoint: DEFAULT_ENDPOINTS.builtin } : DEFAULT_SETTINGS;
}

/** The engines the settings may offer: the built-in model only where the browser has one. */
export function availableEngines(builtIn: boolean): EngineKind[] {
  const kinds = Object.keys(ENGINE_LABELS) as EngineKind[];
  return builtIn ? kinds : kinds.filter((kind) => kind !== "builtin");
}

/** Whether the engine is a local server the user runs, with an endpoint and a model name to pick. */
export function isServerEngine(engine: EngineKind): boolean {
  return engine !== "builtin";
}

/** Whether a scan may consult a model: the switch is on and there is a model to ask (a server engine needs a name). */
export function modelSelected(settings: Settings): boolean {
  return settings.useModel && (!isServerEngine(settings.engine) || settings.model.length > 0);
}

// Kept in exact sync with host_permissions in manifests/base.json: an endpoint
// the manifest does not grant would probe as "unreachable" and confuse users.
// IPv6 ([::1]) is excluded because match-pattern support for it is unreliable.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

/** True only for http(s) URLs whose host is the local machine. */
export function isLocalEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  return LOCAL_HOSTNAMES.has(url.hostname);
}

/**
 * Whether the configured model appears in the server's model list.
 * Only Ollama resolves a bare name to the ":latest" tag; OpenAI-compatible
 * servers require exact ids. An empty list means the server could not tell
 * us what it offers, which is treated as unknown rather than missing.
 */
export function isModelAvailable(model: string, models: string[], engine: EngineKind): boolean {
  if (models.length === 0 || models.includes(model)) {
    return true;
  }
  return engine === "ollama" && models.includes(`${model}:latest`);
}

/**
 * Coerces whatever came out of storage (possibly from an older version, or
 * hand-edited) into a valid Settings object. Invalid fields fall back to
 * `defaults` (the platform's, from defaultSettings) rather than failing.
 */
export function normalizeSettings(raw: unknown, defaults: Settings = DEFAULT_SETTINGS): Settings {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof Settings, unknown>>;

  const engine =
    typeof input.engine === "string" && input.engine in DEFAULT_ENDPOINTS ? (input.engine as EngineKind) : defaults.engine;

  const endpoint =
    typeof input.endpoint === "string" && isLocalEndpoint(input.endpoint)
      ? input.endpoint.replace(/\/+$/, "")
      : DEFAULT_ENDPOINTS[engine];

  return {
    engine,
    endpoint,
    model: typeof input.model === "string" ? input.model.trim() : "",
    useModel: input.useModel !== false,
    overwrite: input.overwrite === true,
    summary: input.summary !== false,
  };
}
