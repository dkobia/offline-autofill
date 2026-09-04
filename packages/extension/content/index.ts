// Content script. Thin by design: collects the page's fields through core
// when the background asks, and writes approved values back through core.
// It never sees the profile, only the values the user approved for this
// page. Page values go the other way only on collect-answers, which the
// background sends when the user clicks "Save answers", never on a scan.
// The visibility check is the live one: computed style and layout, which
// core cannot know from markup alone.

import { applyAssignments, collectAnswers, collectFields, collectFormContext, collectUploads, type CollectEnvironment } from "@offline-autofill/core";
import type {
  ApplyFillResponse,
  CollectFieldsResponse,
  ContentRequest,
  DescribeFormResponse,
  GetPageUrlResponse,
  CollectAnswersResponse,
} from "@offline-autofill/shared";
import { platform } from "@platform";

// The background injects this script on demand into tabs that predate the
// extension load; the guard keeps a second injection from adding a second
// listener. The flag lives in the extension's isolated world, not the page's.
const LOADED_FLAG = "__offlineAutofillContentReady";
const world = globalThis as Record<string, unknown>;

/** What the user can actually see: rendered, non-transparent, and inside the page. */
const liveEnvironment: CollectEnvironment = {
  isVisible(element) {
    const el = element as HTMLElement;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true } as CheckVisibilityOptions)) {
        return false;
      }
    } else {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
    }
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (node.getAttribute("aria-hidden") === "true") {
        return false;
      }
    }
    const rect = el.getBoundingClientRect();
    // Zero-size or pushed off the page (left: -9999px honeypots).
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0;
  },
};

if (!world[LOADED_FLAG]) {
  world[LOADED_FLAG] = true;
  platform.onMessage((message) => {
    const request = message as ContentRequest;
    switch (request?.type) {
      case "collect-fields": {
        const response: CollectFieldsResponse = { fields: collectFields(document, liveEnvironment), uploads: collectUploads(document) };
        return Promise.resolve(response);
      }
      case "describe-form": {
        const response: DescribeFormResponse = {
          fields: collectFields(document, liveEnvironment),
          context: collectFormContext(document, liveEnvironment),
        };
        return Promise.resolve(response);
      }
      case "apply-fill":
        return applyAssignments(document, request.requests, { isVisible: liveEnvironment.isVisible }).then(
          (outcome): ApplyFillResponse => ({ outcome }),
        );
      case "get-page-url": {
        const response: GetPageUrlResponse = { url: location.href };
        return Promise.resolve(response);
      }
      case "collect-answers": {
        // Fields and values from one pass: the page cannot change a field between the look and the read.
        const response: CollectAnswersResponse = collectAnswers(document, liveEnvironment);
        return Promise.resolve(response);
      }
      default:
        return undefined;
    }
  });
}
