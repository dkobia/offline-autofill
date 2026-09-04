// Shared helper for core tests: the screening fixture with every control
// answered, as a person typing would (live values, not attributes).

import { loadFixture } from "./fixtures.test-util";

export function typeInto(document: Document, selector: string, value: string): void {
  const element = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!element) throw new Error(`no ${selector}`);
  element.value = value;
}

export function choose(document: Document, selector: string, value: string): void {
  const select = document.querySelector(selector) as HTMLSelectElement | null;
  if (!select) throw new Error(`no ${selector}`);
  // linkedom clears every selection when an option is set to false; select the one, as a click would.
  for (const option of select.querySelectorAll("option")) {
    if (option.getAttribute("value") === value) {
      option.selected = true;
    }
  }
}

export function check(document: Document, selector: string): void {
  const radio = document.querySelector(selector) as HTMLInputElement | null;
  if (!radio) throw new Error(`no ${selector}`);
  radio.checked = true;
}

export const WHY_ANSWER = "Because the work matters.\nAnd the people.";

export function answeredScreening(): Document {
  const document = loadFixture("screening-questions.html");
  typeInto(document, "#email", "ada@example.com");
  typeInto(document, "#linkedin", "https://linkedin.com/in/ada");
  typeInto(document, "#pronouns", "she/her");
  typeInto(document, "#salary", "£90,000");
  choose(document, "#authorized", "y");
  check(document, 'input[name="sponsorship"][value="no"]');
  typeInto(document, "#why", WHY_ANSWER);
  typeInto(document, "#source", "A friend");
  typeInto(document, "#mystery", "42");
  typeInto(document, "#password", "hunter2");
  return document;
}
