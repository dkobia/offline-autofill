// Shared helper for core tests: loads fixtures/*.html through linkedom.
// Suffix .test-util.ts keeps it out of both the build and the test glob.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures");

export function loadFixture(name: string): Document {
  const html = readFileSync(join(fixturesDir, name), "utf8");
  return parseHTML(html).document as unknown as Document;
}

export function parseDocument(html: string): Document {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document as unknown as Document;
}

const demoDir = join(fixturesDir, "..", "demo");

/** The demo application page (demo/index.html), guarded by a test so the rules and the page stay in step. */
export function loadDemoPage(): Document {
  const html = readFileSync(join(demoDir, "index.html"), "utf8");
  return parseHTML(html).document as unknown as Document;
}

/** The demo profile (demo/profile.json), as stored. */
export function loadDemoProfile(): unknown {
  return JSON.parse(readFileSync(join(demoDir, "profile.json"), "utf8"));
}
