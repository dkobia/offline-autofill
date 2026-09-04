# AGENTS.md

## What Offline Autofill is

Offline Autofill is a browser extension that fills web forms from a profile stored only on the user's device: identity, contact details, addresses, education, and employment history, plus documents (resume, cover letter, transcript, photo) it attaches to a form's upload fields.
Field recognition runs deterministic rules first and consults a local model (Ollama, LM Studio, llama.cpp server, other localhost endpoints) only for fields the rules cannot place.
The model sees field labels, never profile values or documents.
No profile data, no document, no page content, and no telemetry ever leaves the device.

Naming: "Offline Autofill" in prose and UI, `offline-autofill` everywhere else (repo, packages, filenames).
Never mix forms.

## Layout

```
packages/
  core/            # pure logic, no browser APIs
    src/
      profile/     # the key vocabulary (keys.ts), saved answers (answers.ts), and the stored Profile shape (schema.ts)
      documents/   # the document kind vocabulary (kinds.ts) and the stored document shape (store.ts)
      forms/       # field and upload collection from a Document, stable refs, blocked-field rules, value reading (values.ts)
      mapping/     # heuristics, the model prompts + response parsers, orchestration (resolve.ts, uploads.ts)
      fill/        # plan (mappings + profile -> values, uploads + documents -> attachments) and execute (write into the DOM)
      capture/     # what the user typed by hand and asked to keep: candidates and where each goes
      summary/     # what the form is: page context + rules outline, and the model prompt + parser
  extension/
    platform/      # the only files that differ per browser, behind the Platform interface
    background/    # settings, stored profile and documents, engine clients, scan/fill orchestration
    content/       # thin: collects fields and uploads and applies approved writes via core
    panel/         # fill view, profile editor, documents, settings (sidepanel on Chrome, popup on Firefox)
  shared/          # protocol types only (type-only import of core)
manifests/         # base.json + chrome.json / firefox.json overlays, merged at build
fixtures/          # static HTML forms core is unit-tested against
demo/              # the Acme Corp demo application page, sample documents, and a sample profile (see demo/README.md)
scripts/           # esbuild build (scripts/build.mjs <chrome|firefox>), pack, icon rendering
```

## Commands

```sh
pnpm install
pnpm build            # dist/chrome + dist/firefox
pnpm build:chrome     # or build:firefox
pnpm test
pnpm typecheck
```

Load `dist/chrome` via chrome://extensions (Load unpacked) and `dist/firefox` via about:debugging (Load Temporary Add-on).

## Releasing

- Bump `version` in `manifests/base.json` and the three `packages/*/package.json` files in its own small PR, merge it, then create a GitHub Release on that commit with a matching tag (`v0.1.0`) and release notes.
  The Publish workflow (`.github/workflows/publish.yml`) runs typecheck, tests, and the build first and checks the release tag against the manifest; only when that verify job passes does it pack `dist/chrome` and publish it to the Chrome Web Store with `wdzeng/chrome-extension`.
  Feature PRs do not bump the version; merging to `main` never publishes.
- Running the workflow by hand defaults to upload-only, which stages a draft in the developer dashboard without publishing.
- Store credentials live only as GitHub Actions secrets (`PUBLISHER_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`); never commit them.
- Firefox is not yet listed; `pnpm build:firefox` produces the loadable `dist/firefox`.

## The pipeline

1. `collectFields(document)` describes every fillable control: label, aria, placeholder, nearby prose, section heading, options, visibility, editability.
2. `resolveMappings(fields, mapper?)` drops blocked and invisible fields, maps what it can with `mapByHeuristics`, and hands only the leftovers to the `FieldMapper` (the local model).
3. `planFill(fields, mappings, profile)` is the first and only point where profile values appear. It matches select options, shapes dates, and produces a reviewable plan.
4. The panel shows the plan; the user unticks what they do not want; `applyAssignments` writes the rest through the platform's own value setters and fires the events a keystroke would.
   Comboboxes (react-select and kin, flagged `combobox` by the collector) are filled by opening them, typing, and choosing the matching option; a bare write would leave search text and no selection.
   Every write is read back with case and punctuation folded, so a widget that reformats a phone number is still a fill.

Uploads run the same pipeline beside the fields: `collectUploads(document)` describes every file input (label, name, accept, section) without making it a field; `resolveUploads(uploads, mapper?)` blocks sensitive ones, maps labels to document kinds by rules (`documents/kinds.ts`), and hands the rest to the `UploadMapper` (the same local model, choosing from the kind vocabulary only); `planFill` with `options.attach` pairs each mapped upload with the newest stored document of that kind the field accepts, offering the others as choices; `applyAssignments` hands the file to the input through a `DataTransfer` and fires `input` and `change`.
The panel reviews attachments as rows like any other, and the fill counts files apart from fields.

Beside the fill pipeline, the form summary (`summary/`) tells the user what the form is.
`collectFormContext(document)` reads the title, visible headings, paragraph text, button labels, and file-input labels; `outlineForm` reduces the eligible fields and that context to facts the rules can vouch for (counts, sections, required, uploads, blocked kinds); `buildSummaryPrompt` + `parseSummaryResponse` ask the model for a purpose, steps, and notes as schema-constrained JSON.
The panel requests it with every scan (setting `summary`, default on) and shows the outline alone when no model is configured.

The capture path runs the fill pipeline backwards, on request only.
"Save answers" in the panel asks the background, which asks the content script for `collect-answers`: the page's fields and the values of the eligible ones that hold one, from a single pass (`collectAnswers`, `forms/values.ts`), so the fields the values are judged and named by are the fields of that instant.
The background runs `proposeAnswers` (`capture/candidates.ts`): the built-in heuristics and what the fill actually wrote (the panel sends the filled refs and their displayed values) decide which fields are new and where each would go (a new saved answer, an update to one asking the same question, or an empty built-in key the rules recognized).
The panel lists the candidates ticked; `applyAnswers` saves the ticked ones into the stored profile under the profile lock and reports what changed.
Saved answers are then keys: `answer.<id>`, described by their question, matched by the heuristics on whole-label equality (and sentence-length containment as a guess) before the patterns run, and offered to the model beside the built-in keys.

## Invariants

- `packages/core` is pure logic. Standard DOM types (`Document`, `Element`) are fine; `chrome.*` / `browser.*` and network calls never.
  This keeps core testable against static HTML fixtures without a browser.
- Browser-specific code lives only in `packages/extension/platform/`, behind the `Platform` interface.
  The build aliases `@platform` to the right implementation per target.
- The model maps fields to keys and uploads to document kinds; it never sees a profile value or a document.
  Nothing before `planFill` may carry one, and no prompt may ever include one: not a file, not its name, not the user's description of it.
  The summary prompt carries page text (title, headings, paragraphs, buttons) and field labels, types, sections, and required flags; still never a value, never a field ref.
  A saved answer's question is a key description and may be in the mapping prompt; its answer is a value and may not.
  The mapping layer receives answers only as `AnswerSpec` (key, question, shape), a type that cannot carry the answer.
- Page values enter the extension only on the user's request.
  The collector reports `hasValue`, never the value; `collectAnswers` runs only for the `collect-answers` message the background sends when the user clicks "Save answers", reads only fields the scan would offer, judges them in the same pass it reads them, and its result travels on its own type (`ReadValue`, `AnswerCandidate`) that no prompt builder accepts.
  A combobox widget's choice is what it displays beside its input (`comboboxDisplayedValue`), not the input's value, which react-select clears after a pick; the collector, the value reader, and the executor's readback all judge it that way.
  Nothing is stored until the user ticks and saves; the candidate rule (`capture/candidates.ts`) is rules-only, never the model.
- All inference is local. No code path may send page content, profile data, prompts, or metadata to a remote host.
  Engine endpoints are localhost only; adding a permission or host beyond that needs explicit justification.
- Zero telemetry. No analytics, no error reporting services, no update pings beyond what browser stores do themselves.
- Deterministic first, model second. The extension must work fully with no model configured; the model only reduces the "not recognized" list.
  Heuristics match short labels only: a label shaped like a question (a "?" or more than eight words) is a custom screening question and belongs to the model, whatever keywords or input type it carries; only an explicit `autocomplete` token, or a saved answer whose question is that whole label, outranks that.
  A textarea takes only prose keys (and the street address) and any saved answer; a single-line input never takes a multi-line answer; those rules filter model answers too.
- File inputs are never fields.
  They are collected apart (`forms/uploads.ts`), mapped to document kinds, never to profile keys, and receive only stored documents the user reviewed; document content never feeds a text field.
  Visibility is not required of a file input (application systems hide the real control behind a styled button); disabled ones are skipped.
  An upload whose label reads as an identity document, card, or bank paper is blocked like the matching fields.
- Blocked fields are never filled and never offered to the model: passwords, one-time codes, payment cards, bank accounts, government identifiers (`forms/sensitivity.ts`).
  Signals only escalate; page markup cannot launder a sensitive field into a harmless one.
  The summary prompt names only the kinds of blocked fields ("a password"), never the fields, and the outline's blocked list is rules-only so a page cannot talk the summary out of it.
- Hidden, off-screen, disabled, and read-only fields are never filled.
  The content script supplies the live visibility check, at scan time and again right before each write; core's default is markup-only and stricter environments are always allowed.
- Nothing is written without review. The panel shows every value before it is filled, and the fill writes only what the user left ticked.
- Engines implement the `FieldMapper` and `FormSummarizer` contracts defined in core; the extension owns the concrete HTTP clients and constrains their output with the JSON schema core builds.
  Model output is display-only for the summary and key-only for mapping; nothing a model says is ever written to a page.
- Manifest changes go in `manifests/base.json` unless genuinely browser-specific.

## Profile

- The key vocabulary lives in `packages/core/src/profile/keys.ts`.
  Adding a key means adding it there with a plain-words description (the model reads it) and, if it needs new matching, a pattern in `mapping/heuristics.ts` plus a fixture assertion.
- Sections: identity and contact (single), address, education, employment (repeating).
  Financial data, government identifiers, and credentials are deliberately not part of the profile; adding such a tier requires encryption at rest and per-fill confirmation first.
- Saved answers (`profile/answers.ts`) live in the profile as a list beside the sections: an id, a question, an answer, and whether it is multi-line.
  They are a user-defined vocabulary, not a section: the question describes the key `answer.<id>`, and the answer is the value.
  One answer per question, reused across sites; the editor shows them as the "Saved answers" section after Employment.
  A candidate whose label the rules map to a built-in key is saved into that key, never as an answer that duplicates one.
- The profile is stored in extension storage (`storage.local`) as plain JSON in this version.
  Encryption with a user passphrase is planned; until it lands, the README and privacy policy must say so plainly.
- Documents live beside the profile, not inside it: a metadata index under `documents` and each file's bytes, base64, under `document:<id>`, so listing never reads a byte.
  The kind vocabulary is `documents/kinds.ts`; adding a kind means a label, a plain-words description (the model reads it), and a pattern for labels and file names, plus a test.
  Identity documents are deliberately not a kind, for the reason government identifiers are not in the profile.
  Documents are capped at 10 MB each; the `unlimitedStorage` permission exists for them.
  No model summary of a document: the model would need extracted text (PDF extraction is a large dependency) and could only ever show the result, never fill from it; the user's own description covers the need.

## Testing

- Vitest: `pnpm test` (or `pnpm test:watch`). Tests are colocated as `*.test.ts` next to the code they cover.
- Core is tested against `fixtures/*.html` parsed with linkedom - no browser required.
  New collection, mapping, or fill behavior needs a fixture (or an addition to one) plus a test asserting the expected result.
  `fixtures/ats-application.html` is a trimmed real ATS form (react-select comboboxes, hidden file inputs, sentence-length questions); keep it representative when touching comboboxes or heuristics.
- Fixtures taken from real sites are anonymized: name them for the kind of form (`ats-application`, `checkout`, `bank-signup`), not the vendor; strip vendor and company names, branding, and tracking ids; keep only the markup that matters (control types, aria, labels, wrappers) and note the pattern it captures in a leading comment.
  The repo is public and fixtures are not an endorsement or a claim about anyone's site.
- `background/service.test.ts` drives the whole scan-plan-fill round trip, and the read-answers/save-answers round trip, through a fake Platform whose tab is a fixture; extend it when the protocol changes.
  `fixtures/screening-questions.html` is the capture fixture; `answered.test-util.ts` fills it in the way a person would (live values, not attributes).
- `demo/index.html` is the designed demo page, not a fixture: it is tested once, by `demo-page.test.ts`, which says which field the rules must map to which key, what stays for the model, and what is refused.
  Change the page and that test together; never point a behavior test at it.
  The PDFs in `demo/documents/` are rendered from `demo/documents/src/` by `scripts/render-demo-documents.sh`.
- Behavior changes require new or updated tests.
- Exercise per-browser code through the `Platform` interface; don't mock `chrome.*` / `browser.*` inline.
- Panel logic that decides what to show lives in pure modules (`plan-view.ts`, `answers-view.ts`, `panel-state.ts`, `profile-form.ts`, `documents-view.ts`, `status-view.ts`, `summary-view.ts`) with tests; `main.ts` only renders and wires.
  `panel-state.ts` decides which operation may start (one at a time; no answer read or save while the profile editor has unsaved changes) and when action buttons are disabled.

## Style

- TypeScript strict mode, ESM throughout. Match the surrounding code's conventions.
- Keep dependencies minimal; justify any new one.
- Run `pnpm test`, `pnpm typecheck`, and `pnpm build` before committing.
