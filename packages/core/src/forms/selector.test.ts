import { describe, expect, it } from "vitest";
import { parseDocument } from "../fixtures.test-util";
import { resolveRef, selectorPath } from "./selector";

describe("selectorPath", () => {
  it("uses a unique id when the element has one", () => {
    const document = parseDocument(`<input id="email" />`);
    const input = document.querySelector("input")!;
    expect(selectorPath(input)).toBe("#email");
  });

  it("anchors on the nearest uniquely identified ancestor", () => {
    const document = parseDocument(`
      <form id="f"><div><input name="a" /><input name="b" /></div></form>
    `);
    const [a, b] = Array.from(document.querySelectorAll("input"));
    expect(selectorPath(a!)).toBe("#f > div > input:nth-of-type(1)");
    expect(selectorPath(b!)).toBe("#f > div > input:nth-of-type(2)");
    expect(resolveRef(document, selectorPath(b!))).toBe(b);
  });

  it("ignores duplicate ids and ids that are not identifiers", () => {
    const document = parseDocument(`
      <div id="dup"><input name="a" /></div><div id="dup"><input name="b" /></div>
      <div id="has space"><input name="c" /></div>
    `);
    const [a, b, c] = Array.from(document.querySelectorAll("input"));
    expect(selectorPath(a!)).not.toContain("#dup");
    expect(resolveRef(document, selectorPath(a!))).toBe(a);
    expect(resolveRef(document, selectorPath(b!))).toBe(b);
    expect(resolveRef(document, selectorPath(c!))).toBe(c);
  });

  it("resolveRef fails closed on invalid or ambiguous selectors", () => {
    const document = parseDocument(`<input /><input />`);
    expect(resolveRef(document, "input")).toBeUndefined();
    expect(resolveRef(document, "#[")).toBeUndefined();
    expect(resolveRef(document, "#nope")).toBeUndefined();
  });
});
