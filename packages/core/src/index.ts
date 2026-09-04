// @offline-autofill/core: pure logic, no browser APIs, no network.
//
// The pipeline, in order:
//   collectFields   - the document's fillable controls and the text around them
//   resolveMappings - heuristics, then a FieldMapper (local model) for the rest
//   planFill        - mappings + profile -> concrete values, for the user to review
//   applyAssignments - write the approved values into the live document
//
// Beside it, summary/ describes the form to the user: collectFormContext and
// outlineForm by rules, buildSummaryPrompt + parseSummaryResponse by model.
//
// Beside both, documents/ and forms/uploads.ts carry the attachment path:
// collectUploads describes file inputs, resolveUploads maps them to document
// kinds (rules, then the UploadMapper), and planFill pairs each with a stored
// document. The model sees upload labels and the kind vocabulary only.
//
// Profile values (and documents) enter only at planFill. Nothing before it,
// including the prompt handed to a model, ever carries one.

export {
  PROFILE_SECTIONS,
  PROFILE_KEYS,
  isProfileKey,
  splitKey,
  sectionSpec,
  fieldSpec,
  describeKeys,
  type SectionId,
  type FieldKind,
  type FieldSpec,
  type SectionSpec,
  type ProfileKey,
} from "./profile/keys";
export {
  PROFILE_VERSION,
  emptyProfile,
  normalizeProfile,
  isProfileEmpty,
  resolveValue,
  answerOf,
  entryCount,
  type Profile,
  type SectionValues,
} from "./profile/schema";
export {
  ANSWER_KEY_PREFIX,
  MAX_QUESTION_CHARS,
  answerKey,
  isAnswerKey,
  answerIdOf,
  newAnswerId,
  cleanQuestion,
  foldQuestion,
  normalizeAnswers,
  describeAnswers,
  type SavedAnswer,
  type AnswerSpec,
  type AnswerKey,
  type FillKey,
} from "./profile/answers";

export {
  DOCUMENT_KINDS,
  PLANNABLE_KINDS,
  isDocumentKind,
  documentKindSpec,
  documentKey,
  matchDocumentKind,
  guessDocumentKind,
  describeKinds,
  type DocumentKind,
  type DocumentKey,
  type DocumentKindSpec,
} from "./documents/kinds";
export {
  MAX_DOCUMENT_BYTES,
  MAX_DESCRIPTION_CHARS,
  normalizeDocuments,
  newestFirst,
  acceptsFile,
  base64ByteLength,
  decodeBase64,
  type StoredDocument,
} from "./documents/store";

export { selectorPath, resolveRef } from "./forms/selector";
export {
  collectFields,
  defaultEnvironment,
  explicitLabel,
  nearbyText,
  isComboboxInput,
  chosenOption,
  isChecked,
  comboboxDisplayedValue,
  type CollectedField,
  type CollectEnvironment,
  type FieldOption,
  type FieldTag,
} from "./forms/collect";
export { collectUploads, uploadLabel, type UploadField } from "./forms/uploads";
export { readValues, collectAnswers, type ReadValue, type CollectedAnswers } from "./forms/values";
export { assessField, assessText, assessDocumentText, type BlockReason, type BlockVerdict } from "./forms/sensitivity";

export type { FieldMapping, MappingSource } from "./mapping/types";
export { mapByHeuristics, normalizeEntries, entryIndexOf, keyFitsField, isQuestion, type HeuristicResult } from "./mapping/heuristics";
export { buildMappingPrompt, mappingResponseSchema, promptFieldOf, type MappingPrompt, type PromptField } from "./mapping/prompt";
export { parseMappingResponse, extractJson, MODEL_CONFIDENCE } from "./mapping/parse";
export { resolveMappings, eligibleFields, type FieldMapper, type MapFieldsOptions, type ResolveOptions, type ResolveResult } from "./mapping/resolve";
export {
  resolveUploads,
  eligibleUploads,
  mapUploadsByHeuristics,
  assessUpload,
  buildUploadPrompt,
  uploadResponseSchema,
  parseUploadResponse,
  type UploadMapping,
  type UploadMapper,
  type UploadHeuristicResult,
  type UploadResolveResult,
  type UploadPrompt,
} from "./mapping/uploads";

export {
  planFill,
  planAttachments,
  matchOption,
  shapeDate,
  type Assignment,
  type Attachment,
  type AttachmentChoice,
  type AttachInput,
  type FillPlan,
  type PlanOptions,
  type Skipped,
  type SkipReason,
} from "./fill/plan";
export {
  applyAssignments,
  foldValue,
  sameValue,
  type ApplyOptions,
  type FillOutcome,
  type FilePayload,
  type WriteFailure,
  type WriteRequest,
} from "./fill/execute";

// Capture: what the user typed by hand and asked to keep. readValues is the
// only path by which a page value enters the extension; proposeAnswers says
// where each would be kept, and applyAnswers saves the ones the user ticked.
export {
  proposeAnswers,
  applyAnswers,
  type AnswerCandidate,
  type CandidateTarget,
  type CaptureInput,
  type PlannedValue,
  type SaveOutcome,
} from "./capture/candidates";

// Form summary: what the form is, by rules (outline) and, optionally, by the
// model (prompt + parse). Neither path ever carries a profile value.
export { collectFormContext, type FormContext } from "./summary/context";
export { outlineForm, blockReasonPhrase, type FormOutline } from "./summary/outline";
export { buildSummaryPrompt, MAX_PROMPT_FIELDS, type SummaryPrompt } from "./summary/prompt";
export { parseSummaryResponse } from "./summary/parse";
export type { FormSummary, FormSummarizer, SummaryInput } from "./summary/types";
