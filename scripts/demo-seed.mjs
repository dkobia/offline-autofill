#!/usr/bin/env node
// Prints a snippet that loads the demo profile and documents into the
// extension's storage, for pasting into the extension's service worker
// console (chrome://extensions, "service worker"; Firefox: about:debugging,
// "Inspect"). It writes the same keys the panel writes, so the panel's
// Profile and Documents tabs show them on the next open.
//
//   node scripts/demo-seed.mjs | pbcopy

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const profile = JSON.parse(readFileSync(join(root, "demo", "profile.json"), "utf8"));

const files = [
  { id: "demo-resume", kind: "resume", fileName: "Tessa_Marlowe_Resume.pdf" },
  { id: "demo-cover-letter", kind: "coverLetter", fileName: "Tessa_Marlowe_Cover_Letter.pdf" },
];

const documents = [];
const data = {};
for (const [index, file] of files.entries()) {
  const bytes = readFileSync(join(root, "demo", "documents", file.fileName));
  documents.push({
    id: file.id,
    kind: file.kind,
    description: "",
    fileName: file.fileName,
    mimeType: "application/pdf",
    size: bytes.length,
    addedAt: new Date(Date.now() - (files.length - index) * 60_000).toISOString(),
  });
  data[`document:${file.id}`] = bytes.toString("base64");
}

const payload = JSON.stringify({ profile, documents, ...data });
process.stdout.write(
  `(globalThis.browser ?? globalThis.chrome).storage.local.set(${payload}).then(() => console.log("demo profile and documents loaded"));\n`,
);
