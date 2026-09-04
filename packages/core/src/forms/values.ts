// Reads what controls hold right now, for the fields the user typed into by
// hand and asked to keep. This is the only path by which a page value enters
// the extension, and it runs only on that request: the collector reports
// whether a field has a value, never what it is. Values travel in their own
// type, on their own message, and no prompt builder accepts them.

import {
  chosenOption,
  comboboxDisplayedValue,
  defaultEnvironment,
  explicitLabel,
  isChecked,
  isComboboxInput,
  isDisabled,
  normalizeText,
  type CollectEnvironment,
} from "./collect";
import { eligibleFields } from "../mapping/resolve";
import { collectFields, type CollectedField } from "./collect";
import { resolveRef } from "./selector";

export interface ReadValue {
  ref: string;
  /** The text as the user sees it: an option's label for selects and radios, the typed text otherwise. */
  value: string;
}

const UNREADABLE_INPUT_TYPES = new Set(["password", "hidden", "file", "checkbox", "submit", "button", "reset", "image"]);

/** The chosen option's label, as the collector judges a choice; a select left on its default or placeholder has none. */
function selectedLabel(select: HTMLSelectElement): string | undefined {
  const chosen = chosenOption(select);
  if (!chosen) {
    return undefined;
  }
  return normalizeText(chosen.textContent) || (chosen.getAttribute("value") ?? undefined);
}

/** The checked radio of the group the ref's first radio belongs to, as its label. */
function checkedRadioLabel(first: HTMLInputElement, env: CollectEnvironment): string | undefined {
  const document = first.ownerDocument;
  const name = first.getAttribute("name");
  const group = name
    ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name.replace(/"/g, '\\"')}"]`))
    : [first];
  const checked = group.find(isChecked);
  if (!checked || isDisabled(checked) || !env.isVisible(checked)) {
    return undefined;
  }
  return explicitLabel(checked, document) ?? checked.getAttribute("value") ?? undefined;
}

function textValue(element: HTMLInputElement | HTMLTextAreaElement): string {
  const live = element.value;
  const value = typeof live === "string" ? live : element.localName === "textarea" ? (element.textContent ?? "") : (element.getAttribute("value") ?? "");
  if (value.trim() === "" && isComboboxInput(element)) {
    // react-select and kin show the pick beside the input and leave the input empty.
    return comboboxDisplayedValue(element) ?? "";
  }
  return value;
}

/**
 * The current value of each ref that resolves to a visible, editable
 * control, in the refs' order (a combobox widget's displayed choice counts
 * as its value); refs that resolve to nothing, to a control
 * the extension never reads (passwords, hidden inputs, files, checkboxes),
 * or to an empty control are left out.
 */
export function readValues(document: Document, refs: readonly string[], env: CollectEnvironment = defaultEnvironment): ReadValue[] {
  const out: ReadValue[] = [];
  for (const ref of refs) {
    const element = resolveRef(document, ref);
    if (!element) {
      continue;
    }
    const tag = element.localName;
    const type = tag === "input" ? (element.getAttribute("type")?.toLowerCase() ?? "text") : undefined;
    if (type !== undefined && UNREADABLE_INPUT_TYPES.has(type)) {
      continue;
    }
    let value: string | undefined;
    if (type === "radio") {
      value = checkedRadioLabel(element as HTMLInputElement, env);
    } else if (isDisabled(element) || element.hasAttribute("readonly") || !env.isVisible(element)) {
      continue;
    } else if (tag === "select") {
      value = selectedLabel(element as HTMLSelectElement);
    } else if (tag === "textarea" || tag === "input") {
      value = textValue(element as HTMLInputElement | HTMLTextAreaElement);
    }
    const trimmed = value?.trim() ?? "";
    if (trimmed !== "") {
      out.push({ ref, value: trimmed });
    }
  }
  return out;
}

/** The page's fields as they are right now, with the values of those the user filled in. */
export interface CollectedAnswers {
  fields: CollectedField[];
  values: ReadValue[];
}

/**
 * The fields the scan would offer (visible, editable, not blocked, not a
 * checkbox) that hold a value, and their values, from one synchronous pass
 * over the page: the fields the values are judged and named by are the
 * fields of the same instant, so a page cannot swap a control for a
 * sensitive one, or relabel it, between a look and a read.
 */
export function collectAnswers(document: Document, env: CollectEnvironment = defaultEnvironment): CollectedAnswers {
  const fields = collectFields(document, env);
  const { eligible } = eligibleFields(fields);
  const refs = eligible.filter((field) => field.hasValue && field.type !== "checkbox").map((field) => field.ref);
  return { fields, values: readValues(document, refs, env) };
}
