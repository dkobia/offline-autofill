import { describe, expect, it } from "vitest";
import { INITIAL_STATE, actionDisabled, begin, canStart, finish, profileClean, profileEdited, type Operation } from "./panel-state";

const OPERATIONS: Operation[] = ["scan", "fill", "read-answers", "save-answers", "save-profile"];

describe("canStart", () => {
  it("lets anything start from rest, and nothing while an operation runs", () => {
    for (const operation of OPERATIONS) {
      expect(canStart(INITIAL_STATE, operation)).toEqual({ ok: true });
      expect(canStart(begin(INITIAL_STATE), operation)).toEqual({ ok: false, reason: "busy" });
    }
  });

  it("holds reading and saving answers while the profile editor has unsaved changes, and nothing else", () => {
    const dirty = profileEdited(INITIAL_STATE);
    expect(canStart(dirty, "read-answers")).toEqual({ ok: false, reason: "profile-unsaved" });
    expect(canStart(dirty, "save-answers")).toEqual({ ok: false, reason: "profile-unsaved" });
    expect(canStart(dirty, "scan")).toEqual({ ok: true });
    expect(canStart(dirty, "fill")).toEqual({ ok: true });
    expect(canStart(dirty, "save-profile")).toEqual({ ok: true });
  });

  it("reports busy before unsaved changes, and lets answers through once the profile is saved", () => {
    const both = begin(profileEdited(INITIAL_STATE));
    expect(canStart(both, "save-answers")).toEqual({ ok: false, reason: "busy" });
    expect(canStart(profileClean(finish(both)), "save-answers")).toEqual({ ok: true });
  });
});

describe("lifecycle", () => {
  it("returns new states and leaves the old ones alone", () => {
    const running = begin(INITIAL_STATE);
    expect(running.busy).toBe(true);
    expect(INITIAL_STATE.busy).toBe(false);
    expect(finish(running)).toEqual(INITIAL_STATE);
    expect(profileClean(profileEdited(INITIAL_STATE))).toEqual(INITIAL_STATE);
  });

  it("keeps an edit through an operation and a finished operation through an edit", () => {
    expect(finish(begin(profileEdited(INITIAL_STATE)))).toEqual({ busy: false, profileDirty: true });
    expect(profileEdited(finish(begin(INITIAL_STATE)))).toEqual({ busy: false, profileDirty: true });
  });
});

describe("actionDisabled", () => {
  it("disables a selection button while busy or idle, and restores it when neither holds", () => {
    expect(actionDisabled(INITIAL_STATE, false)).toBe(false);
    expect(actionDisabled(INITIAL_STATE, true)).toBe(true);
    expect(actionDisabled(begin(INITIAL_STATE), false)).toBe(true);
    expect(actionDisabled(finish(begin(INITIAL_STATE)), false)).toBe(false);
  });
});
