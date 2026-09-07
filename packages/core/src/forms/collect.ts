// Deterministic form discovery: every fillable control in a document as a
// CollectedField - the text signals around it (label, aria, placeholder,
// nearby prose), its options, and whether the user can actually see it.
// Pure DOM logic that runs identically in the content script and against a
// linkedom fixture; the content script supplies a live visibility check.

import { selectorPath } from "./selector";

export type FieldTag = "input" | "textarea" | "select";

export interface FieldOption {
  value: string;
  label: string;
}

export interface CollectedField {
  /** Selector path; for a radio group, the first radio's path. */
  ref: string;
  tag: FieldTag;
  /** Normalized input type ("text" for textarea and unknown types, "select" for selects). */
  type: string;
  name?: string;
  id?: string;
  label?: string;
  ariaLabel?: string;
  placeholder?: string;
  autocomplete?: string;
  /** Prose immediately before the field when it has no label. */
  nearbyText?: string;
  /** The enclosing fieldset legend or nearest preceding heading. */
  sectionText?: string;
  /** Select options, or the radios of a group. */
  options?: FieldOption[];
  /**
   * A text input that picks from a list the page renders while typing
   * (react-select and kin). Its options exist only at fill time, so it is
   * filled by choosing one, never by a bare value write.
   */
  combobox?: true;
  /** The page marks the control as mandatory (`required` or `aria-required`). */
  required?: true;
  visible: boolean;
  editable: boolean;
  /** True when the field already holds a value the user (or the page) put there. */
  hasValue: boolean;
}

export interface CollectEnvironment {
  /** Whether the user can perceive the element. The default checks attributes and inline styles only. */
  isVisible(element: Element): boolean;
}

const FIELD_SELECTOR = "input, textarea, select";
const SKIPPED_INPUT_TYPES = new Set(["submit", "button", "reset", "image", "file"]);
const KNOWN_INPUT_TYPES = new Set([
  "text", "email", "tel", "password", "number", "url", "search",
  "date", "datetime-local", "month", "week", "time",
  "checkbox", "radio", "hidden", "color", "range",
]);
const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function attr(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name);
  return value !== null && value.trim() !== "" ? value.trim() : undefined;
}

/** Text of a label with any nested control's own text removed. */
function labelText(label: Element): string {
  const clone = label.cloneNode(true) as Element;
  for (const control of clone.querySelectorAll("input, select, textarea, button")) {
    control.remove();
  }
  return normalizeText(clone.textContent);
}

export function explicitLabel(field: Element, document: Document): string | undefined {
  const id = field.getAttribute("id");
  if (id) {
    for (const label of document.querySelectorAll("label[for]")) {
      if (label.getAttribute("for") === id) {
        const text = labelText(label);
        if (text) {
          return text;
        }
      }
    }
  }
  for (let el = field.parentElement; el; el = el.parentElement) {
    if (el.localName === "label") {
      const text = labelText(el);
      return text || undefined;
    }
  }
  const labelledBy = field.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((ref) => normalizeText(document.getElementById(ref)?.textContent))
      .filter(Boolean)
      .join(" ");
    if (text) {
      return text;
    }
  }
  return undefined;
}

/** The closest preceding prose: previous sibling text, else the parent's leading text. */
export function nearbyText(field: Element): string | undefined {
  let prev = field.previousElementSibling;
  while (prev && ["input", "select", "textarea", "br"].includes(prev.localName)) {
    prev = prev.previousElementSibling;
  }
  const fromSibling = normalizeText(prev?.textContent);
  if (fromSibling) {
    return fromSibling.slice(0, 120);
  }
  const parent = field.parentElement;
  if (!parent) {
    return undefined;
  }
  let text = "";
  for (const node of parent.childNodes) {
    if (node === field) {
      break;
    }
    if (node.nodeType === 3) {
      text += node.textContent ?? "";
    }
  }
  const trimmed = normalizeText(text);
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

/** The nearest heading before each field (file inputs included), from one walk of the document in order. */
export function headingsBefore(root: Element): Map<Element, string> {
  const out = new Map<Element, string>();
  let current: string | undefined;
  for (const element of root.querySelectorAll(`${HEADING_SELECTOR}, ${FIELD_SELECTOR}`)) {
    if (element.matches(HEADING_SELECTOR)) {
      const text = normalizeText(element.textContent);
      if (text) {
        current = text.slice(0, 80);
      }
    } else if (current) {
      out.set(element, current);
    }
  }
  return out;
}

/** The fieldset legend enclosing the field, else the nearest heading before it. */
export function sectionOf(field: Element, headings: Map<Element, string>): string | undefined {
  for (let el = field.parentElement; el; el = el.parentElement) {
    if (el.localName === "fieldset") {
      const legend = Array.from(el.children).find((child) => child.localName === "legend");
      const text = normalizeText(legend?.textContent);
      if (text) {
        return text.slice(0, 80);
      }
    }
  }
  return headings.get(field);
}

function defaultIsVisible(element: Element): boolean {
  for (let el: Element | null = element; el; el = el.parentElement) {
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const style = el.getAttribute("style") ?? "";
    if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])/i.test(style)) {
      return false;
    }
  }
  return true;
}

export const defaultEnvironment: CollectEnvironment = { isVisible: defaultIsVisible };

/**
 * An input that drives a rendered listbox. A native datalist (`list`
 * attribute) is excluded: the browser owns that popup and a plain value
 * write is the right fill.
 */
export function isComboboxInput(element: Element): boolean {
  if (element.localName !== "input" || element.hasAttribute("list")) {
    return false;
  }
  const autocomplete = element.getAttribute("aria-autocomplete");
  return (
    element.getAttribute("role") === "combobox" ||
    autocomplete === "list" ||
    autocomplete === "both" ||
    element.getAttribute("aria-haspopup") === "listbox"
  );
}

/**
 * Effective disabledness, as the browser sees it: the control's own attribute
 * or a disabled ancestor fieldset. Controls inside that fieldset's first
 * legend are exempt, per HTML.
 */
export function isDisabled(element: Element): boolean {
  if (element.hasAttribute("disabled")) {
    return true;
  }
  for (let el = element.parentElement; el; el = el.parentElement) {
    if (el.localName === "fieldset" && el.hasAttribute("disabled")) {
      const legend = Array.from(el.children).find((child) => child.localName === "legend");
      if (!legend?.contains(element)) {
        return true;
      }
    }
  }
  return false;
}

function rawInputType(element: Element): string {
  return element.getAttribute("type")?.toLowerCase() ?? "text";
}

function fieldType(element: Element, tag: FieldTag): string {
  if (tag === "select") {
    return "select";
  }
  if (tag === "textarea") {
    return "text";
  }
  const type = rawInputType(element);
  return KNOWN_INPUT_TYPES.has(type) ? type : "text";
}

function selectOptions(select: Element): FieldOption[] {
  return Array.from(select.querySelectorAll("option"))
    .map((option) => ({
      value: option.getAttribute("value") ?? normalizeText(option.textContent),
      label: normalizeText(option.textContent),
    }))
    // A value-less option ("Select...") is a placeholder, never a fill target.
    .filter((option) => option.value !== "");
}

/**
 * The option a select holds as a choice, by its live selection: any option
 * but the first, or the first when the page marked it `selected` itself (a
 * browser shows the first option when nobody chose, so that alone is not a
 * choice). The live state wins over the markup: an option the page marked
 * as the default is no longer the choice once the user picked another. The
 * `selected` attribute decides only where no live state exists. A
 * value-less option ("Select...") is a placeholder, never a choice.
 */
export function chosenOption(select: Element): Element | undefined {
  const options = Array.from(select.querySelectorAll("option"));
  const liveIndex = options.findIndex((option) => (option as HTMLOptionElement).selected === true);
  const marked = options.find((option) => option.hasAttribute("selected"));
  let chosen: Element | undefined;
  if (liveIndex > 0) {
    chosen = options[liveIndex];
  } else if (liveIndex === 0) {
    // The first option is a choice when the page marked it, or when the page
    // marked another one (the user moved away from that default); with no
    // mark anywhere it is only what a browser shows when nobody chose.
    chosen = marked ? options[0] : undefined;
  } else {
    chosen = marked;
  }
  if (!chosen) {
    return undefined;
  }
  const value = chosen.getAttribute("value") ?? normalizeText(chosen.textContent);
  return value === "" ? undefined : chosen;
}

/**
 * Elements inside a combobox widget that never carry its choice: the
 * placeholder, screen-reader live regions, the open/clear indicators, the
 * option list, labels, anything hidden from assistive technology, and the
 * inline style and script elements CSS-in-JS libraries drop beside the
 * widget (their text is CSS, not a choice).
 */
const NOT_A_CHOICE = [
  '[class*="placeholder"]',
  '[aria-hidden="true"]',
  '[role="log"]',
  "[aria-live]",
  '[role="alert"]',
  '[role="listbox"]',
  '[role="option"]',
  // Help, hints, and validation messages sit beside a widget and say nothing about its choice.
  '[class*="error"]',
  '[class*="hint"]',
  '[class*="help"]',
  '[class*="description"]',
  '[class*="message"]',
  "button",
  "svg",
  "label",
  "legend",
  "style",
  "script",
  "template",
].join(", ");
/**
 * Where a widget keeps what it shows as chosen, by the names such elements
 * carry (react-select "single-value" and "multi-value", Select2
 * "selection__rendered", Ant "selection-item", vue-select "selected",
 * Choices "item"). Text beside a widget that names itself none of these
 * (a stray "Required", a note) is not a choice.
 */
const CHOICE_CLASS = /value|select|chosen|item|tag|chip|token/i;
/** How far above the input the widget shows its choice: react-select puts it beside the input's container, others beside the input. */
const CHOICE_LEVELS = 2;
const MAX_CHOICE_CHARS = 200;

/**
 * What a combobox widget shows as its choice. react-select and its kin
 * clear the input after a pick and render the chosen label in a sibling
 * element, so the input's value says nothing; the text beside it does.
 * Looks at the input's siblings, then its container's siblings, taking only
 * elements named the way widgets name their selection and skipping what is
 * never a choice, including whatever the input names as its own description
 * (`aria-describedby`: placeholders, errors, hints); undefined when nothing
 * is shown, or when what is shown is too long to be a choice.
 */
export function comboboxDisplayedValue(input: Element): string | undefined {
  const described = new Set((input.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
  const isDecoy = (element: Element) => element.matches(NOT_A_CHOICE) || described.has(element.getAttribute("id") ?? "");
  let child: Element = input;
  for (let level = 0; level < CHOICE_LEVELS; level++) {
    const parent = child.parentElement;
    if (!parent) {
      return undefined;
    }
    let text = "";
    for (const sibling of Array.from(parent.children)) {
      if (sibling === child || isDecoy(sibling) || !CHOICE_CLASS.test(sibling.getAttribute("class") ?? "")) {
        continue;
      }
      const clone = sibling.cloneNode(true) as Element;
      for (const descendant of Array.from(clone.querySelectorAll("*"))) {
        if (isDecoy(descendant)) {
          descendant.remove();
        }
      }
      text += ` ${clone.textContent ?? ""}`;
    }
    const shown = normalizeText(text);
    if (shown !== "") {
      return shown.length > MAX_CHOICE_CHARS ? undefined : shown;
    }
    child = parent;
  }
  return undefined;
}

/**
 * Checked as the user left it: the live property where the environment has
 * one (browsers always do; a click moves it off the page's default), the
 * `checked` attribute only where it does not.
 */
export function isChecked(input: Element): boolean {
  const live = (input as HTMLInputElement).checked;
  return typeof live === "boolean" ? live : input.hasAttribute("checked");
}

function currentValue(element: Element, tag: FieldTag, type: string): boolean {
  if (tag === "select") {
    return chosenOption(element) !== undefined;
  }
  if (type === "checkbox" || type === "radio") {
    return isChecked(element);
  }
  const live = (element as HTMLInputElement).value;
  const value = typeof live === "string" ? live : (element.getAttribute("value") ?? element.textContent ?? "");
  if (normalizeText(value) !== "") {
    return true;
  }
  // A combobox widget holds its choice beside the input, not in it.
  return isComboboxInput(element) && comboboxDisplayedValue(element) !== undefined;
}

interface Context {
  document: Document;
  env: CollectEnvironment;
  headings: Map<Element, string>;
}

function describe(element: Element, { document, env, headings }: Context): CollectedField | undefined {
  const tag = element.localName as FieldTag;
  if (tag !== "input" && tag !== "textarea" && tag !== "select") {
    return undefined;
  }
  // Skip on the raw attribute: "file" is not a known type and would otherwise
  // be normalized to "text" and offered as fillable.
  if (tag === "input" && SKIPPED_INPUT_TYPES.has(rawInputType(element))) {
    return undefined;
  }
  const type = fieldType(element, tag);
  const label = explicitLabel(element, document);
  const field: CollectedField = {
    ref: selectorPath(element),
    tag,
    type,
    visible: type !== "hidden" && env.isVisible(element),
    editable: !isDisabled(element) && !element.hasAttribute("readonly"),
    hasValue: currentValue(element, tag, type),
  };
  const name = attr(element, "name");
  const id = attr(element, "id");
  const ariaLabel = attr(element, "aria-label");
  const placeholder = attr(element, "placeholder");
  const autocomplete = attr(element, "autocomplete")?.toLowerCase();
  const nearby = label ? undefined : nearbyText(element);
  const section = sectionOf(element, headings);
  if (name) field.name = name;
  if (id) field.id = id;
  if (label) field.label = label;
  if (ariaLabel) field.ariaLabel = ariaLabel;
  if (placeholder) field.placeholder = placeholder;
  if (autocomplete && autocomplete !== "off" && autocomplete !== "on") field.autocomplete = autocomplete;
  if (nearby) field.nearbyText = nearby;
  if (section) field.sectionText = section;
  if (tag === "select") {
    field.options = selectOptions(element);
  }
  if (isComboboxInput(element)) {
    field.combobox = true;
  }
  if (element.hasAttribute("required") || element.getAttribute("aria-required") === "true") {
    field.required = true;
  }
  return field;
}

/** Radios sharing a name are one choice; describe the group once with its options. */
function mergeRadios(fields: { element: Element; field: CollectedField }[], { document, headings }: Context): CollectedField[] {
  const out: CollectedField[] = [];
  const groups = new Map<string, CollectedField>();
  // A group is offered only if some single radio is both visible and
  // editable; the executor then judges the specific radio it writes.
  const available = new Map<string, boolean>();
  for (const { element, field } of fields) {
    if (field.type !== "radio" || !field.name) {
      out.push(field);
      continue;
    }
    const option: FieldOption = {
      value: element.getAttribute("value") ?? "",
      label: explicitLabel(element, document) ?? element.getAttribute("value") ?? "",
    };
    available.set(field.name, (available.get(field.name) ?? false) || (field.visible && field.editable));
    const group = groups.get(field.name);
    if (group) {
      group.options!.push(option);
      group.hasValue ||= field.hasValue;
      // HTML treats the group as required when any member is.
      if (field.required) group.required = true;
      continue;
    }
    const first: CollectedField = { ...field, options: [option] };
    // The group's own label is the prose around it, not the first radio's label.
    delete first.label;
    const groupLabel = sectionOf(element, headings);
    if (groupLabel) first.label = groupLabel;
    groups.set(field.name, first);
    out.push(first);
  }
  for (const [name, group] of groups) {
    const usable = available.get(name) ?? false;
    group.visible = usable;
    group.editable = usable;
  }
  return out;
}

export function collectFields(document: Document, env: CollectEnvironment = defaultEnvironment): CollectedField[] {
  const root = document.documentElement;
  if (!root) {
    return [];
  }
  const context: Context = { document, env, headings: headingsBefore(root) };
  const described: { element: Element; field: CollectedField }[] = [];
  for (const element of root.querySelectorAll(FIELD_SELECTOR)) {
    const field = describe(element, context);
    if (field) {
      described.push({ element, field });
    }
  }
  return mergeRadios(described, context);
}
