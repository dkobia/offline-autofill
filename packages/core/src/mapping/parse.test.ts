import { describe, expect, it } from "vitest";
import { parseMappingResponse } from "./parse";

const ids = new Map([
  ["f1", "#a"],
  ["f2", "#b"],
]);

describe("parseMappingResponse", () => {
  it("reads a clean answer", () => {
    const text = '{"mappings":[{"field":"f1","key":"contact.email","entry":0},{"field":"f2","key":"education.degree","entry":1}]}';
    expect(parseMappingResponse(text, ids)).toEqual([
      { ref: "#a", key: "contact.email", entry: 0, source: "model", confidence: 0.6 },
      { ref: "#b", key: "education.degree", entry: 1, source: "model", confidence: 0.6 },
    ]);
  });

  it("tolerates code fences and surrounding prose", () => {
    const text = 'Sure!\n```json\n{"mappings":[{"field":"f1","key":"contact.phone"}]}\n```\nDone.';
    expect(parseMappingResponse(text, ids)).toHaveLength(1);
    const prose = 'Here you go: {"mappings":[{"field":"f2","key":"contact.phone"}]} hope that helps';
    expect(parseMappingResponse(prose, ids)[0]?.ref).toBe("#b");
  });

  it("drops nulls, unknown ids, unknown keys, bad entries, and duplicates", () => {
    const text = JSON.stringify({
      mappings: [
        { field: "f1", key: null },
        { field: "f9", key: "contact.email" },
        { field: "f2", key: "contact.fax" },
        { field: "f2", key: "contact.email", entry: -3 },
        { field: "f2", key: "contact.phone" },
        "junk",
      ],
    });
    expect(parseMappingResponse(text, ids)).toEqual([
      { ref: "#b", key: "contact.email", entry: 0, source: "model", confidence: 0.6 },
    ]);
  });

  it("returns nothing for unparseable text", () => {
    expect(parseMappingResponse("I cannot help with that", ids)).toEqual([]);
    expect(parseMappingResponse("[]", ids)).toEqual([]);
  });
});

describe("parseMappingResponse with saved answers", () => {
  it("accepts an answer key the prompt offered and drops one it did not", () => {
    const text = '{"mappings":[{"field":"f1","key":"answer.a1"},{"field":"f2","key":"answer.zz"}]}';
    expect(parseMappingResponse(text, ids, new Set(["contact.email", "answer.a1"]))).toEqual([
      { ref: "#a", key: "answer.a1", entry: 0, source: "model", confidence: 0.6 },
    ]);
    expect(parseMappingResponse(text, ids)).toEqual([]);
  });
});
