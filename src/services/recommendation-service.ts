import { t } from "../i18n";
import type { RssReaderSettings } from "../models/settings";
import { RssRepository } from "../repositories/rss-repository";
import type { DatabaseOperationCoordinator } from "../infrastructure/database-operation-coordinator";
import { randomUuid, sha256 } from "../infrastructure/desktop-runtime";
import {
  FEATURE_VERSION,
  buildFeatures,
  buildDocument,
  calibrateThresholds,
  recommendationTrainingHash,
  resolveThresholds,
  scoreItem,
  stratifiedSplit,
  trainLogisticWithWorker,
  type TrainedModel,
} from "./recommendation-core";

export * from "./recommendation-core";

const POSITIVE = new Set(["interested", "archived"]);

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
    if (this.activeRebuild) {
      throw new Error(t("ui.a_recommendation_update_is_already_in_progress"));
    }
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

  isBusy(): boolean {
    return this.activeRebuild !== null;
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
      sha256,
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
    const modelVersion = randomUuid().replaceAll("-", "");

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
      sha256,
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
        const contentHash = sha256(buildDocument(item));
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
          sha256,
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
        sha256,
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
