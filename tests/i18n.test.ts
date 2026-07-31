import { beforeEach, describe, expect, it } from "vitest";

import {
  formatDate,
  formatNumber,
  getUiLanguage,
  hasEnglishTranslation,
  plural,
  setUiLanguage,
  t,
} from "../src/i18n";
import { statusLabel } from "../src/views/status-label";

describe("UI localization", () => {
  beforeEach(() => setUiLanguage("zh-CN"));

  it("uses Chinese for Chinese locales", () => {
    setUiLanguage("zh-CN");
    expect(getUiLanguage()).toBe("zh");
    expect(t("ui.open_reader_2")).toBe("打开阅读器");
  });

  it("uses English for English and unsupported locales", () => {
    setUiLanguage("en");
    expect(getUiLanguage()).toBe("en");
    expect(t("ui.open_reader_2")).toBe("Open reader");

    setUiLanguage("fr");
    expect(getUiLanguage()).toBe("en");
    expect(t("ui.open_reader_2")).toBe("Open reader");
  });

  it("tracks dictionary coverage", () => {
    expect(hasEnglishTranslation("ui.open_reader_2")).toBe(true);
    expect(hasEnglishTranslation("missing.key")).toBe(false);
  });

  it("supports interpolation, plural selection, numbers and dates", () => {
    setUiLanguage("en");
    expect(t("reader.basket_count", { total: 4, shown: 2 }))
      .toBe("4 papers in this basket; 2 shown.");
    expect(
      plural(2, { one: "ui.item", other: "ui.items" }),
    ).toBe("Items");
    expect(formatNumber(1234)).toContain("1");
    expect(formatDate("2026-07-30T12:00:00Z")).not.toBe("");
  });

  it("translates basket labels after the UI language is initialized", () => {
    setUiLanguage("en");
    expect([
      statusLabel("unread"),
      statusLabel("interested"),
      statusLabel("archived"),
      statusLabel("hidden"),
      statusLabel("expired"),
    ]).toEqual([
      "Unread",
      "Interested",
      "Archived",
      "Hidden",
      "Expired",
    ]);
  });
});
