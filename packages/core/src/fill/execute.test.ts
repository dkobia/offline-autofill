import { describe, expect, it } from "vitest";
import { loadFixture, parseDocument } from "../fixtures.test-util";
import { applyAssignments, sameValue } from "./execute";

describe("applyAssignments", () => {
  it("writes text, selects, and radios, firing input and change", async () => {
    const document = loadFixture("contact-form.html");
    const events: string[] = [];
    for (const name of ["input", "change"]) {
      document.getElementById("contact")!.addEventListener(name, (event) => {
        events.push(`${name}:${(event.target as Element).getAttribute("name")}`);
      });
    }
    const outcome = await applyAssignments(document, [
      { ref: "#given", value: "Ada" },
      { ref: "#state", value: "NY" },
      { ref: "#contact > fieldset:nth-of-type(2) > label:nth-of-type(1) > input", value: "phone" },
    ]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.filled).toHaveLength(3);
    expect((document.getElementById("given") as HTMLInputElement).value).toBe("Ada");
    expect((document.getElementById("state") as HTMLSelectElement).value).toBe("NY");
    expect(document.querySelector<HTMLInputElement>('input[name="method"][value="phone"]')!.checked).toBe(true);
    expect(events).toEqual(["input:given", "change:given", "input:state", "change:state", "input:method", "change:method"]);
  });

  it("refuses unresolvable, read-only, and unsupported targets", async () => {
    const document = loadFixture("hidden-fields.html");
    const outcome = await applyAssignments(document, [
      { ref: "#nope", value: "x" },
      { ref: "#locked", value: "x" },
      { ref: "#pass", value: "x" },
    ]);
    expect(outcome.filled).toEqual([]);
    expect(outcome.failed).toEqual([
      { ref: "#nope", reason: "unresolvable" },
      { ref: "#locked", reason: "not-editable" },
      { ref: "#pass", reason: "unsupported" },
    ]);
  });

  it("refuses a target the page hid after review", async () => {
    const document = parseDocument(`<input id="a" /><input id="b" hidden /><input id="c" />`);
    // Markup check: the hidden attribute.
    const byMarkup = await applyAssignments(document, [{ ref: "#b", value: "x" }]);
    expect(byMarkup.failed).toEqual([{ ref: "#b", reason: "not-visible" }]);
    // Live check supplied by the caller: whatever it says goes.
    const byLive = await applyAssignments(document, [{ ref: "#a", value: "x" }, { ref: "#c", value: "y" }], {
      isVisible: (element) => element.id !== "c",
    });
    expect(byLive).toEqual({ filled: ["#a"], failed: [{ ref: "#c", reason: "not-visible" }] });
    expect((document.getElementById("c") as HTMLInputElement).value).toBe("");
  });

  it("refuses controls inside a disabled fieldset", async () => {
    const document = parseDocument(`
      <fieldset disabled><legend><input id="l" /></legend><input id="d" /><select id="s"><option value="a">A</option></select></fieldset>
    `);
    const outcome = await applyAssignments(document, [
      { ref: "#l", value: "ok" },
      { ref: "#d", value: "x" },
      { ref: "#s", value: "a" },
    ]);
    expect(outcome).toEqual({
      filled: ["#l"],
      failed: [
        { ref: "#d", reason: "not-editable" },
        { ref: "#s", reason: "not-editable" },
      ],
    });
    expect((document.getElementById("d") as HTMLInputElement).value).toBe("");
  });

  it("judges a radio group by the radio that gets written, not the first one", async () => {
    const document = parseDocument(`
      <input id="a1" type="radio" name="a" value="x" hidden /><input type="radio" name="a" value="y" />
      <input id="b1" type="radio" name="b" value="x" /><input type="radio" name="b" value="y" disabled />
      <input id="c1" type="radio" name="c" value="x" /><input type="radio" name="c" value="y" hidden />
    `);
    const first = (name: string) => `#${name}1`;
    const outcome = await applyAssignments(document, [
      { ref: first("a"), value: "y" },
      { ref: first("b"), value: "y" },
      { ref: first("c"), value: "y" },
    ]);
    expect(outcome.filled).toEqual([first("a")]);
    expect(outcome.failed).toEqual([
      { ref: first("b"), reason: "not-editable" },
      { ref: first("c"), reason: "not-visible" },
    ]);
    expect(document.querySelector<HTMLInputElement>('input[name="a"][value="y"]')!.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[name="b"][value="y"]')!.checked).toBeFalsy();
  });

  it("reports a select whose options do not include the value", async () => {
    const document = parseDocument(`<select id="s"><option value="a">A</option></select>`);
    expect((await applyAssignments(document, [{ ref: "#s", value: "b" }])).failed).toEqual([
      { ref: "#s", reason: "readback-mismatch" },
    ]);
  });

  it("accepts a value the page reformatted but did not change", async () => {
    // A phone widget that hyphenates on input, as intl-tel-input does.
    const document = parseDocument(`<input id="phone" type="tel" />`);
    const phone = document.getElementById("phone") as HTMLInputElement;
    phone.addEventListener("input", () => {
      phone.value = phone.value.replace(/\s+/g, "-");
    });
    const outcome = await applyAssignments(document, [{ ref: "#phone", value: "+1 415 555 0134" }]);
    expect(outcome).toEqual({ filled: ["#phone"], failed: [] });
    expect(phone.value).toBe("+1-415-555-0134");
  });

  it("still reports a value the page replaced", async () => {
    const document = parseDocument(`<input id="zip" />`);
    const zip = document.getElementById("zip") as HTMLInputElement;
    zip.addEventListener("input", () => {
      zip.value = "00000";
    });
    expect((await applyAssignments(document, [{ ref: "#zip", value: "94105" }])).failed).toEqual([
      { ref: "#zip", reason: "readback-mismatch" },
    ]);
  });
});

describe("sameValue", () => {
  it("folds case and punctuation; a folded empty read-back never matches, an exact empty write does", () => {
    expect(sameValue("+1 415-555-0134", "+1 (415) 555 0134")).toBe(true);
    expect(sameValue("san francisco", "San Francisco")).toBe(true);
    expect(sameValue("", "")).toBe(true);
    expect(sameValue("", "x")).toBe(false);
    expect(sameValue("94105", "94106")).toBe(false);
  });
});

/**
 * A react-select-like widget: typing renders matching options into the
 * controlled listbox; clicking one shows its label beside the input, clears
 * the input, and closes the list. With `stale`, those entries show first and
 * the real results replace them after `delayMs`, like a network-backed list.
 */
function comboboxDocument(
  options: string[],
  { stale = [], delayMs = 0 }: { stale?: string[]; delayMs?: number } = {},
): { document: Document; input: HTMLInputElement; shown: Element } {
  const document = parseDocument(`
    <div class="widget">
      <div class="control">
        <div class="single-value"></div>
        <input id="country" type="text" role="combobox" aria-autocomplete="list" aria-controls="country-list" aria-expanded="false" />
      </div>
      <ul id="country-list" role="listbox"></ul>
    </div>
  `);
  const input = document.getElementById("country") as HTMLInputElement;
  const list = document.getElementById("country-list")!;
  const shown = document.querySelector(".single-value")!;
  const render = (names: string[]) => {
    list.innerHTML = "";
    for (const name of names) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.textContent = name;
      li.addEventListener("click", () => {
        shown.textContent = name;
        input.value = "";
        lastTyped = "";
        list.innerHTML = "";
      });
      list.append(li);
    }
  };
  // React's value tracker: an input event that carries the value the widget last saw is not a change.
  let lastTyped = input.value;
  input.addEventListener("input", () => {
    if (input.value === lastTyped) {
      return;
    }
    lastTyped = input.value;
    const typed = input.value.toLowerCase();
    const matching = options.filter((option) => option.toLowerCase().startsWith(typed));
    if (delayMs > 0) {
      render(stale);
      setTimeout(() => render(matching), delayMs);
    } else {
      render(matching);
    }
  });
  return { document, input, shown };
}

/** linkedom has no KeyboardEvent; the executor falls back to the global one, so a test lends it a minimal one for its duration. */
async function withKeyboardEvent<T>(document: Document, run: () => Promise<T>): Promise<T> {
  const Base = ((document.defaultView as unknown as { Event?: typeof Event } | null)?.Event ?? Event) as typeof Event;
  class MinimalKeyboardEvent extends Base {
    key: string;
    constructor(type: string, init: KeyboardEventInit = {}) {
      super(type, init);
      this.key = init.key ?? "";
    }
  }
  const world = globalThis as { KeyboardEvent?: unknown };
  const previous = world.KeyboardEvent;
  world.KeyboardEvent = MinimalKeyboardEvent;
  try {
    return await run();
  } finally {
    world.KeyboardEvent = previous;
  }
}

describe("applyAssignments on comboboxes", () => {
  it("types the value, picks the matching option, and verifies the selection", async () => {
    const { document, input, shown } = comboboxDocument(["United Kingdom", "United States", "Uruguay"]);
    const outcome = await applyAssignments(document, [{ ref: "#country", value: "United States" }]);
    expect(outcome).toEqual({ filled: ["#country"], failed: [] });
    expect(shown.textContent).toBe("United States");
    expect(input.value).toBe("");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it("reports a widget that shows a different choice than the one picked", async () => {
    const { document, input, shown } = comboboxDocument(["United States"]);
    // A widget that ignores the click and keeps showing its previous choice.
    shown.textContent = "Canada";
    for (const option of document.querySelectorAll('[role="option"]')) option.remove();
    input.addEventListener("input", () => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.textContent = "United States";
      li.addEventListener("click", () => {
        input.value = "";
        document.getElementById("country-list")!.innerHTML = "";
      });
      document.getElementById("country-list")!.replaceChildren(li);
    });
    const outcome = await applyAssignments(document, [{ ref: "#country", value: "United States" }]);
    expect(outcome.failed).toEqual([{ ref: "#country", reason: "readback-mismatch" }]);
    expect(input.value).toBe("");
  });

  it("picks through option matching rules, not exact text only", async () => {
    const { document, shown } = comboboxDocument(["United States of America", "United Kingdom"]);
    const outcome = await applyAssignments(document, [{ ref: "#country", value: "United States" }]);
    expect(outcome.filled).toEqual(["#country"]);
    expect(shown.textContent).toBe("United States of America");
  });

  it("keeps waiting past stale entries until the matching option arrives", async () => {
    const { document, shown } = comboboxDocument(["San Francisco, California, United States"], {
      stale: ["San Antonio, Texas, United States", "San Diego, California, United States"],
      delayMs: 200,
    });
    const outcome = await applyAssignments(document, [{ ref: "#country", value: "San Francisco" }]);
    expect(outcome).toEqual({ filled: ["#country"], failed: [] });
    expect(shown.textContent).toBe("San Francisco, California, United States");
  });

  it("refuses a widget the page disabled while its options were loading", async () => {
    const { document, input, shown } = comboboxDocument(["United States"], { stale: [], delayMs: 200 });
    setTimeout(() => input.setAttribute("disabled", ""), 50);
    const outcome = await applyAssignments(document, [{ ref: "#country", value: "United States" }]);
    expect(outcome).toEqual({ filled: [], failed: [{ ref: "#country", reason: "not-editable" }] });
    expect(shown.textContent).toBe("");
    expect(input.value).toBe("");
  });

  it("focuses and blurs the widget once each, never twice", async () => {
    const { document, input } = comboboxDocument(["Canada"]);
    const seen: string[] = [];
    for (const name of ["focus", "blur"]) {
      input.addEventListener(name, () => seen.push(name));
    }
    await applyAssignments(document, [{ ref: "#country", value: "Atlantis" }], { optionsTimeoutMs: 50 });
    expect(seen).toEqual(["focus", "blur"]);
  });

  it("leaves nothing behind when no option matches", async () => {
    const { document, input, shown } = comboboxDocument(["Canada", "Mexico"]);
    const outcome = await applyAssignments(document, [{ ref: "#country", value: "Atlantis" }], { optionsTimeoutMs: 100 });
    expect(outcome).toEqual({ filled: [], failed: [{ ref: "#country", reason: "no-option-match" }] });
    expect(input.value).toBe("");
    expect(shown.textContent).toBe("");
  });

  it("closes a list still open after a failed pick, and leaves alone one the widget closed itself", async () => {
    // Escape is the executor's only way to close a list.
    const open = comboboxDocument(["Canada", "Mexico"]);
    const openList = open.document.getElementById("country-list")!;
    open.input.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") openList.innerHTML = "";
    });
    const missed = await withKeyboardEvent(open.document, () =>
      applyAssignments(open.document, [{ ref: "#country", value: "Atlantis" }], { optionsTimeoutMs: 100 }),
    );
    expect(missed.failed).toEqual([{ ref: "#country", reason: "no-option-match" }]);
    expect(open.document.querySelectorAll('[role="option"]')).toHaveLength(0);

    // react-select answers Escape on a closed widget by opening it. A widget
    // that shows the dialing code rather than the option's label fails the
    // read-back after closing its list itself, and must be left closed.
    const closed = comboboxDocument(["United Kingdom +44"]);
    const closedList = closed.document.getElementById("country-list")!;
    closedList.addEventListener("click", () => void (closed.shown.textContent = "+44"));
    closed.input.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape" && closedList.children.length === 0) {
        const li = closed.document.createElement("li");
        li.setAttribute("role", "option");
        li.textContent = "United Kingdom +44";
        closedList.append(li);
      }
    });
    const mismatched = await withKeyboardEvent(closed.document, () =>
      applyAssignments(closed.document, [{ ref: "#country", value: "United Kingdom" }]),
    );
    expect(mismatched.failed).toEqual([{ ref: "#country", reason: "readback-mismatch" }]);
    expect(closed.document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(closed.input.value).toBe("");
  });

  it("treats an input backed by a native datalist as plain text", async () => {
    const document = parseDocument(`<input id="c" list="opts" /><datalist id="opts"><option value="x"></option></datalist>`);
    const outcome = await applyAssignments(document, [{ ref: "#c", value: "anything" }]);
    expect(outcome.filled).toEqual(["#c"]);
  });
});

describe("applyAssignments (files)", () => {
  /** What a browser gives a file input; linkedom has neither DataTransfer nor a files property. */
  class FakeDataTransfer {
    files: File[] = [];
    items = { add: (file: File) => void this.files.push(file) };
  }
  const file = { name: "cv.pdf", type: "application/pdf", data: btoa("%PDF-1.4 fake") };

  async function withDataTransfer<T>(run: () => Promise<T>): Promise<T> {
    const world = globalThis as { DataTransfer?: unknown };
    world.DataTransfer = FakeDataTransfer;
    try {
      return await run();
    } finally {
      delete world.DataTransfer;
    }
  }

  it("attaches a file to a hidden file input and fires input and change", async () => {
    const document = loadFixture("ats-application.html");
    const input = document.getElementById("resume") as HTMLInputElement;
    const events: string[] = [];
    for (const name of ["input", "change"]) {
      input.addEventListener(name, () => events.push(name));
    }
    const outcome = await withDataTransfer(() => applyAssignments(document, [{ ref: "#resume", file }]));
    expect(outcome).toEqual({ filled: ["#resume"], failed: [] });
    expect(input.files![0]!.name).toBe("cv.pdf");
    expect(input.files![0]!.type).toBe("application/pdf");
    expect(input.files![0]!.size).toBe(13);
    expect(events).toEqual(["input", "change"]);
  });

  it("refuses a file for anything but an enabled file input, and a value for a file input", async () => {
    const document = parseDocument(`<input id="t" /><input id="f" type="file" /><input id="d" type="file" disabled />`);
    const outcome = await withDataTransfer(() =>
      applyAssignments(document, [
        { ref: "#t", file },
        { ref: "#d", file },
        { ref: "#f", value: "cv.pdf" },
        { ref: "#nope", file },
      ]),
    );
    expect(outcome.filled).toEqual([]);
    expect(outcome.failed).toEqual([
      { ref: "#t", reason: "unsupported" },
      { ref: "#d", reason: "not-editable" },
      { ref: "#f", reason: "unsupported" },
      { ref: "#nope", reason: "unresolvable" },
    ]);
  });

  it("reports unsupported where the environment cannot build a file", async () => {
    const document = parseDocument(`<input id="f" type="file" />`);
    const outcome = await applyAssignments(document, [{ ref: "#f", file }]);
    expect(outcome.failed).toEqual([{ ref: "#f", reason: "unsupported" }]);
  });
});
