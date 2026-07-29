import { createHash, randomUUID } from "node:crypto";

import { t } from "../i18n";
import type {
  KeywordRecord,
  RecommendationTier,
  RssItem,
} from "../models/domain";
import { RssRepository } from "../repositories/rss-repository";
import type { DatabaseOperationCoordinator } from "./database-operation-coordinator";

const POSITIVE = new Set(["interested", "archived"]);
const STOPWORDS = new Set(
  `
  a an and are as at be been by can could for from has have how in into is it its
  may might more most new not of on or our paper research study than that the their
  these this through to toward using via was we were what when where which while who
  with would results method analysis based effects evidence approach role model data
  一种 一个 以及 通过 对于 关于 中的 研究 分析 基于 影响 作用 方法 模型 数据 结果
  `.trim().split(/\s+/),
);

export interface RecommendationRun {
  modelVersion: string;
  positiveCount: number;
  negativeCount: number;
  unreadCount: number;
  highCount: number;
  pendingCount: number;
  lowCount: number;
  unscoredCount: number;
}

export type RecommendationProgress = (message: string) => void;

interface FeatureData {
  vocabulary: string[];
  idf: number[];
  vectors: number[][];
  positivePresence: number[];
  negativePresence: number[];
}

export class RecommendationService {
  constructor(
    private readonly repository: RssRepository,
    private readonly operationCoordinator?: DatabaseOperationCoordinator,
    private readonly yieldToMainThread: () => Promise<void> = async () =>
      undefined,
  ) {}

  async rebuild(
    onProgress?: RecommendationProgress,
  ): Promise<RecommendationRun> {
    const releaseOperation =
      this.operationCoordinator?.acquireOperation("recommendation");
    try {
      return await this.rebuildInternal(onProgress);
    } finally {
      releaseOperation?.();
    }
  }

  private async rebuildInternal(
    onProgress?: RecommendationProgress,
  ): Promise<RecommendationRun> {
    onProgress?.(t("正在读取推荐训练样本……"));
    await this.yieldToMainThread();
    const training = this.repository.listTrainingItems();
    const unread = this.repository.listUnreadItems();
    const positiveCount = training.filter((item) =>
      POSITIVE.has(item.itemStatus),
    ).length;
    const negativeCount = training.length - positiveCount;
    const modelVersion = randomUUID().replaceAll("-", "");

    if (positiveCount < 2 || negativeCount < 2) {
      const error = t("训练样本不足：正样本和负样本均至少需要 2 篇");
      await this.repository.replaceRecommendationResults({
        modelVersion,
        positiveCount,
        negativeCount,
        unreadCount: unread.length,
        errorMessage: error,
        keywords: [],
        scores: [],
      });
      throw new Error(error);
    }

    const overrides = new Map(
      this.repository
        .listKeywords(5000)
        .filter(
          (keyword) =>
            keyword.manualWeight !== null || keyword.isDisabled,
        )
        .map((keyword) => [keyword.keyword, keyword]),
    );
    const documents = training.map(buildDocument);
    const labels = training.map((item) =>
      POSITIVE.has(item.itemStatus) ? 1 : 0,
    );
    onProgress?.(t("正在提取关键词特征……"));
    const features = await buildFeatures(
      documents,
      labels,
      overrides,
      this.yieldToMainThread,
    );
    if (features.vocabulary.length === 0) {
      const error = t("关键词模型无法训练：没有足够的重复词汇");
      await this.repository.replaceRecommendationResults({
        modelVersion,
        positiveCount,
        negativeCount,
        unreadCount: unread.length,
        errorMessage: error,
        keywords: [],
        scores: [],
      });
      throw new Error(error);
    }

    onProgress?.(t("正在训练关键词模型……"));
    const weights = await trainLogistic(
      features.vectors,
      labels,
      positiveCount,
      negativeCount,
      this.yieldToMainThread,
    );
    for (const [index, keyword] of features.vocabulary.entries()) {
      if (overrides.get(keyword)?.isDisabled) {
        weights[index] = 0;
      }
    }

    onProgress?.(t("正在为未读文献评分……"));
    const scores: NonNullable<ReturnType<typeof scoreItem>>[] = [];
    for (const [index, item] of unread.entries()) {
      const score = scoreItem(
        item,
        features.vocabulary,
        features.idf,
        weights,
        overrides,
      );
      if (score) {
        scores.push(score);
      }
      if ((index + 1) % 25 === 0) {
        await this.yieldToMainThread();
      }
    }

    onProgress?.(t("正在保存推荐结果……"));
    await this.yieldToMainThread();
    await this.repository.replaceRecommendationResults({
      modelVersion,
      positiveCount,
      negativeCount,
      unreadCount: unread.length,
      errorMessage: null,
      keywords: features.vocabulary.map((keyword, index) => ({
        keyword,
        autoWeight: weights[index] ?? 0,
        positiveCount: features.positivePresence[index] ?? 0,
        negativeCount: features.negativePresence[index] ?? 0,
      })),
      scores,
    });
    const counts = { high: 0, pending: 0, low: 0 };
    for (const score of scores) {
      counts[score.tier] += 1;
    }
    return {
      modelVersion,
      positiveCount,
      negativeCount,
      unreadCount: unread.length,
      highCount: counts.high,
      pendingCount: counts.pending,
      lowCount: counts.low,
      unscoredCount: unread.length - scores.length,
    };
  }
}

export function tokenize(text: string): string[] {
  const parts =
    text.toLocaleLowerCase().match(/[a-z][a-z0-9_-]{1,}|[\u3400-\u9fff]+/g) ??
    [];
  const tokens: string[] = [];
  for (const part of parts) {
    if (/^[\u3400-\u9fff]+$/.test(part)) {
      if (part.length === 2) {
        tokens.push(part);
      } else {
        for (let index = 0; index < part.length - 1; index += 1) {
          tokens.push(part.slice(index, index + 2));
        }
      }
    } else {
      const normalized = part.replaceAll("_", "-");
      if (!STOPWORDS.has(normalized) && !/^\d+$/.test(normalized)) {
        tokens.push(normalized);
      }
    }
  }
  return tokens.filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

export function scoreToTier(score: number): RecommendationTier {
  if (score >= 70) {
    return "high";
  }
  if (score <= 30) {
    return "low";
  }
  return "pending";
}

function buildDocument(item: RssItem): string {
  return `${item.title} ${item.title} ${item.summary}`.trim();
}

function documentTerms(document: string): string[] {
  const base = tokenize(document);
  const ngrams = [...base];
  for (let index = 0; index < base.length - 1; index += 1) {
    ngrams.push(`${base[index]} ${base[index + 1]}`);
  }
  return ngrams;
}

async function buildFeatures(
  documents: string[],
  labels: number[],
  overrides: Map<string, KeywordRecord>,
  yieldToMainThread: () => Promise<void>,
): Promise<FeatureData> {
  const documentTokens: string[][] = [];
  for (const [index, document] of documents.entries()) {
    documentTokens.push(documentTerms(document));
    if ((index + 1) % 25 === 0) {
      await yieldToMainThread();
    }
  }
  const frequencies = new Map<string, number>();
  for (const [index, tokens] of documentTokens.entries()) {
    for (const token of new Set(tokens)) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
    if ((index + 1) % 50 === 0) {
      await yieldToMainThread();
    }
  }
  const vocabulary = [...frequencies.entries()]
    .filter(
      ([token, count]) =>
        count >= 2 &&
        count / documents.length <= 0.98 &&
        !overrides.get(token)?.isDisabled,
    )
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5000)
    .map(([token]) => token);
  const indexByToken = new Map(
    vocabulary.map((token, index) => [token, index]),
  );
  const idf = vocabulary.map(
    (token) =>
      Math.log((documents.length + 1) / ((frequencies.get(token) ?? 0) + 1)) +
      1,
  );
  const positivePresence = new Array<number>(vocabulary.length).fill(0);
  const negativePresence = new Array<number>(vocabulary.length).fill(0);
  const vectors: number[][] = [];
  for (const [rowIndex, tokens] of documentTokens.entries()) {
    const counts = new Map<string, number>();
    for (const token of tokens) {
      if (indexByToken.has(token)) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
    const vector = new Array<number>(vocabulary.length).fill(0);
    let squaredNorm = 0;
    for (const [token, count] of counts) {
      const index = indexByToken.get(token);
      if (index === undefined) {
        continue;
      }
      const value = (1 + Math.log(count)) * (idf[index] ?? 1);
      vector[index] = value;
      squaredNorm += value * value;
      if (labels[rowIndex] === 1) {
        positivePresence[index] = (positivePresence[index] ?? 0) + 1;
      } else {
        negativePresence[index] = (negativePresence[index] ?? 0) + 1;
      }
    }
    const norm = Math.sqrt(squaredNorm);
    vectors.push(
      norm > 0 ? vector.map((value) => value / norm) : vector,
    );
    if ((rowIndex + 1) % 10 === 0) {
      await yieldToMainThread();
    }
  }
  return { vocabulary, idf, vectors, positivePresence, negativePresence };
}

async function trainLogistic(
  vectors: number[][],
  labels: number[],
  positiveCount: number,
  negativeCount: number,
  yieldToMainThread: () => Promise<void>,
): Promise<number[]> {
  const weights = new Array<number>(vectors[0]?.length ?? 0).fill(0);
  const learningRate = 0.4;
  const total = labels.length;
  const positiveWeight = total / (2 * positiveCount);
  const negativeWeight = total / (2 * negativeCount);
  const yieldEvery =
    vectors.length * weights.length > 250_000 ? 1 : 5;
  for (let iteration = 0; iteration < 350; iteration += 1) {
    const gradient = new Array<number>(weights.length).fill(0);
    for (const [row, vector] of vectors.entries()) {
      const label = labels[row] ?? 0;
      const sampleWeight = label === 1 ? positiveWeight : negativeWeight;
      const probability = sigmoid(dot(vector, weights));
      const error = (probability - label) * sampleWeight;
      for (let column = 0; column < vector.length; column += 1) {
        gradient[column] =
          (gradient[column] ?? 0) + error * (vector[column] ?? 0);
      }
    }
    for (let column = 0; column < weights.length; column += 1) {
      const regularized =
        (gradient[column] ?? 0) / total + 0.01 * (weights[column] ?? 0);
      weights[column] = (weights[column] ?? 0) - learningRate * regularized;
    }
    if ((iteration + 1) % yieldEvery === 0) {
      await yieldToMainThread();
    }
  }
  return weights;
}

function scoreItem(
  item: RssItem,
  vocabulary: string[],
  idf: number[],
  weights: number[],
  overrides: Map<string, KeywordRecord>,
): {
  itemId: number;
  score: number;
  tier: RecommendationTier;
  matchedKeywords: string;
  contentHash: string;
} | null {
  const document = buildDocument(item);
  const terms = documentTerms(document);
  if (terms.length === 0) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const term of terms) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  const contributions: Array<{ keyword: string; weight: number }> = [];
  let logit = 0;
  for (const [index, keyword] of vocabulary.entries()) {
    const count = counts.get(keyword) ?? 0;
    if (count === 0) {
      continue;
    }
    const contribution =
      (1 + Math.log(count)) * (idf[index] ?? 1) * (weights[index] ?? 0) * 2;
    logit += contribution;
    contributions.push({ keyword, weight: contribution });
  }
  const normalized = document.toLocaleLowerCase();
  for (const [keyword, override] of overrides) {
    if (
      !override.isDisabled &&
      override.manualWeight !== null &&
      normalized.includes(keyword)
    ) {
      logit += override.manualWeight;
      contributions.push({ keyword, weight: override.manualWeight });
    }
  }
  const score = Math.round(sigmoid(logit) * 1000) / 10;
  const matched = contributions
    .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight))
    .slice(0, 6);
  return {
    itemId: item.id,
    score,
    tier: scoreToTier(score),
    matchedKeywords: JSON.stringify(matched),
    contentHash: createHash("sha256").update(document).digest("hex"),
  };
}

function dot(left: number[], right: number[]): number {
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return result;
}

function sigmoid(value: number): number {
  if (value >= 0) {
    return 1 / (1 + Math.exp(-value));
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}
