import { describe, expect, it } from "vitest";
import { qualifyRef, splitRef } from "./frame-refs";

describe("frame refs", () => {
  it("leaves the top frame's refs bare", () => {
    expect(qualifyRef(0, "#given")).toBe("#given");
    expect(splitRef("#given")).toEqual({ frameId: 0, ref: "#given" });
  });

  it("names a subframe in front of its selector and reads it back", () => {
    expect(qualifyRef(42, "#given")).toBe("42@#given");
    expect(splitRef("42@#given")).toEqual({ frameId: 42, ref: "#given" });
  });

  it("keeps a selector that contains the separator intact", () => {
    const ref = "form > div:nth-of-type(2) > input[name=\"a@b\"]";
    expect(splitRef(qualifyRef(3, ref))).toEqual({ frameId: 3, ref });
    expect(splitRef(ref)).toEqual({ frameId: 0, ref });
  });

  it("treats a malformed prefix as a top-frame ref", () => {
    expect(splitRef("@#x")).toEqual({ frameId: 0, ref: "@#x" });
    expect(splitRef("7@")).toEqual({ frameId: 0, ref: "7@" });
  });
});
