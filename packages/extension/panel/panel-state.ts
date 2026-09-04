// Pure guard state for the panel: which operation may start, and when the
// controls are disabled. main.ts holds one PanelState, asks it before every
// scan, fill, read, or save, and paints the DOM from it; the decisions live
// here so they are unit tested.

export type Operation = "scan" | "fill" | "read-answers" | "save-answers" | "save-profile";

export interface PanelState {
  /** One operation at a time: while one runs, the others wait. */
  busy: boolean;
  /** The profile editor holds changes not yet saved. */
  profileDirty: boolean;
}

export const INITIAL_STATE: PanelState = { busy: false, profileDirty: false };

export type Refusal = "busy" | "profile-unsaved";

/**
 * Whether an operation may start now. Nothing starts while another runs.
 * Reading or saving answers stores a profile and replaces the editor's copy
 * with what was stored, which would lose unsaved edits, so both wait until
 * the profile is saved; checked at the read and again at the confirm, since
 * the editor may have been used in between.
 */
export function canStart(state: PanelState, operation: Operation): { ok: true } | { ok: false; reason: Refusal } {
  if (state.busy) {
    return { ok: false, reason: "busy" };
  }
  if (state.profileDirty && (operation === "read-answers" || operation === "save-answers")) {
    return { ok: false, reason: "profile-unsaved" };
  }
  return { ok: true };
}

export function begin(state: PanelState): PanelState {
  return { ...state, busy: true };
}

export function finish(state: PanelState): PanelState {
  return { ...state, busy: false };
}

export function profileEdited(state: PanelState): PanelState {
  return { ...state, profileDirty: true };
}

/** After a successful profile save, or a fresh load: the editor matches what is stored. */
export function profileClean(state: PanelState): PanelState {
  return { ...state, profileDirty: false };
}

/** A button that acts on a selection is disabled while busy and while nothing is selected; enabled again as soon as neither holds. */
export function actionDisabled(state: PanelState, idle: boolean): boolean {
  return state.busy || idle;
}
