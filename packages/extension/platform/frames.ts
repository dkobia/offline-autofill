// Which frames of a tab are asked for a form. Shared by both platforms: the
// browsers agree on frame ids, on 0 for the top frame, and on what
// getAllFrames reports; only the API namespace differs.

/** The id of a tab's top-level frame, in every browser. */
export const TOP_FRAME = 0;

/** Frames whose document a content script can run in; blank and data frames (ads, widgets) are left alone. */
const PAGE_URL = /^(https?|file):/;

export interface FrameDetails {
  frameId: number;
  url: string;
  errorOccurred?: boolean | undefined;
}

/**
 * The top frame always (even when the listing is empty), then the page-like
 * subframes by ascending id. Nothing but ids leaves here: the URLs the
 * browser reports are looked at and dropped.
 */
export function pageFrames(frames: FrameDetails[]): number[] {
  const ids = frames
    .filter((frame) => frame.frameId !== TOP_FRAME && !frame.errorOccurred && PAGE_URL.test(frame.url))
    .map((frame) => frame.frameId)
    .sort((a, b) => a - b);
  return [TOP_FRAME, ...ids];
}
