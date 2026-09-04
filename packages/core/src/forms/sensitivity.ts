// Fields the extension refuses to fill, whatever any mapping says.
// Every attribute here is page-controlled markup, so signals only ever
// escalate: a friendly label cannot launder a password or card field.
// Credentials, payment cards, bank accounts, government identifiers, and
// one-time codes are outside the v1 profile and outside the fill path.

import type { CollectedField } from "./collect";

export type BlockReason = "password" | "one-time-code" | "payment-card" | "bank-account" | "government-id";

export interface BlockVerdict {
  blocked: boolean;
  reason?: BlockReason;
}

const AUTOCOMPLETE_BLOCKS: [RegExp, BlockReason][] = [
  [/^(current-password|new-password)$/, "password"],
  [/^one-time-code$/, "one-time-code"],
  [/^cc-/, "payment-card"],
];

const TEXT_BLOCKS: [RegExp, BlockReason][] = [
  [/\bssn\b|social[ -]?security|\bitin\b|tax(payer)?[ -]?id|\bpassport\b|driver'?s?[ -]?licen[cs]e|national[ -]?id/u, "government-id"],
  [/credit[ -]?card|debit[ -]?card|card[ -]?(number|no\b|num\b)|\bcvv\b|\bcvc\b|\bcsc\b|card[ -]?exp|expiry/u, "payment-card"],
  [/\biban\b|\brouting\b|account[ -]?number|sort[ -]?code|\bswift\b|\bbic\b|bank[ -]?account/u, "bank-account"],
  [/\bpassword\b|\bpasscode\b|\bpassphrase\b|\bpin\b|\bsecret\b/u, "password"],
  [/\botp\b|one[ -]?time[ -]?(code|password)|verification[ -]?code|\b2fa\b|\bmfa\b/u, "one-time-code"],
];

/**
 * Documents a form may ask to be uploaded that the extension refuses to
 * attach, on top of the field rules: identity papers, bank papers. Judged
 * over upload labels, identifiers, and section headings; like the field
 * rules, a match only ever blocks.
 */
const DOCUMENT_BLOCKS: [RegExp, BlockReason][] = [
  [
    /\b(government|photo|national|state)[ -]?(issued[ -]?)?id\b|\bid (card|document|scan|copy|photo|upload)\b|\bidentity (card|document|proof|verification)\b|\bproof of (identity|id|address|citizenship|residen[ct][ey])\b|\bidentification\b|\b(work|residence) permit\b|\bbirth certificate\b|\bvisa (copy|scan|page|document)\b/u,
    "government-id",
  ],
  [/\b(payment|credit|debit|bank) cards?\b|\bcard (copy|copies|scans?|images?|photos?|statements?|front|back)\b/u, "payment-card"],
  [/\bbank statements?\b|\bvoid(ed)? che(ck|que)\b|\bdirect deposit\b|\bpay ?(stubs?|slips?)\b/u, "bank-account"],
];

/** Split identifier-ish strings (camelCase, snake, kebab) into words. */
export function tokenize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.:[\]]+/g, " ")
    .toLowerCase();
}

export function assessField(field: CollectedField): BlockVerdict {
  if (field.type === "password") {
    return { blocked: true, reason: "password" };
  }
  const autocompleteToken = field.autocomplete
    ?.split(/\s+/)
    .filter((t) => !/^(section-.*|shipping|billing|home|work|mobile|fax|pager|webauthn)$/.test(t))
    .pop();
  if (autocompleteToken) {
    for (const [pattern, reason] of AUTOCOMPLETE_BLOCKS) {
      if (pattern.test(autocompleteToken)) {
        return { blocked: true, reason };
      }
    }
  }
  return assessText([
    field.label,
    field.ariaLabel,
    field.placeholder,
    field.nearbyText,
    field.name ? tokenize(field.name) : undefined,
    field.id ? tokenize(field.id) : undefined,
  ]);
}

/** The word rules alone, over any text a control is described by. */
export function assessText(parts: (string | undefined)[]): BlockVerdict {
  return judge(parts, TEXT_BLOCKS);
}

/** The word rules plus the document rules, for what an upload asks to be attached. */
export function assessDocumentText(parts: (string | undefined)[]): BlockVerdict {
  return judge(parts, [...TEXT_BLOCKS, ...DOCUMENT_BLOCKS]);
}

function judge(parts: (string | undefined)[], rules: [RegExp, BlockReason][]): BlockVerdict {
  const corpus = parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
  for (const [pattern, reason] of rules) {
    if (pattern.test(corpus)) {
      return { blocked: true, reason };
    }
  }
  return { blocked: false };
}
