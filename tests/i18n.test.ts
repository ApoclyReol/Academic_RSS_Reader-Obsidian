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

  it("localizes recent-update skip notices in both supported languages", () => {
    setUiLanguage("zh-CN");
    expect(t("update.done_with_recent_skips", {
      trigger: "启动时自动更新",
      newItems: 0,
      failed: 0,
      skipped: 3,
    })).toContain("3 个订阅近期更新过，已自动跳过");

    setUiLanguage("en");
    expect(t("update.done_with_recent_skips", {
      trigger: "Automatic startup update",
      newItems: 0,
      failed: 0,
      skipped: 3,
    })).toContain("3 feeds were updated recently and skipped automatically");
  });

  it("reads SQLite timestamps as UTC and formats them in the selected timezone", () => {
    setUiLanguage("en");
    for (const timeZone of ["Asia/Shanghai", "America/Los_Angeles", "UTC"]) {
      const options: Intl.DateTimeFormatOptions = {
        timeZone, dateStyle: "short", timeStyle: "short",
      };
      expect(formatDate("2026-10-01 00:30:00", options))
        .toBe(formatDate("2026-10-01T00:30:00Z", options));
      expect(formatDate("2026-10-01T08:30:00+08:00", options))
        .toBe(formatDate("2026-10-01T00:30:00Z", options));
    }
    expect(formatDate("2026-10-01 00:30:00"))
      .toBe(formatDate("2026-10-01T00:30:00Z"));
    expect(formatDate("invalid timestamp")).toBe("");
  });

  it("translates basket labels after the UI language is initialized", () => {
    expect(["unread", "interested", "archived", "hidden", "expired"].map(
      (status) => statusLabel(status as Parameters<typeof statusLabel>[0]),
    )).toEqual(["待筛", "关注", "归藏", "略过", "过期"]);
    setUiLanguage("en");
    expect([
      statusLabel("unread"),
      statusLabel("interested"),
      statusLabel("archived"),
      statusLabel("hidden"),
      statusLabel("expired"),
    ]).toEqual([
      "To screen",
      "Following",
      "Saved",
      "Skipped",
      "Expired",
    ]);
  });

  it("localizes the unread batch action and reader sorting controls", () => {
    setUiLanguage("zh-CN");
    expect(t("reader.hide_remaining_unread", { count: 12 }))
      .toBe("略过剩余待筛（12）");
    expect(t("reader.sort_by_update_time")).toBe("按更新时间");
    expect(t("ui.back_to_top")).toBe("返回顶部");

    setUiLanguage("en");
    expect(t("reader.hide_remaining_unread_confirm", { count: 12 }))
      .toBe(
        "Skip the remaining 12 papers to screen? You can undo this action.",
      );
    expect(t("reader.sort_by_relevance")).toBe("Sort by relevance");
    expect(t("ui.back_to_top")).toBe("Back to top");
  });
});
