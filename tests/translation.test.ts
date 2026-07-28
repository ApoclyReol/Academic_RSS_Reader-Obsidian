import { describe, expect, it } from "vitest";

import {
  hashText,
  isTargetLanguage,
} from "../src/services/translation-service";

describe("translation helpers", () => {
  it("skips Chinese text for the Chinese target", () => {
    expect(isTargetLanguage("这是一个中文标题", "zh-CN")).toBe(true);
    expect(isTargetLanguage("A study of libraries", "zh-CN")).toBe(false);
    expect(isTargetLanguage("人工智能 AI", "zh-CN")).toBe(true);
  });

  it("invalidates cache when source text changes", () => {
    expect(hashText("same")).toBe(hashText("same"));
    expect(hashText("same")).not.toBe(hashText("changed"));
  });
});
