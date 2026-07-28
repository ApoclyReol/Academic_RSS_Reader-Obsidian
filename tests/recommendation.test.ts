import { describe, expect, it } from "vitest";

import {
  scoreToTier,
  tokenize,
} from "../src/services/recommendation-service";
import { parseTier } from "../src/services/relevance";

describe("recommendation contracts", () => {
  it("keeps stable score thresholds", () => {
    expect(scoreToTier(70)).toBe("high");
    expect(scoreToTier(69.9)).toBe("pending");
    expect(scoreToTier(31)).toBe("pending");
    expect(scoreToTier(30)).toBe("low");
  });

  it("tokenizes English and Chinese text", () => {
    const tokens = tokenize("Digital libraries 与人工智能知识组织");
    expect(tokens).toContain("digital");
    expect(tokens).toContain("libraries");
    expect(tokens.some((token) => /[\u3400-\u9fff]/.test(token))).toBe(true);
  });

  it("accepts only strict LLM tiers", () => {
    expect(parseTier(" high ")).toBe("high");
    expect(parseTier("LOW")).toBe("low");
    expect(() => parseTier("high relevance")).toThrow();
  });
});
