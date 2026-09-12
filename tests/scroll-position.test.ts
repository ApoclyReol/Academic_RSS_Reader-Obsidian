import { Window as HappyWindow } from "happy-dom";
import { describe, expect, it } from "vitest";

import {
  captureScrollTop,
  isScrollAtBottom,
  restoreScrollTop,
  scrollToTop,
} from "../src/views/scroll-position";

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

  it("moves the reader back to the top", () => {
    const window = new HappyWindow();
    const container = window.document.body;
    container.scrollTop = 512;

    scrollToTop(container);

    expect(container.scrollTop).toBe(0);
  });

  it("detects when the reader has reached the scroll end", () => {
    const window = new HappyWindow();
    const container = window.document.body;
    Object.defineProperties(container, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1600 },
    });
    container.scrollTop = 995;
    expect(isScrollAtBottom(container)).toBe(false);
    container.scrollTop = 1000;
    expect(isScrollAtBottom(container)).toBe(true);
  });
});
