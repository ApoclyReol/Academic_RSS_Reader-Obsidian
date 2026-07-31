import { describe, expect, it } from "vitest";

import {
  calibrateThresholds,
  extractDocumentTerms,
  scoreToTier,
  sparseVectorWidth,
  stratifiedSplit,
  trainLogisticSparse,
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

  it("keeps segmented Chinese terms and only builds Latin bigrams", () => {
    const terms = extractDocumentTerms(
      "人工智能 知识组织 digital library",
    );
    expect(terms).toContain("digital library");
    expect(
      terms.some((term) =>
        /^[\u3400-\u9fff]+ [\u3400-\u9fff]+$/u.test(term),
      ),
    ).toBe(false);
  });

  it("trains sparse vectors with an intercept", async () => {
    const model = await trainLogisticSparse(
      [
        [{ index: 0, value: 1 }],
        [{ index: 0, value: 0.8 }],
        [{ index: 1, value: 1 }],
        [{ index: 1, value: 0.8 }],
      ],
      [1, 1, 0, 0],
      2,
      2,
    );
    expect(model.weights).toHaveLength(2);
    expect(Number.isFinite(model.intercept)).toBe(true);
  });

  it("calculates large sparse widths without spreading arguments", () => {
    const vectors = Array.from({ length: 5_000 }, (_, row) =>
      Array.from({ length: 120 }, (_, column) => ({
        index: (row * 97 + column * 37) % 5_000,
        value: 1,
      })),
    );
    expect(sparseVectorWidth(vectors)).toBe(5_000);
  });

  it("uses a deterministic stratified holdout and calibrated band", () => {
    const labels = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
    const split = stratifiedSplit(labels);
    expect(split.validation).toEqual([0, 5]);
    const calibrated = calibrateThresholds(
      labels.map((label) => [
        { index: 0, value: label ? 1 : -1 },
      ]),
      labels,
      { weights: [4], intercept: 0 },
      split.validation,
    );
    expect(calibrated.accuracy).toBe(1);
    expect(calibrated.highThreshold - calibrated.lowThreshold).toBe(20);
  });

  it("accepts only strict LLM tiers", () => {
    expect(parseTier(" high ")).toBe("high");
    expect(parseTier("LOW")).toBe("low");
    expect(() => parseTier("high relevance")).toThrow();
  });
});
