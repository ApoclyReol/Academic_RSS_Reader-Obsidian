import type {
  KeywordRecord,
  RecommendationTier,
  RssItem,
} from "../models/domain";
import type { RssReaderSettings } from "../models/settings";

const STOPWORDS = new Set(
  `
  a an and are as at be been by can could for from has have how in into is it its
  may might more most new not of on or our paper research study than that the their
  these this through to toward using via was we were what when where which while who
  with would results method analysis based effects evidence approach role model data
  \u4e00\u79cd \u4e00\u4e2a \u4ee5\u53ca \u901a\u8fc7 \u5bf9\u4e8e \u5173\u4e8e \u4e2d\u7684 \u7814\u7a76 \u5206\u6790 \u57fa\u4e8e \u5f71\u54cd \u4f5c\u7528 \u65b9\u6cd5 \u6a21\u578b \u6570\u636e \u7ed3\u679c
  `.trim().split(/\s+/),
);

export interface SparseEntry {
  index: number;
  value: number;
}

export type SparseVector = SparseEntry[];

export interface TrainedModel {
  weights: number[];
  intercept: number;
}

export interface FeatureData {
  vocabulary: string[];
  idf: number[];
  vectors: SparseVector[];
  positivePresence: number[];
  negativePresence: number[];
}

export interface RecommendationScore {
  itemId: number;
  score: number;
  tier: RecommendationTier;
  matchedKeywords: string;
  contentHash: string;
}

export type HashText = (value: string) => string;

export const FEATURE_VERSION = 4;

export function recommendationTrainingHash(
  documents: string[],
  labels: number[],
  overrides: KeywordRecord[],
  thresholdOverrides: Pick<
    RssReaderSettings,
    "recommendationLowThreshold" | "recommendationHighThreshold"
  >,
  hashText: HashText,
): string {
  return hashText(JSON.stringify({
    featureVersion: FEATURE_VERSION,
    documents,
    labels,
    overrides: overrides.map((value) => [
      value.keyword,
      value.isDisabled,
    ]),
    thresholdOverrides,
  }));
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

export async function buildFeatures(
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

export function scoreItem(
  item: RssItem,
  indexByKeyword: ReadonlyMap<string, number>,
  vocabulary: string[],
  idf: number[],
  weights: number[],
  intercept: number,
  lowThreshold: number,
  highThreshold: number,
  hashText: HashText,
): RecommendationScore | null {
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
    contentHash: hashText(document),
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
