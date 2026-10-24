import { Window as HappyWindow } from "happy-dom";
import { readFileSync } from "node:fs";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { executeUiAction } from "../src/views/ui-action";
import { recommendationExplanation } from "../src/views/recommendation-explanation";

vi.mock("obsidian", () => ({
  Modal: class {
    modalEl: HTMLElement;

    constructor() {
      const window = new HappyWindow();
      const element = window.document.createElement("div");
      Object.assign(element, {
        addClass: (name: string) => element.classList.add(name),
      });
      window.document.body.append(element);
      this.modalEl = element as unknown as HTMLElement;
    }

    open() {}
  },
}));

import {
  ConfirmModal,
  FeedImportModal,
  FeedModal,
  GraphicalAbstractModal,
  KeywordModal,
  RecommendationModal,
  confirmGoogleTranslation,
} from "../src/views/modals";
import type RssReaderPlugin from "../src/main";
import { Modal } from "obsidian";

const plugin = { app: {} } as RssReaderPlugin;
const modalFactories = [
  ["confirmation", () => new ConfirmModal(plugin.app, "", () => undefined)],
  ["feed", () => new FeedModal(plugin, null, () => undefined)],
  ["import", () => new FeedImportModal(plugin, () => undefined)],
  ["image", () => new GraphicalAbstractModal(plugin, { imageUrl: null, title: "" })],
  ["keywords", () => new KeywordModal(plugin)],
  ["recommendations", () => new RecommendationModal(plugin, {
    onChanged: () => undefined,
    onLowRecommendationsHidden: () => undefined,
  })],
] as const;

describe("DOM UI contracts", () => {
  it.each(modalFactories)("styles %s modal controls outside the reader view", (_name, createModal) => {
    const modal = createModal();
    const document = modal.modalEl.ownerDocument;
    const window = document.defaultView!;
    const stylesheet = new window.CSSStyleSheet();
    stylesheet.replaceSync(readFileSync(new URL("../styles.css", import.meta.url), "utf8"));
    document.adoptedStyleSheets = [stylesheet];
    const button = document.createElement("button");
    modal.modalEl.append(button);

    expect(modal.modalEl.closest(".rss-reader")).toBeNull();
    expect(window.getComputedStyle(button).cursor).toBe("pointer");
    expect(window.getComputedStyle(button).minHeight).toBe("44px");
    button.disabled = true;
    expect(window.getComputedStyle(button).cursor).toBe("not-allowed");
    expect(window.getComputedStyle(button).transform).toBe("none");
  });

  it("also scopes the translation consent modal", () => {
    const open = vi.spyOn(Modal.prototype, "open");
    void confirmGoogleTranslation(plugin.app);
    const modal = open.mock.contexts[0] as Modal;
    expect(modal.modalEl.classList.contains("rss-reader-modal")).toBe(true);
    open.mockRestore();
  });

  it("reports rejected actions and restores button state", async () => {
    const window = new HappyWindow();
    const button = window.document.createElement(
      "button",
    ) as unknown as HTMLButtonElement;
    window.document.body.append(button as never);
    const onError = vi.fn();

    executeUiAction(
      async () => {
        throw new Error("failed");
      },
      button,
      onError,
    );
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
      expect(button.disabled).toBe(false);
      expect(button.hasAttribute("aria-busy")).toBe(false);
    });
  });

  it("uses the element owner window as the popout realm", () => {
    const mainWindow = new HappyWindow();
    const popoutWindow = new HappyWindow();
    const element = popoutWindow.document.createElement("div");

    expect(element.ownerDocument.defaultView).toBe(popoutWindow);
    expect(element.ownerDocument.defaultView).not.toBe(mainWindow);
    expect(element instanceof popoutWindow.HTMLElement).toBe(true);
  });

  it("does not expose recommendation context below negative keywords", () => {
    const explanation = recommendationExplanation(JSON.stringify({
      positive: [{ keyword: "library" }, { keyword: "journal:science" }],
      negative: [{ keyword: "noise" }, { keyword: "feed:archive" }],
    }));
    expect(explanation.positive).toEqual(["library"]);
    expect(explanation.negative).toEqual(["noise"]);
    expect(explanation.positive.join(" ")).not.toContain("journal:");
    expect(explanation.negative.join(" ")).not.toContain("feed:");
  });
});
