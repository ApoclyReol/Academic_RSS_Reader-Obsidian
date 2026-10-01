import { Window as HappyWindow } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import type RssReaderPlugin from "../src/main";
import type { RssItem } from "../src/models/domain";
import { DEFAULT_SETTINGS } from "../src/models/settings";
import { formatDate, setUiLanguage, t } from "../src/i18n";

vi.mock("obsidian", () => ({
  ItemView: class {
    registerDomEvent = vi.fn();
  },
  Notice: class {},
  setIcon: vi.fn(),
  renderMath: vi.fn(),
}));
vi.mock("../src/views/modals", () => ({}));

import { RssReaderView } from "../src/views/rss-reader-view";

interface ReaderRenderMethods {
  renderFeeds(container: HTMLElement): void;
  renderReader(container: HTMLElement, navigation: HTMLElement): void;
  renderItemCard(container: HTMLElement, item: RssItem): void;
  renderBackToTopAction(container: HTMLElement): void;
  translationEnabled: boolean;
  registerDomEvent: ReturnType<typeof vi.fn>;
}

// Obsidian's DOM helpers are supplied by the host, outside this test browser.
function createContainer(): HTMLElement {
  const browser = new HappyWindow();
  const prototype = browser.HTMLElement.prototype;
  Object.assign(prototype, {
    createEl(this: HTMLElement, tag: string, options: {
      cls?: string; text?: string; attr?: Record<string, string>;
      type?: string; placeholder?: string;
    } = {}) {
      const element = browser.document.createElement(tag);
      element.className = options.cls ?? "";
      element.textContent = options.text ?? "";
      for (const [key, value] of Object.entries(options.attr ?? {})) {
        element.setAttribute(key, value);
      }
      if (options.type) element.setAttribute("type", options.type);
      if (options.placeholder) element.setAttribute("placeholder", options.placeholder);
      this.appendChild(element as unknown as HTMLElement);
      return element;
    },
    createDiv(this: HTMLElement, options: object) { return this.createEl("div", options); },
    createSpan(this: HTMLElement, options: object) { return this.createEl("span", options); },
    appendText(this: HTMLElement, value: string) { this.append(value); },
    addClass(this: HTMLElement, value: string) { this.classList.add(value); },
    removeClass(this: HTMLElement, value: string) { this.classList.remove(value); },
    toggleClass(this: HTMLElement, value: string, enabled: boolean) {
      this.classList.toggle(value, enabled);
    },
  });
  return browser.document.body as unknown as HTMLElement;
}

function createReader(dynamic: boolean) {
  const plugin = {
    settings: { ...DEFAULT_SETTINGS, cardDynamicHeight: dynamic,
      cardShowAuthors: true, cardShowAbstract: true },
    repository: {
      countByStatus: () => ({ unread: 3, interested: 0, archived: 0, hidden: 0, expired: 0 }),
      countItems: () => 0,
      listItems: () => [],
      listFeeds: () => [],
      getMetadata: () => JSON.stringify({ finishedAt: "2026-10-01T03:30:00.000Z", successFeeds: 2, totalFeeds: 2, totalNewItems: 4, expiredItems: 0 }),
    },
    feedService: { isUpdating: () => false },
  } as unknown as RssReaderPlugin;
  const view = new RssReaderView({} as WorkspaceLeaf, plugin);
  return view as unknown as ReaderRenderMethods;
}

function item(): RssItem {
  return {
    id: 1, title: '<span class="small-caps">NormasTCU</span> &mdash; IR',
    translatedTitle: "<strong>译文</strong>&#x20;标题", titleTranslationStatus: "succeeded",
    authors: "", journal: "", summary: "", doi: "", imageUrl: null,
    pubDate: "", year: "", link: "", itemStatus: "unread", keywordScore: null,
  } as RssItem;
}

describe("reader layout", () => {
  it("formats the feed update summary in the user's system timezone", () => {
    setUiLanguage("zh-CN");
    const container = createContainer();
    createReader(false).renderFeeds(container);
    expect(container.querySelector(".rss-reader__caption")?.textContent).toBe(t("feed.last_summary", {
      date: formatDate("2026-10-01T03:30:00.000Z"), success: "2", total: "2", newItems: "4", expired: "0",
    }));
    expect(container.textContent).not.toContain("2026-10-01T03:30:00.000Z");
  });

  it("shows a correction badge with expandable full original and translated titles", () => {
    setUiLanguage("zh-CN");
    const container = createContainer();
    const view = createReader(false);
    view.translationEnabled = true;
    const original = `Corrigendum to “${"A long subject ".repeat(20)}” [Journal 161 (2024) 108390]`;
    view.renderItemCard(container, { ...item(), title: original, translatedTitle: "勘误：译文标题" });
    expect(container.querySelector(".rss-reader__notice-badge")?.textContent).toBe("勘误");
    const details = container.querySelector<HTMLDetailsElement>("details")!;
    expect(details.textContent).toContain(original);
    expect(details.textContent).toContain("勘误：译文标题");
    const toggle = view.registerDomEvent.mock.calls.find((call) => call[0] === details && call[1] === "toggle")!;
    details.open = true;
    (toggle[2] as () => void)();
    expect(container.querySelector(".rss-reader__item--expanded-notice")).not.toBeNull();
    details.open = false;
    (toggle[2] as () => void)();
    expect(container.querySelector(".rss-reader__item--expanded-notice")).toBeNull();
  });
  it("keeps translation, sorting and status actions inside sticky navigation", () => {
    const container = createContainer();
    const navigation = container.createDiv({ cls: "rss-reader__sticky-navigation" });
    const view = createReader(false);
    vi.spyOn(view, "renderBackToTopAction").mockImplementation(() => undefined);
    view.renderReader(container, navigation);
    expect(navigation.querySelector(".rss-reader__search")).not.toBeNull();
    expect(navigation.querySelector(".rss-reader__baskets")).not.toBeNull();
    const actions = navigation.querySelector(".rss-reader__mode-switch");
    expect(actions).not.toBeNull();
    expect(actions?.querySelector(".rss-reader__sort-actions")).not.toBeNull();
    expect(actions?.querySelector(".rss-reader__status-actions")).not.toBeNull();
  });

  it("omits empty rows in dynamic mode and safely cleans cached titles", () => {
    const container = createContainer();
    const view = createReader(true);
    view.renderItemCard(container, item());
    expect(container.querySelector("h3")?.textContent).toBe("NormasTCU — IR");
    expect(container.querySelector("span.small-caps")).toBeNull();
    expect(container.querySelector(".rss-reader__item-metadata")).toBeNull();
    expect(container.querySelector(".rss-reader__item-authors")).toBeNull();
    expect(container.querySelector(".rss-reader__item-abstract")).toBeNull();
    view.translationEnabled = true;
    view.renderItemCard(container, item());
    expect(container.querySelectorAll("h3")[1]?.textContent).toBe("译文 标题");
  });

  it("retains enabled empty slots in uniform mode", () => {
    const container = createContainer();
    createReader(false).renderItemCard(container, item());
    expect(container.querySelector(".rss-reader__item-metadata")).not.toBeNull();
    expect(container.querySelector(".rss-reader__item-authors")).not.toBeNull();
    expect(container.querySelector(".rss-reader__item-abstract")).not.toBeNull();
  });
});
