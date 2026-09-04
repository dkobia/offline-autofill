// Panel entry point: fill view, profile editor, documents, and settings.
// The panel holds no policy: what to fill comes from the background's scan,
// how the plan, profile, and documents look comes from the pure view
// modules next to this file. This module reads, paints, and wires.

import { guessDocumentKind, normalizeDocuments, normalizeProfile, type DocumentKind, type Profile, type StoredDocument } from "@offline-autofill/core";
import type {
  AddDocumentResponse,
  AnswerCandidate,
  DescribeResponse,
  EngineKind,
  EngineStatus,
  FillRequest,
  FillResponse,
  GetProfileResponse,
  GetSettingsResponse,
  ListDocumentsResponse,
  ProbeEngineResponse,
  ReadAnswersResponse,
  SaveAnswersResponse,
  ScanResponse,
  Settings,
} from "@offline-autofill/shared";
import { platform } from "@platform";
import { DEFAULT_ENDPOINTS, ENGINE_LABELS, isLocalEndpoint, normalizeSettings } from "../lib/settings";
import {
  CAPTURE_INTRO,
  DIFFERENT_PAGE,
  NOTHING_TO_SAVE,
  PROFILE_UNSAVED,
  READING_STATUS,
  answerRows,
  captureSummary,
  plannedValues,
  readAnswersErrorText,
  saveAnswersButtonText,
  savedText,
} from "./answers-view";
import {
  DESCRIPTION_PLACEHOLDER,
  DOCUMENTS_EMPTY,
  DOCUMENTS_INTRO,
  KIND_OPTIONS,
  addedText,
  documentCards,
  fileError,
  removedText,
} from "./documents-view";
import { fillButtonText, fillSummary, modelErrorText, planRows, scanErrorText, scanSummary, skipText } from "./plan-view";
import { INITIAL_STATE, actionDisabled, begin, canStart, finish, profileClean, profileEdited, type Operation, type PanelState } from "./panel-state";
import { addEntry, formSections, removeEntry, setValue } from "./profile-form";
import { describeStatusShort, statusView, type BannerView } from "./status-view";
import { describesPlan, summaryView, type SummaryState } from "./summary-view";

const el = {
  statusDot: byId<HTMLSpanElement>("status-dot"),
  statusText: byId<HTMLSpanElement>("status-text"),
  tabs: Array.from(document.querySelectorAll<HTMLButtonElement>(".tab")),
  statusBanner: byId<HTMLDivElement>("status-banner"),
  profileFooter: byId<HTMLElement>("profile-footer"),
  scanButton: byId<HTMLButtonElement>("scan-button"),
  saveAnswersButton: byId<HTMLButtonElement>("save-answers-button"),
  runStatus: byId<HTMLParagraphElement>("run-status"),
  formSummary: byId<HTMLDetailsElement>("form-summary"),
  planOutput: byId<HTMLDivElement>("plan-output"),
  profileForm: byId<HTMLDivElement>("profile-form"),
  saveProfileButton: byId<HTMLButtonElement>("save-profile-button"),
  profileStatus: byId<HTMLParagraphElement>("profile-status"),
  documentsIntro: byId<HTMLParagraphElement>("documents-intro"),
  documentList: byId<HTMLDivElement>("document-list"),
  addDocumentButton: byId<HTMLButtonElement>("add-document-button"),
  documentFileInput: byId<HTMLInputElement>("document-file-input"),
  documentsStatus: byId<HTMLParagraphElement>("documents-status"),
  useModelInput: byId<HTMLInputElement>("use-model-input"),
  engineSelect: byId<HTMLSelectElement>("engine-select"),
  endpointInput: byId<HTMLInputElement>("endpoint-input"),
  modelInput: byId<HTMLInputElement>("model-input"),
  modelOptions: byId<HTMLDataListElement>("model-options"),
  overwriteInput: byId<HTMLInputElement>("overwrite-input"),
  summaryInput: byId<HTMLInputElement>("summary-input"),
  testConnectionButton: byId<HTMLButtonElement>("test-connection-button"),
  saveSettingsButton: byId<HTMLButtonElement>("save-settings-button"),
  settingsStatus: byId<HTMLParagraphElement>("settings-status"),
};

let settings: Settings;
let status: EngineStatus | null = null;
let profile: Profile;
let documents: StoredDocument[] = [];
/** The last successful scan, kept so checkbox toggles can recompute the fill set. */
let scan: Extract<ScanResponse, { ok: true }> | null = null;
/** The answers read from the page for review, while that list is showing instead of the plan. */
let capture: Extract<ReadAnswersResponse, { ok: true }> | null = null;
/** The refs the fill actually wrote since the last scan, so "Save answers" does not offer the plan's own values back. */
let filledRefs = new Set<string>();
/** The guard state (one operation at a time; unsaved editor changes); the decisions are in panel-state.ts. */
let state: PanelState = INITIAL_STATE;

/**
 * Whether an operation may start; when it may not, the reason is shown
 * where it matters (a refusal for unsaved changes is told, a busy click
 * is simply ignored, since its buttons are disabled anyway).
 */
function start(operation: Operation): boolean {
  const verdict = canStart(state, operation);
  if (verdict.ok) {
    return true;
  }
  if (verdict.reason === "profile-unsaved") {
    setRunStatus(PROFILE_UNSAVED, "error");
  }
  return false;
}

function setBusy(flag: boolean): void {
  state = flag ? begin(state) : finish(state);
  el.scanButton.disabled = flag;
  el.saveAnswersButton.disabled = flag;
  el.saveProfileButton.disabled = flag;
  for (const button of el.planOutput.querySelectorAll<HTMLButtonElement>("button")) {
    button.disabled = actionDisabled(state, button.dataset.idle === "true");
  }
  // The editor too: an edit made while a save is in flight would be overwritten by what the save stores.
  for (const control of el.profileForm.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input, textarea, button")) {
    control.disabled = flag;
  }
}
/** Counts scans, so a slow description for an earlier scan is dropped, never painted over a newer one. */
let describeSeq = 0;
/** The tab the shown description is about; the plan and the description must agree on it. */
let describedTab: number | null = null;
/** Whether the summary card is expanded; the user's last choice, kept across scans and panel opens. */
let summaryOpen = true;
const SUMMARY_OPEN_KEY = "summary-open";

// ---- Navigation ---------------------------------------------------------------------

for (const tab of el.tabs) {
  tab.addEventListener("click", () => showView(tab.dataset.view!));
}

function showView(viewId: string): void {
  for (const tab of el.tabs) {
    tab.setAttribute("aria-selected", String(tab.dataset.view === viewId));
  }
  for (const section of document.querySelectorAll<HTMLElement>("main > section")) {
    section.hidden = section.id !== viewId;
  }
  el.profileFooter.hidden = viewId !== "profile-view";
}

// ---- Engine status ------------------------------------------------------------------

async function probe(): Promise<void> {
  status = null;
  renderStatus();
  const response = (await platform.sendMessage({ type: "probe-engine", settings })) as ProbeEngineResponse | undefined;
  status = response?.status ?? { state: "unreachable" };
  renderStatus();
}

function renderStatus(): void {
  const view = statusView(settings, status, platform.name);
  el.statusDot.dataset.state = view.dot;
  el.statusText.textContent = view.label;
  renderBanner(view.banner);
}

function renderBanner(banner: BannerView | null): void {
  el.statusBanner.replaceChildren();
  if (!banner) {
    el.statusBanner.hidden = true;
    return;
  }
  el.statusBanner.dataset.tone = banner.tone;
  const title = document.createElement("p");
  title.className = "banner-title";
  title.textContent = banner.title;
  el.statusBanner.append(title);
  for (const block of banner.blocks) {
    if (block.kind === "p") {
      const p = document.createElement("p");
      p.textContent = block.text;
      el.statusBanner.append(p);
      continue;
    }
    const ol = document.createElement("ol");
    for (const step of block.steps) {
      const li = document.createElement("li");
      li.textContent = step.text;
      if (step.command) {
        const code = document.createElement("code");
        code.textContent = step.command;
        li.append(code);
      }
      ol.append(li);
    }
    el.statusBanner.append(ol);
  }
  if (banner.showRetry) {
    const actions = document.createElement("div");
    actions.className = "banner-actions";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Check again";
    retry.addEventListener("click", () => void probe());
    actions.append(retry);
    el.statusBanner.append(actions);
  }
  el.statusBanner.hidden = false;
}

// ---- Fill view ----------------------------------------------------------------------

el.scanButton.addEventListener("click", () => void runScan());

async function runScan(): Promise<void> {
  if (!start("scan")) {
    return;
  }
  capture = null;
  scan = null;
  filledRefs = new Set();
  // Saving answers is the step after a scan: the button appears once the
  // extension has read this page, and goes away while it reads it again.
  el.saveAnswersButton.hidden = true;
  setBusy(true);
  setRunStatus("Scanning…");
  renderEmpty(true);
  // The description is a separate round trip (it may wait on the model), so
  // the plan never waits for it and neither blocks the other.
  const seq = ++describeSeq;
  describedTab = null;
  if (settings.summary) {
    renderSummary({ kind: "working" });
    void describePage(seq);
  } else {
    renderSummary({ kind: "idle" });
  }
  let response: ScanResponse | undefined;
  try {
    response = (await platform.sendMessage({ type: "scan-page" })) as ScanResponse | undefined;
  } catch {
    response = undefined;
  } finally {
    setBusy(false);
  }
  if (!response) {
    setRunStatus("The extension’s background didn’t answer. Reload the extension and try again.", "error");
    renderEmpty(false);
    return;
  }
  if (!response.ok) {
    setRunStatus(scanErrorText(response), "error");
    renderEmpty(false);
    if (response.error === "profile-empty") {
      // The explanation travels with the user: the fill view's status line is
      // out of sight once the profile view is showing.
      showStatus(el.profileStatus, response.message);
      showView("profile-view");
    }
    return;
  }
  scan = response;
  el.saveAnswersButton.hidden = false;
  setRunStatus(scanSummary(response));
  renderPlan(response);
  if (describedTab !== null && !describesPlan(response.tabId, describedTab)) {
    describedTab = null;
    renderSummary({ kind: "idle" });
  }
}

async function describePage(seq: number): Promise<void> {
  let response: DescribeResponse | undefined;
  try {
    response = (await platform.sendMessage({ type: "describe-page" })) as DescribeResponse | undefined;
  } catch {
    response = undefined;
  }
  if (seq !== describeSeq) {
    return;
  }
  if (response?.ok && !describesPlan(scan?.tabId ?? null, response.tabId)) {
    renderSummary({ kind: "idle" });
    return;
  }
  describedTab = response?.ok ? response.tabId : null;
  renderSummary(response ? { kind: "ready", response } : { kind: "idle" });
}

// Setting `open` while rendering fires "toggle" too; only the user's own
// toggles are remembered.
let renderingSummary = false;

el.formSummary.addEventListener("toggle", () => {
  if (renderingSummary) {
    return;
  }
  summaryOpen = el.formSummary.open;
  void platform.setSetting(SUMMARY_OPEN_KEY, summaryOpen);
});

function renderSummary(state: SummaryState): void {
  const view = summaryView(state);
  renderingSummary = true;
  el.formSummary.replaceChildren();
  el.formSummary.hidden = view.hidden;
  el.formSummary.classList.toggle("working", view.working);
  el.formSummary.open = summaryOpen;
  renderingSummary = false;
  if (view.hidden) {
    return;
  }
  const head = document.createElement("summary");
  head.className = "summary-head";
  const label = document.createElement("span");
  label.className = "summary-label";
  label.textContent = view.working ? "Reading the form…" : "About this form";
  head.append(label);
  if (view.tag) {
    const tag = document.createElement("span");
    tag.className = "summary-tag";
    tag.textContent = view.tag;
    head.append(tag);
  }
  el.formSummary.append(head);
  if (view.working) {
    return;
  }
  const body = document.createElement("div");
  body.className = "summary-body";
  const purpose = document.createElement("p");
  purpose.className = "summary-purpose";
  purpose.textContent = view.purpose;
  body.append(purpose);
  if (view.howTo.length > 0) {
    body.append(summaryList("How to fill it", "ol", view.howTo));
  }
  if (view.notes.length > 0) {
    body.append(summaryList("Good to know", "ul", view.notes));
  }
  if (view.note) {
    const note = document.createElement("p");
    note.className = "summary-note";
    note.textContent = view.note;
    body.append(note);
  }
  const facts = document.createElement("p");
  facts.className = "summary-facts";
  facts.textContent = view.facts;
  body.append(facts);
  el.formSummary.append(body);
}

function summaryList(title: string, kind: "ol" | "ul", items: string[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const heading = document.createElement("h3");
  heading.className = "summary-subhead";
  heading.textContent = title;
  const list = document.createElement(kind);
  list.className = "summary-list";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }
  fragment.append(heading, list);
  return fragment;
}

function setRunStatus(text: string | null, tone?: "error"): void {
  el.runStatus.textContent = text ?? "";
  el.runStatus.hidden = text === null;
  if (tone) {
    el.runStatus.dataset.tone = tone;
  } else {
    delete el.runStatus.dataset.tone;
  }
}

function renderEmpty(working: boolean): void {
  const empty = el.planOutput.querySelector(".plan-empty");
  if (empty) {
    empty.classList.toggle("working", working);
    return;
  }
  // The empty-state markup is authored in index.html; restore it by cloning the template kept at load.
  el.planOutput.replaceChildren(emptyTemplate.cloneNode(true));
  el.planOutput.querySelector(".plan-empty")!.classList.toggle("working", working);
}

const emptyTemplate = el.planOutput.querySelector(".plan-empty")!.cloneNode(true);

function renderPlan(response: Extract<ScanResponse, { ok: true }>): void {
  const rows = planRows(response.plan);
  el.planOutput.replaceChildren();

  if (response.modelError) {
    const note = document.createElement("p");
    note.className = "plan-note";
    note.textContent = modelErrorText(response.modelError);
    el.planOutput.append(note);
  }

  if (rows.length === 0) {
    const none = document.createElement("p");
    none.className = "plan-none";
    none.textContent = "Nothing on this page matches your profile.";
    el.planOutput.append(none);
  }

  const list = document.createElement("div");
  list.className = "plan-rows";
  for (const row of rows) {
    const label = document.createElement("label");
    label.className = "plan-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.ref = row.ref;
    if (row.file) {
      checkbox.dataset.file = "true";
    }
    checkbox.addEventListener("change", updateFillButton);
    const name = document.createElement("span");
    name.className = "plan-label";
    name.textContent = row.label;
    let value: HTMLElement;
    if (row.file && row.file.choices.length > 1) {
      // Several stored documents fit: the value is the choice itself, the planned one first.
      const select = document.createElement("select");
      select.className = "plan-value plan-file";
      select.dataset.ref = row.ref;
      for (const choice of row.file.choices) {
        const option = document.createElement("option");
        option.value = choice.documentId;
        option.textContent = choice.label;
        select.append(option);
      }
      select.value = row.file.documentId;
      value = select;
    } else {
      value = document.createElement("span");
      value.className = "plan-value";
      value.textContent = row.value;
    }
    label.append(checkbox, name, value);
    if (row.tag) {
      const tag = document.createElement("span");
      tag.className = "plan-tag";
      tag.textContent = row.tag;
      label.append(tag);
    }
    list.append(label);
  }
  el.planOutput.append(list);

  if (rows.length > 0) {
    const actions = document.createElement("div");
    actions.className = "plan-actions";
    const fill = document.createElement("button");
    fill.type = "button";
    fill.className = "primary";
    fill.id = "fill-button";
    fill.addEventListener("click", () => void runFill());
    actions.append(fill);
    el.planOutput.append(actions);
    updateFillButton();
  }

  if (response.unmapped.length > 0) {
    el.planOutput.append(
      detailsList(
        `Not recognized (${response.unmapped.length})`,
        response.unmapped.map((field) => field.label),
      ),
    );
  }
  if (response.plan.skipped.length > 0) {
    el.planOutput.append(
      detailsList(
        `Skipped (${response.plan.skipped.length})`,
        response.plan.skipped.map((skip) => `${skip.label ?? skip.key}: ${skipText(skip.reason)}`),
      ),
    );
  }
}

function detailsList(summaryText: string, items: string[]): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "plan-details";
  const summary = document.createElement("summary");
  summary.textContent = summaryText;
  const ul = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.append(li);
  }
  details.append(summary, ul);
  return details;
}

/** The ticked rows, and which of them are files. */
function selectedRefs(): { refs: Set<string>; files: Set<string> } {
  const refs = new Set<string>();
  const files = new Set<string>();
  for (const box of el.planOutput.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-ref]")) {
    if (box.checked) {
      refs.add(box.dataset.ref!);
      if (box.dataset.file) {
        files.add(box.dataset.ref!);
      }
    }
  }
  return { refs, files };
}

/** The document chosen for an upload row: the select's value when there is one, else the planned document. */
function chosenDocument(ref: string, planned: string): string {
  for (const select of el.planOutput.querySelectorAll<HTMLSelectElement>("select.plan-file[data-ref]")) {
    if (select.dataset.ref === ref) {
      return select.value || planned;
    }
  }
  return planned;
}

function updateFillButton(): void {
  const button = document.getElementById("fill-button") as HTMLButtonElement | null;
  if (!button) {
    return;
  }
  const { refs, files } = selectedRefs();
  button.textContent = fillButtonText(refs.size - files.size, files.size);
  button.dataset.idle = String(refs.size === 0);
  button.disabled = actionDisabled(state, refs.size === 0);
}

async function runFill(): Promise<void> {
  if (!scan || !start("fill")) {
    return;
  }
  // A fill can take seconds (comboboxes wait for their options). No scan
  // may replace the plan meanwhile, and a response for a plan that is no
  // longer on screen is dropped rather than painted onto the new one.
  const current = scan;
  const { refs, files } = selectedRefs();
  const requests: FillRequest[] = [
    ...current.plan.assignments.filter((a) => refs.has(a.ref)).map((a) => ({ ref: a.ref, value: a.value })),
    ...current.plan.attachments.filter((a) => refs.has(a.ref)).map((a) => ({ ref: a.ref, documentId: chosenDocument(a.ref, a.documentId) })),
  ];
  const button = document.getElementById("fill-button") as HTMLButtonElement | null;
  if (button) {
    button.textContent = "Filling…";
  }
  setBusy(true);
  let response: FillResponse | undefined;
  try {
    response = (await platform.sendMessage({ type: "fill-page", tabId: current.tabId, requests })) as FillResponse | undefined;
  } catch {
    // A rejected message (background gone) reads as no answer below.
    response = undefined;
  } finally {
    setBusy(false);
  }
  if (scan !== current) {
    return;
  }
  const outcome = response?.outcome ?? { filled: [], failed: requests.map((r) => ({ ref: r.ref, reason: "unresolvable" as const })) };
  for (const ref of outcome.filled) {
    filledRefs.add(ref);
  }
  setRunStatus(fillSummary(outcome, files), outcome.filled.length === 0 ? "error" : undefined);
  const failed = new Set(outcome.failed.map((f) => f.ref));
  for (const box of el.planOutput.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-ref]")) {
    const row = box.closest(".plan-row");
    if (!row || !refs.has(box.dataset.ref!)) {
      continue;
    }
    row.classList.toggle("filled", !failed.has(box.dataset.ref!));
    row.classList.toggle("failed", failed.has(box.dataset.ref!));
  }
  updateFillButton();
}

// ---- Save answers -------------------------------------------------------------------

el.saveAnswersButton.addEventListener("click", () => void runReadAnswers());

/** Asks the page what the user typed and shows it for review; nothing is stored until they save. */
async function runReadAnswers(): Promise<void> {
  if (!start("read-answers")) {
    return;
  }
  // A new read replaces whatever review list is showing, whatever it answers.
  if (capture) {
    leaveCapture();
  }
  setBusy(true);
  setRunStatus(READING_STATUS);
  // What the fill actually wrote, so a field still holding it is not offered back as an answer.
  const planned = scan ? plannedValues(scan.plan, filledRefs) : [];
  let response: ReadAnswersResponse | undefined;
  try {
    response = (await platform.sendMessage({ type: "read-answers", planned })) as ReadAnswersResponse | undefined;
  } catch {
    response = undefined;
  } finally {
    setBusy(false);
  }
  if (!response) {
    setRunStatus("Couldn’t read the page. Reload the extension and try again.", "error");
    return;
  }
  if (!response.ok) {
    setRunStatus(readAnswersErrorText(response), "error");
    return;
  }
  // The side panel outlives a tab switch: what was read must be the page that was scanned.
  if (!scan || !describesPlan(scan.tabId, response.tabId)) {
    scan = null;
    el.saveAnswersButton.hidden = true;
    setRunStatus(DIFFERENT_PAGE, "error");
    renderEmpty(false);
    return;
  }
  if (response.candidates.length === 0) {
    setRunStatus(NOTHING_TO_SAVE);
    return;
  }
  capture = response;
  setRunStatus(captureSummary(response.candidates));
  renderCapture(response.candidates);
}

function renderCapture(candidates: AnswerCandidate[]): void {
  el.planOutput.replaceChildren();
  const intro = document.createElement("p");
  intro.className = "plan-intro";
  intro.textContent = CAPTURE_INTRO;
  el.planOutput.append(intro);

  const list = document.createElement("div");
  list.className = "plan-rows";
  for (const row of answerRows(candidates)) {
    const label = document.createElement("label");
    label.className = "plan-row answer-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.answerRef = row.ref;
    checkbox.addEventListener("change", updateSaveAnswersButton);
    const name = document.createElement("span");
    name.className = "plan-label";
    name.textContent = row.label;
    const value = document.createElement("span");
    value.className = "plan-value";
    // A multi-line answer shows its first line; the title carries the whole.
    value.textContent = row.multiline ? row.value.split("\n")[0]! : row.value;
    value.title = row.value;
    const tag = document.createElement("span");
    tag.className = "plan-tag";
    tag.textContent = row.tag;
    label.append(checkbox, name, value, tag);
    list.append(label);
  }
  el.planOutput.append(list);

  const actions = document.createElement("div");
  actions.className = "plan-actions";
  if (scan) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "plan-back";
    back.textContent = "Back to plan";
    back.addEventListener("click", () => leaveCapture());
    actions.append(back);
  }
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.id = "save-answers-confirm";
  save.addEventListener("click", () => void runSaveAnswers());
  actions.append(save);
  el.planOutput.append(actions);
  updateSaveAnswersButton();
}

/** The ticked candidates, in the page's order. */
function chosenCandidates(): AnswerCandidate[] {
  if (!capture) {
    return [];
  }
  const ticked = new Set<string>();
  for (const box of el.planOutput.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-answer-ref]")) {
    if (box.checked) {
      ticked.add(box.dataset.answerRef!);
    }
  }
  return capture.candidates.filter((candidate) => ticked.has(candidate.ref));
}

function updateSaveAnswersButton(): void {
  const button = document.getElementById("save-answers-confirm") as HTMLButtonElement | null;
  if (!button) {
    return;
  }
  const count = chosenCandidates().length;
  button.textContent = saveAnswersButtonText(count);
  button.dataset.idle = String(count === 0);
  button.disabled = actionDisabled(state, count === 0);
}

/** Back to the plan the review list replaced, or to the empty state when there was none. */
function leaveCapture(): void {
  capture = null;
  if (scan) {
    setRunStatus(scanSummary(scan));
    renderPlan(scan);
  } else {
    setRunStatus(null);
    renderEmpty(false);
  }
}

async function runSaveAnswers(): Promise<void> {
  const current = capture;
  const chosen = chosenCandidates();
  // Checked again here, not only at the read: the profile may have been edited in between.
  if (!current || chosen.length === 0 || !start("save-answers")) {
    return;
  }
  const button = document.getElementById("save-answers-confirm") as HTMLButtonElement | null;
  if (button) {
    button.textContent = "Saving…";
  }
  // The profile's own Save waits too: a stale whole-profile save queued behind this one would erase what it stores.
  setBusy(true);
  let response: SaveAnswersResponse | undefined;
  try {
    response = (await platform.sendMessage({ type: "save-answers", chosen })) as SaveAnswersResponse | undefined;
  } catch {
    response = undefined;
  } finally {
    setBusy(false);
  }
  if (response) {
    // What was stored is the profile now, whatever the view did meanwhile; the editor had no unsaved changes (see runReadAnswers).
    profile = normalizeProfile(response.profile);
    renderProfile();
  }
  if (capture !== current) {
    return;
  }
  if (!response) {
    setRunStatus("Couldn’t save. Reload the extension and try again.", "error");
    updateSaveAnswersButton();
    return;
  }
  leaveCapture();
  setRunStatus(savedText(response.outcome));
}

// ---- Profile view -------------------------------------------------------------------

el.saveProfileButton.addEventListener("click", () => void saveProfile());

function renderProfile(): void {
  el.profileForm.replaceChildren();
  for (const section of formSections(profile)) {
    const heading = document.createElement("h2");
    heading.textContent = section.label;
    el.profileForm.append(heading);
    if (section.hint) {
      const hint = document.createElement("p");
      hint.className = "section-hint";
      hint.textContent = section.hint;
      el.profileForm.append(hint);
    }
    for (const entry of section.entries) {
      const card = document.createElement("div");
      card.className = "card";
      if (section.repeating) {
        const head = document.createElement("div");
        head.className = "entry-head";
        const title = document.createElement("span");
        title.className = "entry-title";
        title.textContent = entry.title;
        head.append(title);
        if (section.entries.length > 1) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "entry-remove";
          remove.textContent = "Remove";
          remove.addEventListener("click", () => {
            profile = removeEntry(profile, section.id, entry.index);
            state = profileEdited(state);
            renderProfile();
          });
          head.append(remove);
        }
        card.append(head);
      }
      for (const field of entry.fields) {
        const label = document.createElement("label");
        label.className = `field ${field.width}`;
        const name = document.createElement("span");
        name.className = "field-label";
        name.textContent = field.label;
        const input = field.kind === "multiline" ? document.createElement("textarea") : document.createElement("input");
        if (input instanceof HTMLInputElement) {
          input.type = inputTypeFor(field.kind);
        } else {
          input.rows = 3;
        }
        input.value = field.value;
        input.dataset.path = field.path;
        input.autocomplete = "off";
        input.addEventListener("input", () => {
          profile = setValue(profile, field.path, input.value);
          state = profileEdited(state);
        });
        label.append(name, input);
        card.append(label);
      }
      el.profileForm.append(card);
    }
    if (section.addLabel) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "entry-add";
      add.textContent = section.addLabel;
      add.addEventListener("click", () => {
        profile = addEntry(profile, section.id);
        state = profileEdited(state);
        renderProfile();
      });
      el.profileForm.append(add);
    }
  }
}

function inputTypeFor(kind: string): string {
  switch (kind) {
    case "email":
    case "tel":
    case "url":
    case "date":
    case "month":
      return kind;
    default:
      return "text";
  }
}

async function saveProfile(): Promise<void> {
  if (!start("save-profile")) {
    return;
  }
  setBusy(true);
  let response: GetProfileResponse | undefined;
  try {
    response = (await platform.sendMessage({ type: "save-profile", profile })) as GetProfileResponse | undefined;
  } catch {
    response = undefined;
  } finally {
    setBusy(false);
  }
  if (!response) {
    showStatus(el.profileStatus, "Couldn’t save. Reload the extension and try again.", "error");
    return;
  }
  profile = response.profile;
  state = profileClean(state);
  renderProfile();
  showStatus(el.profileStatus, "Profile saved.", "ok");
}

// ---- Documents view -----------------------------------------------------------------

el.documentsIntro.textContent = DOCUMENTS_INTRO;
el.addDocumentButton.addEventListener("click", () => el.documentFileInput.click());
el.documentFileInput.addEventListener("change", () => {
  const [file] = el.documentFileInput.files ?? [];
  // Reset first, so picking the same file again after a removal fires change.
  el.documentFileInput.value = "";
  if (file) {
    void addDocument(file);
  }
});

function renderDocuments(): void {
  el.documentList.replaceChildren();
  const cards = documentCards(documents);
  if (cards.length === 0) {
    const empty = document.createElement("p");
    empty.className = "documents-empty";
    empty.textContent = DOCUMENTS_EMPTY;
    el.documentList.append(empty);
    return;
  }
  for (const card of cards) {
    const box = document.createElement("div");
    box.className = "card document-card";

    const head = document.createElement("div");
    head.className = "entry-head";
    const kind = document.createElement("span");
    kind.className = "document-kind";
    kind.textContent = card.kindLabel;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "entry-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => void removeDocument(card.id, card.fileName));
    head.append(kind, remove);

    const name = document.createElement("p");
    name.className = "document-name";
    name.textContent = card.fileName;
    const facts = document.createElement("p");
    facts.className = "document-facts";
    facts.textContent = card.facts;

    const kindField = document.createElement("label");
    kindField.className = "field";
    const kindLabel = document.createElement("span");
    kindLabel.className = "field-label";
    kindLabel.textContent = "Kind";
    const select = document.createElement("select");
    for (const option of KIND_OPTIONS) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = card.kind;
    select.addEventListener("change", () => void updateDocument(card.id, select.value as DocumentKind, descriptionInput.value));
    kindField.append(kindLabel, select);

    const descriptionField = document.createElement("label");
    descriptionField.className = "field";
    const descriptionLabel = document.createElement("span");
    descriptionLabel.className = "field-label";
    descriptionLabel.textContent = "Description";
    const descriptionInput = document.createElement("input");
    descriptionInput.type = "text";
    descriptionInput.value = card.description;
    descriptionInput.placeholder = DESCRIPTION_PLACEHOLDER;
    descriptionInput.autocomplete = "off";
    descriptionInput.addEventListener("change", () => void updateDocument(card.id, select.value as DocumentKind, descriptionInput.value));
    descriptionField.append(descriptionLabel, descriptionInput);

    box.append(head, name, facts, kindField, descriptionField);
    el.documentList.append(box);
  }
}

/** The file's bytes as base64: what an extension message can carry. */
function encodeFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function addDocument(file: File): Promise<void> {
  const error = fileError(file.size);
  if (error) {
    showStatus(el.documentsStatus, error, "error");
    return;
  }
  showStatus(el.documentsStatus, `Adding ${file.name}…`);
  el.addDocumentButton.disabled = true;
  try {
    const data = await encodeFile(file);
    const response = (await platform.sendMessage({
      type: "add-document",
      document: { kind: guessDocumentKind(file.name, file.type), description: "", fileName: file.name, mimeType: file.type, data },
    })) as AddDocumentResponse | undefined;
    if (!response) {
      showStatus(el.documentsStatus, "Couldn’t save. Reload the extension and try again.", "error");
      return;
    }
    if (!response.ok) {
      showStatus(el.documentsStatus, response.message, "error");
      return;
    }
    documents = response.documents;
    renderDocuments();
    showStatus(el.documentsStatus, addedText(file.name), "ok");
  } catch (error) {
    showStatus(el.documentsStatus, `Couldn’t read the file (${error instanceof Error ? error.message : String(error)}).`, "error");
  } finally {
    el.addDocumentButton.disabled = false;
  }
}

// Document changes go one after another: a failed edit repaints the list
// from storage, and a second edit in flight at that moment would be painted
// over before its answer came back.
let documentChanges: Promise<unknown> = Promise.resolve();

/** A document change's answer, or nothing when the background did not answer at all. */
function changeDocuments(request: object): Promise<ListDocumentsResponse | undefined> {
  const next = documentChanges.then(
    () => platform.sendMessage(request) as Promise<ListDocumentsResponse | undefined>,
    () => undefined,
  );
  documentChanges = next.catch(() => undefined);
  return next.catch(() => undefined);
}

/** Whether the user is in the middle of editing a card; a repaint then would pull the control out from under them. */
function editingDocuments(): boolean {
  return el.documentList.contains(document.activeElement);
}

/** After an unanswered change nothing is known: show what is stored, not what was typed. */
async function reloadDocuments(): Promise<void> {
  const response = await changeDocuments({ type: "list-documents" });
  if (response) {
    documents = response.documents;
  }
  renderDocuments();
}

async function updateDocument(id: string, kind: DocumentKind, description: string): Promise<void> {
  const response = await changeDocuments({ type: "update-document", id, kind, description });
  if (!response) {
    await reloadDocuments();
    showStatus(el.documentsStatus, "Couldn’t save. Reload the extension and try again.", "error");
    return;
  }
  documents = response.documents;
  if (response.error) {
    // The stored state stands; the cards show it again so the failed edit is not mistaken for saved.
    renderDocuments();
    showStatus(el.documentsStatus, response.error, "error");
    return;
  }
  // The list already matches the edit that was just saved, unless an earlier
  // failure repainted it meanwhile; repaint when that cannot interrupt anyone.
  if (!editingDocuments()) {
    renderDocuments();
  }
  showStatus(el.documentsStatus, "Saved.", "ok");
}

async function removeDocument(id: string, fileName: string): Promise<void> {
  const response = await changeDocuments({ type: "remove-document", id });
  if (!response) {
    await reloadDocuments();
    showStatus(el.documentsStatus, "Couldn’t remove it. Reload the extension and try again.", "error");
    return;
  }
  documents = response.documents;
  renderDocuments();
  if (response.error) {
    showStatus(el.documentsStatus, response.error, "error");
    return;
  }
  showStatus(el.documentsStatus, removedText(fileName), "ok");
}

// ---- Settings view ------------------------------------------------------------------

for (const [kind, label] of Object.entries(ENGINE_LABELS) as [EngineKind, string][]) {
  const option = document.createElement("option");
  option.value = kind;
  option.textContent = label;
  el.engineSelect.append(option);
}

el.engineSelect.addEventListener("change", () => {
  const engine = el.engineSelect.value as EngineKind;
  const previousDefault = DEFAULT_ENDPOINTS[settings.engine];
  if (el.endpointInput.value === "" || el.endpointInput.value === previousDefault) {
    el.endpointInput.value = DEFAULT_ENDPOINTS[engine];
  }
});

el.testConnectionButton.addEventListener("click", () => void testConnection());
el.saveSettingsButton.addEventListener("click", () => void saveSettings());

function settingsFromForm(): Settings {
  return normalizeSettings({
    engine: el.engineSelect.value,
    endpoint: el.endpointInput.value.trim(),
    model: el.modelInput.value.trim(),
    useModel: el.useModelInput.checked,
    overwrite: el.overwriteInput.checked,
    summary: el.summaryInput.checked,
  });
}

function renderSettings(): void {
  el.useModelInput.checked = settings.useModel;
  el.engineSelect.value = settings.engine;
  el.endpointInput.value = settings.endpoint;
  el.modelInput.value = settings.model;
  el.overwriteInput.checked = settings.overwrite;
  el.summaryInput.checked = settings.summary;
}

async function testConnection(): Promise<void> {
  if (!isLocalEndpoint(el.endpointInput.value.trim())) {
    showStatus(el.settingsStatus, "The endpoint must be on localhost or 127.0.0.1.", "error");
    return;
  }
  const candidate = settingsFromForm();
  showStatus(el.settingsStatus, "Testing…");
  const response = (await platform.sendMessage({ type: "probe-engine", settings: candidate })) as ProbeEngineResponse | undefined;
  const result = response?.status ?? { state: "unreachable" as const };
  showStatus(el.settingsStatus, describeStatusShort(result, candidate.engine), result.state === "ok" ? "ok" : "error");
  el.modelOptions.replaceChildren();
  if (result.state === "ok") {
    for (const model of result.models) {
      const option = document.createElement("option");
      option.value = model;
      el.modelOptions.append(option);
    }
  }
}

async function saveSettings(): Promise<void> {
  if (!isLocalEndpoint(el.endpointInput.value.trim())) {
    showStatus(el.settingsStatus, "The endpoint must be on localhost or 127.0.0.1.", "error");
    return;
  }
  const response = (await platform.sendMessage({ type: "save-settings", settings: settingsFromForm() })) as
    | GetSettingsResponse
    | undefined;
  if (!response) {
    showStatus(el.settingsStatus, "Couldn’t save. Reload the extension and try again.", "error");
    return;
  }
  settings = response.settings;
  renderSettings();
  showStatus(el.settingsStatus, "Saved.", "ok");
  void probe();
}

function showStatus(target: HTMLElement, text: string, tone?: "ok" | "error"): void {
  target.textContent = text;
  target.hidden = false;
  if (tone) {
    target.dataset.tone = tone;
  } else {
    delete target.dataset.tone;
  }
}

// ---- Boot ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const [settingsResponse, profileResponse, documentsResponse, open] = (await Promise.all([
    platform.sendMessage({ type: "get-settings" }),
    platform.sendMessage({ type: "get-profile" }),
    platform.sendMessage({ type: "list-documents" }),
    platform.getSetting(SUMMARY_OPEN_KEY, true),
  ])) as [GetSettingsResponse | undefined, GetProfileResponse | undefined, ListDocumentsResponse | undefined, unknown];
  settings = normalizeSettings(settingsResponse?.settings);
  profile = normalizeProfile(profileResponse?.profile);
  state = profileClean(state);
  documents = normalizeDocuments(documentsResponse?.documents);
  summaryOpen = open !== false;
  renderSettings();
  renderProfile();
  renderDocuments();
  await probe();
}

void boot();

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`panel: missing #${id}`);
  }
  return element as T;
}
