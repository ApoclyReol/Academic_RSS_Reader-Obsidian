import { createHash, randomUUID } from "node:crypto";

import { t } from "../i18n";
import type {
  KeywordRecord,
  RecommendationTier,
  RssItem,
} from "../models/domain";
import type { RssReaderSettings } from "../models/settings";
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
  vectors: SparseVector[];
  positivePresence: number[];
  negativePresence: number[];
}

export interface SparseEntry {
  index: number;
  value: number;
}
export type SparseVector = SparseEntry[];
interface TrainedModel {
  weights: number[];
  intercept: number;
}
export const FEATURE_VERSION = 4;

export class RecommendationService {
  private activeWorker: Worker | null = null;
  private rejectTraining: ((error: Error) => void) | null = null;
  private generation = 0;
  private activeRebuild: Promise<RecommendationRun> | null = null;
  constructor(
    private readonly repository: RssRepository,
    private readonly operationCoordinator?: DatabaseOperationCoordinator,
    private readonly yieldToMainThread: () => Promise<void> = async () =>
      undefined,
    private readonly getSettings: () => Pick<
      RssReaderSettings,
      "recommendationLowThreshold" | "recommendationHighThreshold"
    > = () => ({
      recommendationLowThreshold: null,
      recommendationHighThreshold: null,
    }),
  ) {}

  async rebuild(
    onProgress?: RecommendationProgress,
  ): Promise<RecommendationRun> {
    const generation = ++this.generation;
    const run = this.rebuildInternal(onProgress, generation);
    this.activeRebuild = run;
    try {
      return await run;
    } finally {
      if (this.activeRebuild === run) {
        this.activeRebuild = null;
      }
    }
  }

  cancelTraining(): void {
    this.generation += 1;
    this.activeWorker?.terminate();
    this.activeWorker = null;
    this.rejectTraining?.(
      new Error(t("recommendation.training_cancelled")),
    );
    this.rejectTraining = null;
  }

  async stop(): Promise<void> {
    this.cancelTraining();
    await this.activeRebuild?.catch(() => undefined);
  }

  isModelStale(): boolean {
    const model = this.repository.getRecommendationSummary();
    if (!model.trainingHash) {
      return true;
    }
    const training = this.repository.listTrainingItems();
    const overrides = this.repository
      .listKeywords(5000)
      .filter((keyword) => keyword.isDisabled);
    return model.trainingHash !== recommendationTrainingHash(
      training.map(buildDocument),
      training.map((item) =>
        POSITIVE.has(item.itemStatus) ? 1 : 0,
      ),
      overrides,
      this.getSettings(),
    );
  }

  private async rebuildInternal(
    onProgress?: RecommendationProgress,
    generation = this.generation,
  ): Promise<RecommendationRun> {
    const releaseOperation =
      this.operationCoordinator?.acquireOperation("recommendation");
    try {
      return await this.rebuildInternalWithGeneration(onProgress, generation);
    } finally {
      releaseOperation?.();
    }
  }

  private async rebuildInternalWithGeneration(
    onProgress: RecommendationProgress | undefined,
    generation: number,
  ): Promise<RecommendationRun> {
    onProgress?.(t("ui.reading_recommendation_training_samples"));
    await this.yieldToMainThread();
    this.ensureGeneration(generation);
    const training = this.repository.listTrainingItems();
    const unread = this.repository.listUnreadItems();
    const positiveCount = training.filter((item) =>
      POSITIVE.has(item.itemStatus),
    ).length;
    const negativeCount = training.length - positiveCount;
    const modelVersion = randomUUID().replaceAll("-", "");

    if (positiveCount < 2 || negativeCount < 2) {
      const error = t("ui.not_enough_training_samples_at_least_two_positive_and_two_negative_paper");
      this.ensureGeneration(generation);
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
        .filter((keyword) => keyword.isDisabled)
        .map((keyword) => [keyword.keyword, keyword]),
    );
    const documents = training.map(buildDocument);
    const labels = training.map((item) =>
      POSITIVE.has(item.itemStatus) ? 1 : 0,
    );
    const thresholdSettings = this.getSettings();
    const trainingHash = recommendationTrainingHash(
      documents,
      labels,
      [...overrides.values()],
      thresholdSettings,
    );
    const previousModel = this.repository.getRecommendationSummary();
    if (
      previousModel.modelVersion &&
      previousModel.trainingHash === trainingHash &&
      previousModel.featureVersion === FEATURE_VERSION
    ) {
      this.ensureGeneration(generation);
      const keywords = this.repository.listKeywords(5000);
      const existing = this.repository.listRecommendationScoreHashes();
      const settings = thresholdSettings;
      const { lowThreshold, highThreshold } = resolveThresholds(
        settings,
        previousModel.suggestedLowThreshold,
        previousModel.suggestedHighThreshold,
      );
      const changedScores: NonNullable<
        ReturnType<typeof scoreItem>
      >[] = [];
      const vocabulary = keywords.map((entry) => entry.keyword);
      const indexByKeyword = new Map(
        vocabulary.map((keyword, index) => [keyword, index]),
      );
      const idf = keywords.map((entry) => entry.idf);
      const weights = keywords.map((entry) => entry.effectiveWeight);
      for (const item of unread) {
        this.ensureGeneration(generation);
        const contentHash = createHash("sha256")
          .update(buildDocument(item))
          .digest("hex");
        if (existing.get(item.id) === contentHash) {
          continue;
        }
        const score = scoreItem(
          item,
          indexByKeyword,
          vocabulary,
          idf,
          weights,
          previousModel.intercept,
          lowThreshold,
          highThreshold,
        );
        if (score) {
          changedScores.push(score);
        }
      }
      this.ensureGeneration(generation);
      await this.repository.updateRecommendationScores(
        previousModel.modelVersion,
        unread.map((item) => item.id),
        changedScores,
      );
      const summary = this.repository.getRecommendationSummary();
      return {
        modelVersion: previousModel.modelVersion,
        positiveCount,
        negativeCount,
        unreadCount: unread.length,
        highCount: summary.high,
        pendingCount: summary.pending,
        lowCount: summary.low,
        unscoredCount: summary.unscored,
      };
    }
    onProgress?.(t("ui.extracting_keyword_features"));
    const features = await buildFeatures(
      documents,
      labels,
      overrides,
      async () => {
        this.ensureGeneration(generation);
        await this.yieldToMainThread();
        this.ensureGeneration(generation);
      },
    );
    this.ensureGeneration(generation);
    if (features.vocabulary.length === 0) {
      const error = t("ui.the_keyword_model_cannot_be_trained_because_there_are_not_enough_recurri");
      this.ensureGeneration(generation);
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

    onProgress?.(t("ui.training_keyword_model"));
    const split = stratifiedSplit(labels);
    let trained: TrainedModel;
    try {
      trained = await trainLogisticWithWorker(
        features.vectors,
        labels,
        positiveCount,
        negativeCount,
        split.training,
        (worker, reject) => {
          this.activeWorker = worker;
          this.rejectTraining = reject;
        },
      );
    } finally {
      this.activeWorker = null;
      this.rejectTraining = null;
    }
    this.ensureGeneration(generation);
    const calibration = calibrateThresholds(
      features.vectors,
      labels,
      trained,
      split.validation,
    );
    const settings = thresholdSettings;
    const { lowThreshold, highThreshold } = resolveThresholds(
      settings,
      calibration.lowThreshold,
      calibration.highThreshold,
    );
    for (const [index, keyword] of features.vocabulary.entries()) {
      if (overrides.get(keyword)?.isDisabled) {
        trained.weights[index] = 0;
      }
    }

    onProgress?.(t("ui.scoring_unread_papers"));
    const indexByKeyword = new Map(
      features.vocabulary.map((keyword, index) => [keyword, index]),
    );
    const scores: NonNullable<ReturnType<typeof scoreItem>>[] = [];
    for (const [index, item] of unread.entries()) {
      this.ensureGeneration(generation);
      const score = scoreItem(
        item,
        indexByKeyword,
        features.vocabulary,
        features.idf,
        trained.weights,
        trained.intercept,
        lowThreshold,
        highThreshold,
      );
      if (score) {
        scores.push(score);
      }
      if ((index + 1) % 25 === 0) {
        await this.yieldToMainThread();
        this.ensureGeneration(generation);
      }
    }

    onProgress?.(t("ui.saving_recommendation_results"));
    await this.yieldToMainThread();
    this.ensureGeneration(generation);
    await this.repository.replaceRecommendationResults({
      modelVersion,
      positiveCount,
      negativeCount,
      unreadCount: unread.length,
      intercept: trained.intercept,
      trainingHash,
      validationAccuracy: calibration.accuracy,
      suggestedLowThreshold: calibration.lowThreshold,
      suggestedHighThreshold: calibration.highThreshold,
      featureVersion: FEATURE_VERSION,
      errorMessage: null,
      keywords: features.vocabulary.map((keyword, index) => ({
        keyword,
        autoWeight: trained.weights[index] ?? 0,
        positiveCount: features.positivePresence[index] ?? 0,
        negativeCount: features.negativePresence[index] ?? 0,
        idf: features.idf[index] ?? 1,
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

  private ensureGeneration(generation: number): void {
    if (generation !== this.generation) {
      throw new Error(t("recommendation.training_cancelled"));
    }
  }
}

function recommendationTrainingHash(
  documents: string[],
  labels: number[],
  overrides: KeywordRecord[],
  thresholdOverrides: Pick<
    RssReaderSettings,
    "recommendationLowThreshold" | "recommendationHighThreshold"
  >,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      featureVersion: FEATURE_VERSION,
      documents,
      labels,
      overrides: overrides.map((value) => [
        value.keyword,
        value.isDisabled,
      ]),
      thresholdOverrides,
    }))
    .digest("hex");
}

export function tokenize(text: string): string[] {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "word" },
      ) => {
        segment(value: string): Iterable<{
          segment: string;
          isWordLike?: boolean;
        }>;
      };
    }
  ).Segmenter;
  if (typeof Segmenter === "function") {
    const segmenter = new Segmenter(undefined, {
      granularity: "word",
    });
    const segmented = [...segmenter.segment(text.toLocaleLowerCase())]
      .filter((part) => part.isWordLike)
      .map((part) => part.segment);
    if (segmented.length > 0) {
      return segmented
        .map(normalizeSegmentedToken)
        .filter((token): token is string => token !== null);
    }
  }
  return fallbackTokens(text);
}

function normalizeSegmentedToken(value: string): string | null {
  const normalized = value.toLocaleLowerCase().replaceAll("_", "-");
  if (
    normalized.length < 2 ||
    STOPWORDS.has(normalized) ||
    /^\d+$/.test(normalized)
  ) {
    return null;
  }
  return /^[a-z][a-z0-9-]*$|^[\u3400-\u9fff]+$/u.test(normalized)
    ? normalized
    : null;
}

function fallbackTokens(text: string): string[] {
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

export function scoreToTier(
  score: number,
  lowThreshold = 30,
  highThreshold = 70,
): RecommendationTier {
  if (score >= highThreshold) {
    return "high";
  }
  if (score <= lowThreshold) {
    return "low";
  }
  return "pending";
}

export function resolveThresholds(
  settings: Pick<
    RssReaderSettings,
    "recommendationLowThreshold" | "recommendationHighThreshold"
  >,
  suggestedLow: number,
  suggestedHigh: number,
): { lowThreshold: number; highThreshold: number } {
  const low = settings.recommendationLowThreshold ?? suggestedLow;
  const high = settings.recommendationHighThreshold ?? suggestedHigh;
  return low < high
    ? { lowThreshold: low, highThreshold: high }
    : { lowThreshold: suggestedLow, highThreshold: suggestedHigh };
}

export function buildDocument(item: RssItem): string {
  const freshness = freshnessBucket(item.pubDate);
  const authors = tokenize(item.authors)
    .map((author) => `author:${author}`)
    .join(" ");
  const journals = tokenize(item.journal)
    .map((journal) => `journal:${journal}`)
    .join(" ");
  const feeds = tokenize(item.feedNames)
    .map((feed) => `feed:${feed}`)
    .join(" ");
  return [
    item.title,
    item.title,
    item.summary,
    journals,
    feeds,
    authors,
    `freshness:${freshness}`,
  ].join(" ").trim();
}

function freshnessBucket(pubDate: string): string {
  const age = Date.now() - Date.parse(pubDate);
  if (!Number.isFinite(age) || age < 0) {
    return "unknown";
  }
  const days = age / 86_400_000;
  return days <= 30 ? "new" : days <= 180 ? "recent" : "archive";
}

export function extractDocumentTerms(document: string): string[] {
  const base = tokenize(document);
  const structured =
    document.toLocaleLowerCase().match(
      /(?:journal|feed|author|freshness):[^\s]+/g,
    ) ?? [];
  const ngrams = [...base, ...structured];
  const lexical = base.filter((token) => !token.includes(":"));
  for (let index = 0; index < lexical.length - 1; index += 1) {
    const left = lexical[index] ?? "";
    const right = lexical[index + 1] ?? "";
    if (isLatinToken(left) && isLatinToken(right)) {
      ngrams.push(`${left} ${right}`);
    }
  }
  return ngrams;
}

export function vectorizeDocument(
  document: string,
  vocabulary: string[],
  idf: number[],
): SparseVector {
  const indexByToken = new Map(
    vocabulary.map((token, index) => [token, index]),
  );
  const counts = new Map<string, number>();
  for (const token of extractDocumentTerms(document)) {
    if (indexByToken.has(token)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  const vector: SparseVector = [];
  let squaredNorm = 0;
  for (const [token, count] of counts) {
    const index = indexByToken.get(token);
    if (index === undefined) {
      continue;
    }
    const value = (1 + Math.log(count)) * (idf[index] ?? 1);
    vector.push({ index, value });
    squaredNorm += value * value;
  }
  const norm = Math.sqrt(squaredNorm);
  return norm > 0
    ? vector.map((entry) => ({
        index: entry.index,
        value: entry.value / norm,
      }))
    : vector;
}

export function vectorizeItem(
  item: RssItem,
  vocabulary: string[],
  idf: number[],
): SparseVector {
  return vectorizeDocument(buildDocument(item), vocabulary, idf);
}

function isLatinToken(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/u.test(value);
}

async function buildFeatures(
  documents: string[],
  labels: number[],
  overrides: Map<string, KeywordRecord>,
  yieldToMainThread: () => Promise<void>,
): Promise<FeatureData> {
  const documentTokens: string[][] = [];
  for (const [index, document] of documents.entries()) {
    documentTokens.push(extractDocumentTerms(document));
    if ((index + 1) % 25 === 0) {
      await yieldToMainThread();
    }
  }
  const frequencies = new Map<string, number>();
  const positiveFrequencies = new Map<string, number>();
  const negativeFrequencies = new Map<string, number>();
  const positiveTotal = labels.filter((label) => label === 1).length;
  const negativeTotal = labels.length - positiveTotal;
  for (const [index, tokens] of documentTokens.entries()) {
    for (const token of new Set(tokens)) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      const target =
        labels[index] === 1
          ? positiveFrequencies
          : negativeFrequencies;
      target.set(token, (target.get(token) ?? 0) + 1);
    }
    if ((index + 1) % 50 === 0) {
      await yieldToMainThread();
    }
  }
  const vocabulary = [...frequencies.entries()]
    .filter(
      ([token, count]) =>
        count >= 2 &&
        count / documents.length <= 0.9 &&
        !isAutomaticStopword(
          token,
          count,
          documents.length,
          positiveFrequencies,
          negativeFrequencies,
          positiveTotal,
          negativeTotal,
        ) &&
        !overrides.get(token)?.isDisabled,
    )
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5000)
    .map(([token]) => token);
  const idf = vocabulary.map(
    (token) =>
      Math.log((documents.length + 1) / ((frequencies.get(token) ?? 0) + 1)) +
      1,
  );
  const positivePresence = new Array<number>(vocabulary.length).fill(0);
  const negativePresence = new Array<number>(vocabulary.length).fill(0);
  const vectors: SparseVector[] = [];
  for (const [rowIndex, document] of documents.entries()) {
    const vector = vectorizeDocument(document, vocabulary, idf);
    for (const entry of vector) {
      const index = entry.index;
      if (labels[rowIndex] === 1) {
        positivePresence[index] = (positivePresence[index] ?? 0) + 1;
      } else {
        negativePresence[index] = (negativePresence[index] ?? 0) + 1;
      }
    }
    vectors.push(vector);
    if ((rowIndex + 1) % 10 === 0) {
      await yieldToMainThread();
    }
  }
  return { vocabulary, idf, vectors, positivePresence, negativePresence };
}

function isAutomaticStopword(
  token: string,
  documentCount: number,
  totalDocuments: number,
  positiveFrequencies: ReadonlyMap<string, number>,
  negativeFrequencies: ReadonlyMap<string, number>,
  positiveTotal: number,
  negativeTotal: number,
): boolean {
  if (
    token.includes(":") ||
    documentCount < 10 ||
    documentCount / totalDocuments < 0.5
  ) {
    return false;
  }
  if (positiveTotal === 0 || negativeTotal === 0) {
    return false;
  }
  const positiveRate =
    (positiveFrequencies.get(token) ?? 0) / positiveTotal;
  const negativeRate =
    (negativeFrequencies.get(token) ?? 0) / negativeTotal;
  return Math.abs(positiveRate - negativeRate) < 0.05;
}

export function trainLogisticCore(
  vectors: SparseVector[],
  labels: number[],
  trainingIndexes: number[],
): TrainedModel {
  let maximumIndex = -1;
  for (const vector of vectors) {
    for (const entry of vector) {
      if (entry.index > maximumIndex) {
        maximumIndex = entry.index;
      }
    }
  }
  const width = maximumIndex + 1;
  const weights = new Array<number>(width).fill(0);
  let intercept = 0;
  const learningRate = 0.4;
  const total = trainingIndexes.length;
  const positiveCount = trainingIndexes.filter((index) => labels[index] === 1).length;
  const negativeCount = total - positiveCount;
  const positiveWeight = total / (2 * Math.max(1, positiveCount));
  const negativeWeight = total / (2 * Math.max(1, negativeCount));
  const sigmoid = (value: number): number => {
    if (value >= 0) {
      return 1 / (1 + Math.exp(-value));
    }
    const exp = Math.exp(value);
    return exp / (1 + exp);
  };
  const dot = (vector: SparseVector): number => {
    let result = 0;
    for (const entry of vector) {
      result += entry.value * (weights[entry.index] ?? 0);
    }
    return result;
  };
  for (let iteration = 0; iteration < 350; iteration += 1) {
    const gradient = new Array<number>(weights.length).fill(0);
    let interceptGradient = 0;
    for (const row of trainingIndexes) {
      const vector = vectors[row] ?? [];
      const label = labels[row] ?? 0;
      const sampleWeight = label === 1 ? positiveWeight : negativeWeight;
      const probability = sigmoid(dot(vector) + intercept);
      const error = (probability - label) * sampleWeight;
      interceptGradient += error;
      for (const entry of vector) {
        gradient[entry.index] =
          (gradient[entry.index] ?? 0) + error * entry.value;
      }
    }
    for (let column = 0; column < weights.length; column += 1) {
      const regularized =
        (gradient[column] ?? 0) / total + 0.01 * (weights[column] ?? 0);
      weights[column] = (weights[column] ?? 0) - learningRate * regularized;
    }
    intercept -= learningRate * interceptGradient / total;
  }
  return { weights, intercept };
}

export async function trainLogisticSparse(
  vectors: SparseVector[],
  labels: number[],
  _positiveCount: number,
  _negativeCount: number,
  trainingIndexes = labels.map((_, index) => index),
): Promise<TrainedModel> {
  return trainLogisticCore(vectors, labels, trainingIndexes);
}

function scoreItem(
  item: RssItem,
  indexByKeyword: ReadonlyMap<string, number>,
  vocabulary: string[],
  idf: number[],
  weights: number[],
  intercept: number,
  lowThreshold: number,
  highThreshold: number,
): {
  itemId: number;
  score: number;
  tier: RecommendationTier;
  matchedKeywords: string;
  contentHash: string;
} | null {
  const document = buildDocument(item);
  const vector = vectorizeItem(item, vocabulary, idf);
  if (vector.length === 0) {
    return null;
  }
  const contributions: Array<{ keyword: string; weight: number }> = [];
  let logit = intercept;
  for (const entry of vector) {
    const keyword = vocabulary[entry.index];
    const index = keyword === undefined ? undefined : indexByKeyword.get(keyword);
    if (index === undefined || keyword === undefined) {
      continue;
    }
    const contribution = entry.value * (weights[index] ?? 0);
    logit += contribution;
    contributions.push({ keyword, weight: contribution });
  }
  const score = Math.round(sigmoid(logit) * 1000) / 10;
  const matched = {
    positive: contributions
      .filter((entry) => entry.weight > 0)
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 3),
    negative: contributions
      .filter((entry) => entry.weight < 0)
      .sort((left, right) => left.weight - right.weight)
      .slice(0, 3),
  };
  return {
    itemId: item.id,
    score,
    tier: scoreToTier(score, lowThreshold, highThreshold),
    matchedKeywords: JSON.stringify(matched),
    contentHash: createHash("sha256").update(document).digest("hex"),
  };
}

export function sparseVectorWidth(vectors: SparseVector[]): number {
  let maximumIndex = -1;
  for (const vector of vectors) {
    for (const entry of vector) {
      if (entry.index > maximumIndex) {
        maximumIndex = entry.index;
      }
    }
  }
  return maximumIndex + 1;
}

function dotSparse(left: SparseVector, right: number[]): number {
  let result = 0;
  for (const entry of left) {
    result += entry.value * (right[entry.index] ?? 0);
  }
  return result;
}

export function stratifiedSplit(labels: number[]): {
  training: number[];
  validation: number[];
} {
  const groups = [0, 1].map((label) =>
    labels
      .map((value, index) => ({ value, index }))
      .filter((entry) => entry.value === label)
      .map((entry) => entry.index),
  );
  if (groups.some((group) => group.length < 5)) {
    return {
      training: labels.map((_, index) => index),
      validation: [],
    };
  }
  const validation = groups.flatMap((group) =>
    group.filter((_, index) => index % 5 === 0),
  );
  const validationSet = new Set(validation);
  return {
    training: labels
      .map((_, index) => index)
      .filter((index) => !validationSet.has(index)),
    validation,
  };
}

export function calibrateThresholds(
  vectors: SparseVector[],
  labels: number[],
  model: TrainedModel,
  validation: number[],
): {
  accuracy: number | null;
  lowThreshold: number;
  highThreshold: number;
} {
  if (validation.length === 0) {
    return { accuracy: null, lowThreshold: 30, highThreshold: 70 };
  }
  let bestCut = 50;
  let bestCorrect = -1;
  for (let cut = 10; cut <= 90; cut += 1) {
    const correct = validation.filter((index) => {
      const probability =
        sigmoid(
          dotSparse(vectors[index] ?? [], model.weights) +
            model.intercept,
        ) * 100;
      return Number(probability >= cut) === (labels[index] ?? 0);
    }).length;
    if (
      correct > bestCorrect ||
      (correct === bestCorrect &&
        Math.abs(cut - 50) < Math.abs(bestCut - 50))
    ) {
      bestCut = cut;
      bestCorrect = correct;
    }
  }
  return {
    accuracy: bestCorrect / validation.length,
    lowThreshold: Math.max(0, bestCut - 10),
    highThreshold: Math.min(100, bestCut + 10),
  };
}

export async function trainLogisticWithWorker(
  vectors: SparseVector[],
  labels: number[],
  positiveCount: number,
  negativeCount: number,
  trainingIndexes: number[],
  registerWorker?: (
    worker: Worker,
    reject: (error: Error) => void,
  ) => void,
): Promise<TrainedModel> {
  if (
    typeof Worker !== "function" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return trainLogisticSparse(
      vectors,
      labels,
      positiveCount,
      negativeCount,
      trainingIndexes,
    );
  }
  const source = `const trainCore=${trainLogisticCore.toString()};self.onmessage=async(e)=>{const d=e.data;self.postMessage(trainCore(d.v,d.l,d.ix))}`;
  const blobUrl = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  try {
    return await new Promise<TrainedModel>((resolve, reject) => {
      const worker = new Worker(blobUrl);
      registerWorker?.(worker, reject);
      worker.onmessage = (event: MessageEvent<TrainedModel>) => {
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message));
      };
      worker.postMessage({
        v: vectors,
        l: labels,
        ix: trainingIndexes,
        p: positiveCount,
        n: negativeCount,
      });
    });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function sigmoid(value: number): number {
  if (value >= 0) {
    return 1 / (1 + Math.exp(-value));
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}
