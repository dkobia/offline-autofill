// Chrome's built-in model behind the BuiltInModel seam. Kept apart from
// chrome.ts so it can be exercised with a fake LanguageModel; nothing in here
// touches chrome.* either.
//
// Every session is one exchange: a system prompt at creation, one user
// prompt constrained to a JSON schema, then destroy. Sampling is pinned
// (temperature 0, topK 1) so the same form gets the same answer, the way the
// HTTP engines run their servers at temperature 0.

import type { BuiltInModel, BuiltInSession, BuiltInSessionOptions } from "./types";

/** The prompts and answers are English; telling Chrome so silences its language warning and lets it refuse cleanly. */
const TEXT_EXPECTATIONS: LanguageModelExpectation[] = [{ type: "text", languages: ["en"] }];

export function builtInModelOf(api: LanguageModelStatic | undefined): BuiltInModel {
  return {
    async availability() {
      if (!api) {
        return "unavailable";
      }
      return api.availability({ expectedInputs: TEXT_EXPECTATIONS, expectedOutputs: TEXT_EXPECTATIONS });
    },

    async create(options: BuiltInSessionOptions = {}): Promise<BuiltInSession> {
      if (!api) {
        throw new Error("This browser has no built-in model.");
      }
      const init: LanguageModelCreateOptions = {
        temperature: 0,
        topK: 1,
        expectedInputs: TEXT_EXPECTATIONS,
        expectedOutputs: TEXT_EXPECTATIONS,
      };
      if (options.system) {
        init.initialPrompts = [{ role: "system", content: options.system }];
      }
      if (options.signal) {
        init.signal = options.signal;
      }
      const { onProgress } = options;
      if (onProgress) {
        init.monitor = (monitor) => {
          monitor.addEventListener("downloadprogress", (event) => onProgress(downloadFraction(event)));
        };
      }
      const session = await api.create(init);
      return {
        prompt(input, { schema, signal }) {
          const promptOptions: LanguageModelPromptOptions = { responseConstraint: schema };
          if (signal) {
            promptOptions.signal = signal;
          }
          return session.prompt(input, promptOptions);
        },
        destroy() {
          session.destroy();
        },
      };
    },
  };
}

/**
 * The fraction downloaded, 0 to 1. Chrome reports `loaded` as that fraction;
 * earlier builds reported bytes with a `total`, which is normalized the same way.
 */
export function downloadFraction(event: Event): number {
  const { loaded = 0, total = 0 } = event as Partial<ProgressEvent>;
  const fraction = total > 1 ? loaded / total : loaded;
  return Math.min(1, Math.max(0, fraction));
}
