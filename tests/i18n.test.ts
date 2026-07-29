import { beforeEach, describe, expect, it } from "vitest";

import {
  getUiLanguage,
  hasEnglishTranslation,
  setUiLanguage,
  t,
  tx,
} from "../src/i18n";

describe("UI localization", () => {
  beforeEach(() => setUiLanguage("zh-CN"));

  it("uses Chinese for Chinese locales", () => {
    setUiLanguage("zh-CN");
    expect(getUiLanguage()).toBe("zh");
    expect(t("打开阅读器")).toBe("打开阅读器");
    expect(tx("中文", "English")).toBe("中文");
  });

  it("uses English for English and unsupported locales", () => {
    setUiLanguage("en");
    expect(getUiLanguage()).toBe("en");
    expect(t("打开阅读器")).toBe("Open reader");
    expect(tx("中文", "English")).toBe("English");

    setUiLanguage("fr");
    expect(getUiLanguage()).toBe("en");
    expect(t("打开阅读器")).toBe("Open reader");
  });

  it("tracks dictionary coverage", () => {
    expect(hasEnglishTranslation("打开阅读器")).toBe(true);
    expect(hasEnglishTranslation("不存在的文案")).toBe(false);
  });
});
