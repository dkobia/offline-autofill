// Writes approved assignments into the live document. Values go through the
// element's own prototype setter so framework-controlled inputs (React, Vue)
// notice the change, then the events a real keystroke would produce are
// dispatched. Every write is read back: a browser silently normalizes an
// invalid value (a date input, a select with no such option), and a
// normalized write is not the approved write.
//
// Comboboxes (react-select and kin) are the one asynchronous case: the
// value is typed, the page renders its options, and the matching option is
// chosen. A bare value write would leave text in the search box and no
// selection behind it.

import { decodeBase64 } from "../documents/store";
import { comboboxDisplayedValue, defaultEnvironment, isComboboxInput, isDisabled } from "../forms/collect";
import { resolveRef } from "../forms/selector";
import { matchOption } from "./plan";

/** A file to attach, its bytes base64 encoded (extension messages are JSON). */
export interface FilePayload {
  name: string;
  type: string;
  data: string;
}

/** A value for a text-like control, or a file for a file input. */
export type WriteRequest = { ref: string; value: string } | { ref: string; file: FilePayload };

export type WriteFailure =
  | "unresolvable"
  | "not-visible"
  | "not-editable"
  | "unsupported"
  | "readback-mismatch"
  | "no-option-match";

export interface FillOutcome {
  filled: string[];
  failed: { ref: string; reason: WriteFailure }[];
}

export interface ApplyOptions {
  /** How long a combobox gets to render options after the value is typed (network-backed lists need a while). */
  optionsTimeoutMs?: number;
  /** How long a combobox gets to close its list after an option is chosen. */
  closeTimeoutMs?: number;
  /**
   * Whether the user can see an element. Checked again on every target
   * right before it is written (a page may hide a field after review), and
   * combobox options are only ever picked from a visible list. The default
   * reads markup only; the content script supplies the live check.
   */
  isVisible?: (element: Element) => boolean;
}

const DEFAULT_OPTIONS: Required<ApplyOptions> = {
  optionsTimeoutMs: 3000,
  closeTimeoutMs: 500,
  isVisible: defaultEnvironment.isVisible,
};
const POLL_MS = 50;

type ValueElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function prototypeSetter(element: ValueElement, property: "value" | "checked"): ((v: unknown) => void) | undefined {
  // Walk the prototype chain so the setter is the platform's, not one a page
  // script may have installed on the instance.
  for (let proto = Object.getPrototypeOf(element); proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, property);
    if (descriptor?.set) {
      return descriptor.set;
    }
  }
  return undefined;
}

function assign(element: ValueElement, property: "value" | "checked", value: unknown): void {
  const setter = prototypeSetter(element, property);
  if (setter) {
    setter.call(element, value);
  } else {
    (element as unknown as Record<string, unknown>)[property] = value;
  }
}

function fire(element: Element, names: string[]): void {
  const view = element.ownerDocument.defaultView;
  const EventCtor = view?.Event ?? Event;
  for (const name of names) {
    element.dispatchEvent(new EventCtor(name, { bubbles: true, cancelable: name !== "input" }));
  }
}

/** Mouse events where the environment has them (browsers), plain events elsewhere (linkedom). */
function click(element: Element): void {
  const view = element.ownerDocument.defaultView as ({ MouseEvent?: typeof MouseEvent; Event?: typeof Event } & object) | null;
  const Ctor = (view?.MouseEvent ?? (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent ?? view?.Event ?? Event) as typeof Event;
  for (const name of ["mousedown", "mouseup", "click"]) {
    element.dispatchEvent(new Ctor(name, { bubbles: true, cancelable: true }));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Case and punctuation folded: the form in which two values are compared. */
export function foldValue(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Exact, else equal once case and punctuation are folded: a phone widget
 * that hyphenates the digits still holds the approved number, and that is a
 * fill, not a failure. The folded comparison never matches on an empty
 * read-back (a page that swallowed the value is not a fill); only an exact
 * empty-for-empty write passes.
 */
export function sameValue(actual: string, wanted: string): boolean {
  if (actual === wanted) {
    return true;
  }
  const folded = foldValue(actual);
  return folded !== "" && folded === foldValue(wanted);
}

/**
 * Whether a control may be written right now. Reviewed fields were visible
 * and editable at scan time; a page can change either since (or while an
 * earlier combobox waited for its options), so this runs again per write.
 */
function eligibility(element: Element, isVisible: (element: Element) => boolean): WriteFailure | undefined {
  if (isDisabled(element) || element.hasAttribute("readonly")) {
    return "not-editable";
  }
  if (!isVisible(element)) {
    return "not-visible";
  }
  return undefined;
}

/** A group's ref names its first radio; the one that gets written is the one carrying the value, so that is the one checked. */
function writeRadio(first: HTMLInputElement, value: string, isVisible: (element: Element) => boolean): WriteFailure | undefined {
  const document = first.ownerDocument;
  const name = first.getAttribute("name");
  const group = name
    ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name.replace(/"/g, '\\"')}"]`))
    : [first];
  const target = group.find((radio) => radio.getAttribute("value") === value);
  if (!target) {
    return "readback-mismatch";
  }
  const blocked = eligibility(target, isVisible);
  if (blocked) {
    return blocked;
  }
  assign(target, "checked", true);
  fire(target, ["input", "change"]);
  return target.checked ? undefined : "readback-mismatch";
}

function writeSelect(select: HTMLSelectElement, value: string): boolean {
  const options = Array.from(select.querySelectorAll("option"));
  const target = options.find((option) => (option.getAttribute("value") ?? option.textContent) === value);
  if (!target) {
    return false;
  }
  const setter = prototypeSetter(select, "value");
  if (setter) {
    setter.call(select, value);
  } else {
    // Environments without a value setter (linkedom): selecting the option
    // directly deselects its siblings.
    target.selected = true;
  }
  fire(select, ["input", "change"]);
  return select.value === value;
}

function writeText(element: HTMLInputElement | HTMLTextAreaElement, value: string): boolean {
  fire(element, ["focus"]);
  assign(element, "value", value);
  fire(element, ["input", "change", "blur"]);
  return sameValue(element.value, value);
}

// ---- File inputs ----------------------------------------------------------------------

/**
 * Hands a file to a file input the way a pick from the file dialog would:
 * a File inside a DataTransfer assigned to `files`, then the input and
 * change events upload widgets (react-dropzone and its kin) listen for.
 * Visibility is not required of a file input, as at collection: the real
 * control routinely sits hidden behind a styled button. Environments
 * without DataTransfer (linkedom) cannot attach anything.
 */
function writeFile(element: Element, file: FilePayload): WriteFailure | undefined {
  if (element.localName !== "input" || element.getAttribute("type")?.toLowerCase() !== "file") {
    return "unsupported";
  }
  if (isDisabled(element)) {
    return "not-editable";
  }
  const view = element.ownerDocument.defaultView as (typeof globalThis & Window) | null;
  const DataTransferCtor = view?.DataTransfer ?? globalThis.DataTransfer;
  const FileCtor = view?.File ?? globalThis.File;
  if (typeof DataTransferCtor !== "function" || typeof FileCtor !== "function") {
    return "unsupported";
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = decodeBase64(file.data);
  } catch {
    return "unsupported";
  }
  const transfer = new DataTransferCtor();
  transfer.items.add(new FileCtor([bytes], file.name, { type: file.type }));
  const input = element as HTMLInputElement;
  input.files = transfer.files;
  fire(input, ["input", "change"]);
  return input.files?.[0]?.name === file.name ? undefined : "readback-mismatch";
}

// ---- Comboboxes -------------------------------------------------------------------

function optionText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The list the input declares it controls (set by most widgets once open), else nothing. */
function declaredList(input: Element): Element | null {
  const document = input.ownerDocument;
  for (const name of ["aria-controls", "aria-owns"]) {
    const id = input.getAttribute(name);
    const list = id ? document.getElementById(id) : null;
    if (list) {
      return list;
    }
  }
  return null;
}

function allOptions(scope: Element | Document): Element[] {
  return Array.from(scope.querySelectorAll('[role="option"]'));
}

/**
 * The options this combobox is offering right now: those in its declared
 * list, or, when it declares none, visible options that were not in the
 * document before it was opened. A phone widget's collapsed country list
 * is neither.
 */
function renderedOptions(input: Element, before: ReadonlySet<Element>, isVisible: (element: Element) => boolean): Element[] {
  const list = declaredList(input);
  const candidates = list ? allOptions(list) : allOptions(input.ownerDocument).filter((option) => !before.has(option));
  return candidates.filter(
    (option) => option.getAttribute("aria-hidden") !== "true" && option.getAttribute("aria-disabled") !== "true" && isVisible(option),
  );
}

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(POLL_MS);
  }
}

/**
 * Real focus and blur where the environment has them (browsers move the
 * active element and emit the focus events themselves, which widgets
 * track); the plain event only where it does not (linkedom), never both.
 */
function focusReal(input: HTMLInputElement): void {
  if (typeof input.focus === "function") {
    input.focus({ preventScroll: true });
  } else {
    fire(input, ["focus"]);
  }
}

function blurReal(input: HTMLInputElement): void {
  if (typeof input.blur === "function") {
    input.blur();
  } else {
    fire(input, ["blur"]);
  }
}

/**
 * Puts a combobox back the way it was after a pick failed: no stray search
 * text, list closed, focus released. Escape goes only to a list that is
 * still open: react-select answers Escape on a closed, unfocused widget by
 * opening it, and the blur that follows does nothing to a widget that
 * already let go of focus, so the list would stay open behind the user.
 */
function retreat(input: HTMLInputElement, listOpen: () => boolean): void {
  assign(input, "value", "");
  fire(input, ["input"]);
  const view = input.ownerDocument.defaultView as (Window & { KeyboardEvent?: typeof KeyboardEvent }) | null;
  const Ctor = view?.KeyboardEvent ?? (globalThis as { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent;
  if (Ctor && listOpen()) {
    for (const name of ["keydown", "keyup"]) {
      input.dispatchEvent(new Ctor(name, { key: "Escape", bubbles: true, cancelable: true }));
    }
  }
  blurReal(input);
}

interface OptionCandidate {
  value: string;
  label: string;
  element: Element;
}

/**
 * Open with the full mouse sequence a real click produces (widgets hang
 * their open handler on mousedown, mouseup, or click, and wrappers around
 * them differ), type the value, wait for a matching option (a network-backed
 * list may show stale or default entries first), choose it, and confirm the
 * widget took it: list closed and the typed text consumed.
 */
async function writeCombobox(input: HTMLInputElement, value: string, timing: Required<ApplyOptions>): Promise<WriteFailure | undefined> {
  const before = new Set(allOptions(input.ownerDocument));
  const listOpen = () => renderedOptions(input, before, timing.isVisible).length > 0;
  click(input);
  focusReal(input);
  assign(input, "value", value);
  fire(input, ["input"]);

  let hit: OptionCandidate | undefined;
  await waitUntil(() => {
    const options: OptionCandidate[] = renderedOptions(input, before, timing.isVisible).map((element) => ({
      value: optionText(element),
      label: optionText(element),
      element,
    }));
    hit = matchOption(options, value) as OptionCandidate | undefined;
    return hit !== undefined;
  }, timing.optionsTimeoutMs);
  if (!hit) {
    retreat(input, listOpen);
    return "no-option-match";
  }
  // The wait may have been long; the page may have disabled or hidden the widget meanwhile.
  const blocked = eligibility(input, timing.isVisible);
  if (blocked) {
    retreat(input, listOpen);
    return blocked;
  }

  click(hit.element);
  const closed = await waitUntil(() => !listOpen(), timing.closeTimeoutMs);

  // Other widgets leave the chosen label in the input itself; react-select
  // clears the search text and shows the choice beside the input, and that
  // shown text must be the option that was picked (a widget that shows
  // nothing readable is taken at its word, as before).
  if (closed) {
    if (sameValue(input.value, hit.label)) {
      return undefined;
    }
    if (input.value === "") {
      const shown = comboboxDisplayedValue(input);
      if (shown === undefined || sameValue(shown, hit.label) || foldValue(shown).includes(foldValue(hit.label))) {
        return undefined;
      }
    }
  }
  retreat(input, listOpen);
  return "readback-mismatch";
}

// ---- Entry point ------------------------------------------------------------------

export async function applyAssignments(document: Document, requests: WriteRequest[], options: ApplyOptions = {}): Promise<FillOutcome> {
  const timing = { ...DEFAULT_OPTIONS, ...options };
  const outcome: FillOutcome = { filled: [], failed: [] };
  for (const request of requests) {
    const { ref } = request;
    const element = resolveRef(document, ref);
    if (!element) {
      outcome.failed.push({ ref, reason: "unresolvable" });
      continue;
    }
    const tag = element.localName;
    const type = tag === "input" ? (element.getAttribute("type")?.toLowerCase() ?? "text") : undefined;
    // A value for a file input, or a file for anything else, is refused below as unsupported.
    const value = "value" in request ? request.value : "";
    let failure: WriteFailure | undefined;
    if ("file" in request) {
      failure = writeFile(element, request.file);
    } else if (type === "radio") {
      // The ref is the group's first radio; the one carrying the value is checked instead.
      failure = writeRadio(element as HTMLInputElement, value, timing.isVisible);
    } else if ((failure = eligibility(element, timing.isVisible))) {
      // Refused before any write.
    } else if (tag === "select") {
      failure = writeSelect(element as HTMLSelectElement, value) ? undefined : "readback-mismatch";
    } else if (tag === "textarea") {
      failure = writeText(element as HTMLTextAreaElement, value) ? undefined : "readback-mismatch";
    } else if (tag === "input") {
      if (type === "checkbox" || type === "file" || type === "hidden" || type === "password") {
        failure = "unsupported";
      } else if (isComboboxInput(element)) {
        failure = await writeCombobox(element as HTMLInputElement, value, timing);
      } else {
        failure = writeText(element as HTMLInputElement, value) ? undefined : "readback-mismatch";
      }
    } else {
      failure = "unsupported";
    }
    if (failure) {
      outcome.failed.push({ ref, reason: failure });
    } else {
      outcome.filled.push(ref);
    }
  }
  return outcome;
}
