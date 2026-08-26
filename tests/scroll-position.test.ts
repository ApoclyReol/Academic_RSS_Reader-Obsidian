import { Window as HappyWindow } from "happy-dom";
import { describe, expect, it } from "vitest";

import { captureScrollTop, restoreScrollTop } from "../src/views/scroll-position";

describe("reader scroll position", () => {
  it("captures and restores the scroll offset across a list redraw", () => {
    const window = new HappyWindow();
    const container = window.document.body;
    container.scrollTop = 640;

    const scrollTop = captureScrollTop(container);
    container.scrollTop = 0;
    restoreScrollTop(container, scrollTop);

    expect(container.scrollTop).toBe(640);
  });

  it("does not change the position when no offset was captured", () => {
    const window = new HappyWindow();
    const container = window.document.body;
    container.scrollTop = 128;

    restoreScrollTop(container, undefined);

    expect(container.scrollTop).toBe(128);
  });
});
