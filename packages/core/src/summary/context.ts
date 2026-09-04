// What a person reads to understand a form: the page title, its headings,
// the introductory prose, the buttons, and the uploads it asks for. Pure DOM
// logic, budgeted so the prompt stays small for 3B-8B models.
//
// File inputs are named here so a summary can say "asks for a resume", by the
// same collector the attachment pipeline uses (forms/uploads.ts). An upload
// the rules refuse (an ID scan, a bank statement) is named only by kind,
// like a blocked field: its label never reaches the model.

import { defaultEnvironment, type CollectEnvironment } from "../forms/collect";
import type { BlockReason } from "../forms/sensitivity";
import { collectUploads } from "../forms/uploads";
import { assessUpload, eligibleUploads } from "../mapping/uploads";

export interface FormContext {
  /** Document title, or empty. */
  title: string;
  /** Visible h1-h3 text in document order. */
  headings: string[];
  /** Visible paragraph text in document order, one paragraph per line, budgeted. */
  intro: string;
  /** Visible button labels, deduplicated. */
  buttons: string[];
  /** The label of the button that submits the form, when one can be told apart. */
  submit?: string;
  /** One label per file input the extension may attach to. */
  uploads: string[];
  /** Distinct reasons among the uploads refused on sight; their labels stay out. */
  blockedUploads: BlockReason[];
}

export const MAX_HEADINGS = 8;
export const MAX_BUTTONS = 8;
export const MAX_UPLOADS = 6;
export const MAX_INTRO_CHARS = 1200;
const MAX_TITLE = 120;
const MAX_HEADING = 80;
const MAX_BUTTON = 40;
function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function buttonText(element: Element): string {
  if (element.localName === "input") {
    return normalizeText(element.getAttribute("value"));
  }
  return normalizeText(element.textContent) || normalizeText(element.getAttribute("aria-label"));
}

/** Where a widget ends: a button beside a combobox within one of these is part of the page, not of the widget. */
const WIDGET_BOUNDARY = new Set(["form", "fieldset", "section", "main", "body"]);

/**
 * A combobox's own toggle or clear button: out of the tab order and inside
 * the widget's own box (its parent or grandparent holds the combobox input,
 * and neither is the form itself). A page's own actions keep their place in
 * the tab order, and a submit button is a form action whatever it does.
 */
function isWidgetChrome(button: Element): boolean {
  if (button.getAttribute("tabindex") !== "-1" || isSubmitButton(button)) {
    return false;
  }
  let scope: Element | null = button.parentElement;
  for (let level = 0; scope && level < 2 && !WIDGET_BOUNDARY.has(scope.localName); level++, scope = scope.parentElement) {
    if (scope.querySelector('[role="combobox"], input[aria-autocomplete]')) {
      return true;
    }
  }
  return false;
}

/** A button element that submits its form: an explicit submit type, or a type-less button inside a form. */
function isSubmitButton(element: Element): boolean {
  const type = element.getAttribute("type")?.toLowerCase();
  if (type === "submit") {
    return true;
  }
  return element.localName === "button" && !type && element.closest("form") !== null;
}

export function collectFormContext(document: Document, env: CollectEnvironment = defaultEnvironment): FormContext {
  const root = document.documentElement;
  const context: FormContext = { title: "", headings: [], intro: "", buttons: [], uploads: [], blockedUploads: [] };
  if (!root) {
    return context;
  }
  context.title = clip(normalizeText(document.querySelector("title")?.textContent), MAX_TITLE);

  for (const heading of root.querySelectorAll("h1, h2, h3")) {
    if (context.headings.length >= MAX_HEADINGS) {
      break;
    }
    const text = normalizeText(heading.textContent);
    if (text && env.isVisible(heading)) {
      context.headings.push(clip(text, MAX_HEADING));
    }
  }

  const paragraphs: string[] = [];
  let used = 0;
  for (const p of root.querySelectorAll("p")) {
    if (used >= MAX_INTRO_CHARS) {
      break;
    }
    const text = normalizeText(p.textContent);
    if (!text || !env.isVisible(p)) {
      continue;
    }
    const room = MAX_INTRO_CHARS - used;
    const kept = text.length > room ? clip(text, room) : text;
    paragraphs.push(kept);
    used += kept.length + 1;
  }
  context.intro = paragraphs.join("\n");

  const seen = new Set<string>();
  for (const button of root.querySelectorAll('button, input[type="submit"], input[type="button"]')) {
    const text = clip(buttonText(button), MAX_BUTTON);
    if (!text || isWidgetChrome(button) || !env.isVisible(button)) {
      continue;
    }
    if (context.submit === undefined && isSubmitButton(button)) {
      context.submit = text;
    }
    if (!seen.has(text) && context.buttons.length < MAX_BUTTONS) {
      seen.add(text);
      context.buttons.push(text);
    }
  }

  // Upload controls are routinely hidden behind a styled button, so
  // visibility is not required of them; disabled ones are skipped and
  // blocked ones are counted by reason only.
  const { eligible, blocked } = eligibleUploads(collectUploads(document));
  context.uploads = eligible.slice(0, MAX_UPLOADS).map((upload) => upload.label ?? "File upload");
  for (const upload of blocked) {
    const { reason } = assessUpload(upload);
    if (reason && !context.blockedUploads.includes(reason)) {
      context.blockedUploads.push(reason);
    }
  }
  return context;
}
