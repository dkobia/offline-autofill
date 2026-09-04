// File inputs, described for the attachment pipeline. They are deliberately
// not CollectedFields: the profile pipeline can never map one, and the
// upload pipeline can never receive a profile value. What the label reader
// finds here is also what the form summary names.

import { explicitLabel, headingsBefore, isDisabled, normalizeText, sectionOf } from "./collect";
import { selectorPath } from "./selector";

export interface UploadField {
  ref: string;
  /** What a reader sees the upload called ("Resume/CV"); absent when only a generic control label ("Attach") exists. */
  label?: string;
  name?: string;
  id?: string;
  /** The input's accept attribute, as written. */
  accept?: string;
  multiple?: true;
  required?: true;
  /** The enclosing fieldset legend or nearest preceding heading. */
  sectionText?: string;
  /**
   * Not disabled. Visibility is deliberately not required: nearly every
   * application system hides the real input behind a styled button or
   * drop zone, and the review step is the safeguard.
   */
  editable: boolean;
  /** A file is already attached. */
  hasValue: boolean;
}

const MAX_LABEL = 60;
/** How many wrappers up the label may sit: Greenhouse nests the real input four deep under the group that names it. */
const MAX_ANCESTORS = 5;

/** Control labels that say how to attach, not what to attach. Whole phrases only: "Upload resume" is a name. */
const GENERIC_UPLOAD_LABEL = /^(?:(?:attach|upload|browse|choose|select|add)(?: (?:a |your )?files?)?|no file chosen)$/i;

const CONTROL_SELECTOR = "input, select, textarea, button";

/** An element's text, unless it is or holds a control and so belongs to another field. */
function proseOf(element: Element): string {
  return element.matches(CONTROL_SELECTOR) || element.querySelector(CONTROL_SELECTOR) ? "" : normalizeText(element.textContent);
}

/** A required marker ("Resume/CV*") is decoration, not part of the name. */
function undecorated(text: string | undefined): string {
  return (text ?? "").replace(/\s*\*$/, "");
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function isOrHoldsControl(element: Element): boolean {
  return element.matches(CONTROL_SELECTOR) || element.querySelector(CONTROL_SELECTOR) !== null;
}

/** The text of the elements an aria-labelledby names. */
function labelledByText(element: Element, document: Document): string {
  const ids = element.getAttribute("aria-labelledby");
  if (!ids) {
    return "";
  }
  return ids
    .split(/\s+/)
    .map((id) => normalizeText(document.getElementById(id)?.textContent))
    .filter(Boolean)
    .join(" ");
}

/**
 * The prose before an element among its siblings, nearest first, stopping
 * at the first sibling that is or holds a control: past it lies another
 * field, whose label is not this one's.
 */
function proseBefore(element: Element): string[] {
  const out: string[] = [];
  for (let prev = element.previousElementSibling; prev; prev = prev.previousElementSibling) {
    if (isOrHoldsControl(prev)) {
      break;
    }
    out.push(proseOf(prev));
  }
  const parent = element.parentElement;
  if (parent) {
    let text = "";
    for (const node of parent.childNodes) {
      if (node === element) {
        break;
      }
      if (node.nodeType === 3) {
        text += node.textContent ?? "";
      }
    }
    out.push(normalizeText(text));
  }
  return out;
}

/**
 * The label a reader sees for a file input. Prefers the prose beside the
 * control over a generic control label ("Attach"), then climbs the wrappers
 * application systems bury the real input under, reading each one's
 * aria-labelledby, fieldset legend, and preceding prose. Nothing specific
 * found is undefined, not a generic stand-in.
 */
export function uploadLabel(input: Element, document: Document): string | undefined {
  const candidates: (string | undefined)[] = [explicitLabel(input, document), normalizeText(input.getAttribute("aria-label")), ...proseBefore(input)];
  let element: Element | null = input.parentElement;
  for (let depth = 0; element && depth < MAX_ANCESTORS && element.localName !== "form"; depth += 1, element = element.parentElement) {
    candidates.push(labelledByText(element, document));
    if (element.localName === "fieldset") {
      const legend = Array.from(element.children).find((child) => child.localName === "legend");
      candidates.push(normalizeText(legend?.textContent));
    }
    candidates.push(...proseBefore(element));
  }
  const specific = candidates.map(undecorated).find((text) => text && !GENERIC_UPLOAD_LABEL.test(text));
  return specific ? clip(specific, MAX_LABEL) : undefined;
}

function attr(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name);
  return value !== null && value.trim() !== "" ? value.trim() : undefined;
}

export function collectUploads(document: Document): UploadField[] {
  const root = document.documentElement;
  if (!root) {
    return [];
  }
  const headings = headingsBefore(root);
  const out: UploadField[] = [];
  for (const input of root.querySelectorAll('input[type="file"]')) {
    const files = (input as HTMLInputElement).files;
    const upload: UploadField = {
      ref: selectorPath(input),
      editable: !isDisabled(input),
      hasValue: typeof files?.length === "number" && files.length > 0,
    };
    const label = uploadLabel(input, document);
    const name = attr(input, "name");
    const id = attr(input, "id");
    const accept = attr(input, "accept");
    const section = sectionOf(input, headings);
    if (label) upload.label = label;
    if (name) upload.name = name;
    if (id) upload.id = id;
    if (accept) upload.accept = accept;
    if (input.hasAttribute("multiple")) upload.multiple = true;
    // Greenhouse marks the group around the input as required, not the input.
    if (input.hasAttribute("required") || input.closest('[aria-required="true"]') !== null) upload.required = true;
    if (section) upload.sectionText = section;
    out.push(upload);
  }
  return out;
}
