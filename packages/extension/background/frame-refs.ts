// A page is the set of its frames, and a field is referred to across the
// extension by one string. Core builds a ref as a selector path within one
// document and knows nothing about frames; the background qualifies a
// subframe's refs on the way in and splits them on the way out, here, so
// the panel, the plan, the fill outcome, and the answer candidates carry a
// ref as an opaque string. The top frame's refs stay bare: a single-frame
// page reads exactly as it did before frames were a concern.
//
// The form is `<frameId>@<selector>`. A selector path from core starts
// with "#" or a tag name, never a digit, so the prefix cannot collide.

import { TOP_FRAME } from "../platform/frames";

const QUALIFIED = /^(\d+)@(.+)$/s;

export interface FrameRef {
  frameId: number;
  ref: string;
}

/** The ref as the rest of the extension sees it. */
export function qualifyRef(frameId: number, ref: string): string {
  return frameId === TOP_FRAME ? ref : `${frameId}@${ref}`;
}

/** The frame a ref lives in and the ref as that frame's document knows it. */
export function splitRef(ref: string): FrameRef {
  const match = QUALIFIED.exec(ref);
  if (!match) {
    return { frameId: TOP_FRAME, ref };
  }
  return { frameId: Number(match[1]), ref: match[2]! };
}
