import { describe, expect, it } from "vitest";
import { MAX_HOW_TO, MAX_ITEM_CHARS, MAX_NOTES, MAX_PURPOSE_CHARS, parseSummaryResponse } from "./parse";

describe("parseSummaryResponse", () => {
  it("reads a plain answer", () => {
    expect(parseSummaryResponse('{"purpose":"A job application.","howTo":["Fill it in"],"notes":[]}')).toEqual({
      purpose: "A job application.",
      howTo: ["Fill it in"],
      notes: [],
    });
  });

  it("tolerates fences and prose, strips list markers, and drops empties and duplicates", () => {
    const text = 'Sure!\n```json\n{"purpose":"  A   checkout form. ","howTo":["1. Add address"," - Pay","","- Pay"],"notes":["• Ships in 3 days"]}\n```';
    expect(parseSummaryResponse(text)).toEqual({
      purpose: "A checkout form.",
      howTo: ["Add address", "Pay"],
      notes: ["Ships in 3 days"],
    });
  });

  it("caps lengths and list sizes", () => {
    const long = "x".repeat(1000);
    const parsed = parseSummaryResponse(
      JSON.stringify({ purpose: long, howTo: Array.from({ length: 10 }, (_, i) => `step ${i}`), notes: Array.from({ length: 10 }, (_, i) => i + long) }),
    )!;
    expect(parsed.purpose).toHaveLength(MAX_PURPOSE_CHARS);
    expect(parsed.purpose.endsWith("…")).toBe(true);
    expect(parsed.howTo).toHaveLength(MAX_HOW_TO);
    expect(parsed.notes).toHaveLength(MAX_NOTES);
    expect(parsed.notes[0]).toHaveLength(MAX_ITEM_CHARS);
  });

  it("gives up without a purpose or without JSON", () => {
    expect(parseSummaryResponse('{"howTo":["x"],"notes":[]}')).toBeUndefined();
    expect(parseSummaryResponse('{"purpose":"","howTo":[],"notes":[]}')).toBeUndefined();
    expect(parseSummaryResponse("I cannot help with that.")).toBeUndefined();
    expect(parseSummaryResponse("")).toBeUndefined();
    expect(parseSummaryResponse("[1,2]")).toBeUndefined();
  });

  it("ignores non-string list items and non-array lists", () => {
    expect(parseSummaryResponse('{"purpose":"P","howTo":[1,null,"ok"],"notes":"nope"}')).toEqual({ purpose: "P", howTo: ["ok"], notes: [] });
  });
});
