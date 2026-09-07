import { describe, expect, it } from "vitest";
import { pageFrames, TOP_FRAME } from "./frames";

describe("pageFrames", () => {
  it("keeps the top frame first and the page-like subframes by id", () => {
    expect(
      pageFrames([
        { frameId: 42, url: "https://job-boards.greenhouse.io/embed/job_app?for=acme" },
        { frameId: 0, url: "https://acme.example/careers/apply/1" },
        { frameId: 7, url: "https://acme.example/careers/widget" },
      ]),
    ).toEqual([TOP_FRAME, 7, 42]);
  });

  it("leaves blank, data, and failed frames alone", () => {
    expect(
      pageFrames([
        { frameId: 0, url: "https://acme.example/" },
        { frameId: 3, url: "about:blank" },
        { frameId: 4, url: "data:text/html,<p>ad</p>" },
        { frameId: 5, url: "https://gone.example/", errorOccurred: true },
        { frameId: 6, url: "file:///Users/me/form.html" },
      ]),
    ).toEqual([TOP_FRAME, 6]);
  });

  it("answers the top frame when the listing is empty", () => {
    expect(pageFrames([])).toEqual([TOP_FRAME]);
  });
});
