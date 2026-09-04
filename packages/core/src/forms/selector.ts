// Stable element references. A field is referred to by a CSS selector path
// that is human-readable, re-resolvable at fill time, and independent of
// object identity (the background never sees DOM nodes, only refs).

const IDENT = /^[A-Za-z_][\w-]*$/;

function escapeIdent(value: string): string {
  // CSS.escape is not available in every environment core runs in (linkedom).
  return value.replace(/([^\w-])/g, "\\$1");
}

function idIsUnique(element: Element, id: string): boolean {
  const root = element.ownerDocument;
  return root.querySelectorAll(`[id="${id.replace(/"/g, '\\"')}"]`).length === 1;
}

function segmentFor(element: Element): string {
  const tag = element.localName;
  const parent = element.parentElement;
  if (!parent) {
    return tag;
  }
  const siblings = Array.from(parent.children).filter((child) => child.localName === tag);
  if (siblings.length === 1) {
    return tag;
  }
  return `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`;
}

/**
 * A selector that resolves to exactly this element in its document: the
 * nearest ancestor-or-self with a unique id, then nth-of-type steps below it.
 */
export function selectorPath(element: Element): string {
  const steps: string[] = [];
  for (let current: Element | null = element; current; current = current.parentElement) {
    const id = current.getAttribute("id");
    if (id && IDENT.test(id) && idIsUnique(current, id)) {
      steps.unshift(`#${escapeIdent(id)}`);
      return steps.join(" > ");
    }
    steps.unshift(segmentFor(current));
  }
  return steps.join(" > ");
}

/** Resolves a ref; undefined when it matches nothing or more than one element. */
export function resolveRef(document: Document, ref: string): Element | undefined {
  let matches: NodeListOf<Element>;
  try {
    matches = document.querySelectorAll(ref);
  } catch {
    return undefined;
  }
  return matches.length === 1 ? matches[0] : undefined;
}
