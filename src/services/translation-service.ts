import { createHash } from "node:crypto";

import type {
  TranslationField,
  TranslationRecord,
} from "../models/domain";
import { t } from "../i18n";
import type { RssReaderSettings } from "../models/settings";
import { RssRepository } from "../repositories/rss-repository";
import type { DatabaseOperationCoordinator } from "./database-operation-coordinator";
import { TranslationRequestError } from "./translation-error";
import type {
  TranslationProvider,
  TranslationResult,
} from "./translation-provider";

type TaskPriority = 0 | 1 | 2 | 3;

type TranslationTimerWindow = Pick<
  Window,
  "setTimeout"
> & Partial<Pick<Window, "clearTimeout">>;

export interface TranslationServiceOptions {
  coordinatorRetryDelayMs?: number;
  maxAttempts?: number;
  requestTimeoutMs?: number;
  retryDelaysMs?: readonly number[];
}

export class TranslationNoticeError extends Error {
  readonly isTranslationNotice = true;

  constructor(message: string) {
    super(message);
    this.name = "TranslationNoticeError";
  }
}

export const DEFAULT_TRANSLATION_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_TRANSLATION_MAX_ATTEMPTS = 3;
export const DEFAULT_TRANSLATION_RETRY_DELAYS_MS = [
  15_000,
  60_000,
  300_000,
] as const;
const MAX_TRANSLATION_COOLDOWN_MS = 15 * 60_000;
const DEFAULT_COORDINATOR_RETRY_DELAY_MS = 500;

interface TranslationTask {
  itemId: number;
  field: TranslationField;
  targetLanguage: string;
  priority: TaskPriority;
}

export interface TranslationChange {
  itemId: number;
  field: TranslationField;
  targetLanguage: string;
  status: TranslationRecord["status"];
}

export class TranslationService {
  private queue: TranslationTask[] = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private stopped = false;
  private generation = 0;
  private lastRequestAt = 0;
  private listeners = new Set<(change: TranslationChange) => void>();

  constructor(
    private readonly repository: RssRepository,
    private readonly provider: TranslationProvider,
    private readonly getSettings: () => RssReaderSettings,
    private readonly timerWindow: TranslationTimerWindow,
    private readonly operationCoordinator?: DatabaseOperationCoordinator,
    private readonly onError: (error: unknown) => void = () => undefined,
    options: TranslationServiceOptions = {},
  ) {
    this.coordinatorRetryDelayMs = positiveInteger(
      options.coordinatorRetryDelayMs,
      DEFAULT_COORDINATOR_RETRY_DELAY_MS,
    );
    this.maxAttempts = positiveInteger(
      options.maxAttempts,
      DEFAULT_TRANSLATION_MAX_ATTEMPTS,
    );
    this.requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      DEFAULT_TRANSLATION_REQUEST_TIMEOUT_MS,
    );
    const retryDelays = options.retryDelaysMs?.filter(
      (delayMs) => Number.isFinite(delayMs) && delayMs > 0,
    );
    this.retryDelaysMs = retryDelays?.length
      ? retryDelays
      : DEFAULT_TRANSLATION_RETRY_DELAYS_MS;
  }

  private readonly coordinatorRetryDelayMs: number;
  private readonly maxAttempts: number;
  private readonly requestTimeoutMs: number;
  private readonly retryDelaysMs: readonly number[];
  private processingTimer: number | null = null;
  private cooldownUntil = 0;
  private consecutiveRetryableFailures = 0;
  private lastReportedFailureKey: string | null = null;

  async initialize(): Promise<void> {
    this.clearProcessingTimer();
    this.queue = [];
    this.stopped = false;
    this.generation += 1;
    this.cooldownUntil = 0;
    this.consecutiveRetryableFailures = 0;
    this.lastReportedFailureKey = null;
    this.lastRequestAt = 0;
    for (const record of this.repository.listTranslationsByStatus(["pending"])) {
      this.enqueue({
        itemId: record.itemId,
        field: record.field,
        targetLanguage: record.targetLanguage,
        priority: record.field === "title" ? 2 : 3,
      });
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.generation += 1;
    this.queue = [];
    this.clearProcessingTimer();
    await this.processingPromise?.catch(() => undefined);
  }

  isBusy(): boolean {
    return this.processing;
  }

  resume(): void {
    if (!this.stopped) {
      this.startProcessing();
    }
  }

  onChange(listener: (change: TranslationChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  requestManual(
    itemId: number,
    field: TranslationField,
    force = false,
  ): Promise<void> {
    return this.prepareAndEnqueue(itemId, field, 0, force);
  }

  hasFailed(field: TranslationField = "title"): boolean {
    const targetLanguage = this.getSettings().targetLanguage;
    return this.repository
      .listTranslationsByStatus(["failed"])
      .some(
        (record) =>
          record.field === field && record.targetLanguage === targetLanguage,
      );
  }

  async retryFailed(field?: TranslationField): Promise<void> {
    this.clearProcessingTimer();
    this.cooldownUntil = 0;
    this.consecutiveRetryableFailures = 0;
    this.lastReportedFailureKey = null;
    const targetLanguage = this.getSettings().targetLanguage;
    for (const record of this.repository.listTranslationsByStatus(["failed"])) {
      if (
        record.targetLanguage !== targetLanguage ||
        (field && record.field !== field)
      ) {
        continue;
      }
      await this.prepareAndEnqueue(
        record.itemId,
        record.field,
        0,
        true,
      );
    }
  }

  private async prepareAndEnqueue(
    itemId: number,
    field: TranslationField,
    priority: TaskPriority,
    force = false,
  ): Promise<void> {
    const generation = this.generation;
    if (this.stopped) {
      return;
    }
    const item = this.repository.getItem(
      itemId,
      this.getSettings().targetLanguage,
    );
    if (!item) {
      return;
    }
    const sourceText = field === "title" ? item.title : item.summary;
    if (!sourceText.trim()) {
      return;
    }
    const targetLanguage = this.getSettings().targetLanguage;
    const sourceHash = hashText(sourceText);
    const existing = this.repository.getTranslation(
      itemId,
      field,
      targetLanguage,
    );
    const resetAttempts = force || existing?.status === "failed";
    if (
      !force &&
      existing?.sourceHash === sourceHash &&
      existing.status === "succeeded"
    ) {
      return;
    }
    const targetRecord: TranslationRecord = {
      itemId,
      field,
      sourceText,
      translatedText: resetAttempts ? null : (existing?.translatedText ?? null),
      sourceLanguage: resetAttempts ? null : (existing?.sourceLanguage ?? null),
      targetLanguage,
      provider: "google-web",
      sourceHash,
      status: "pending",
      attemptCount: resetAttempts ? 0 : (existing?.attemptCount ?? 0),
      lastError: null,
      translatedAt: resetAttempts ? null : (existing?.translatedAt ?? null),
    };
    if (this.stopped || generation !== this.generation) {
      return;
    }
    await this.repository.upsertTranslationTask(targetRecord);
    if (this.stopped || generation !== this.generation) {
      return;
    }
    this.enqueue({ itemId, field, targetLanguage, priority });
  }

  private enqueue(task: TranslationTask, front = false): void {
    const currentIndex = this.queue.findIndex(
      (queued) =>
        queued.itemId === task.itemId &&
        queued.field === task.field &&
        queued.targetLanguage === task.targetLanguage,
    );
    const current =
      currentIndex >= 0 ? this.queue.splice(currentIndex, 1)[0] : undefined;
    const queuedTask: TranslationTask = {
      ...(current ?? task),
      priority: Math.min(
        current?.priority ?? task.priority,
        task.priority,
        front ? 0 : task.priority,
      ) as TaskPriority,
    };
    if (front) {
      this.queue.unshift(queuedTask);
    } else {
      this.queue.push(queuedTask);
    }
    this.queue.sort((left, right) => left.priority - right.priority);
    this.startProcessing();
  }

  private startProcessing(): void {
    void this.processQueue().catch((error: unknown) => {
      this.onError(error);
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.stopped) {
      return;
    }
    const cooldownRemaining = this.cooldownUntil - Date.now();
    if (cooldownRemaining > 0) {
      this.scheduleProcessing(cooldownRemaining);
      return;
    }
    const releaseOperation =
      this.operationCoordinator?.tryAcquireOperation("translation");
    if (this.operationCoordinator && !releaseOperation) {
      this.scheduleProcessing(this.coordinatorRetryDelayMs);
      return;
    }
    this.processing = true;
    const processingPromise = (async () => {
      while (!this.stopped && this.queue.length > 0) {
        const remainingCooldown = this.cooldownUntil - Date.now();
        if (remainingCooldown > 0) {
          this.scheduleProcessing(remainingCooldown);
          break;
        }
        const [task] = this.queue.splice(0, 1);
        if (task) {
          await this.runTask(task);
        }
      }
    })();
    this.processingPromise = processingPromise;
    try {
      await processingPromise;
    } finally {
      this.processing = false;
      this.processingPromise = null;
      releaseOperation?.();
    }
  }

  private async runTask(task: TranslationTask): Promise<void> {
    const generation = this.generation;
    const record = this.repository.getTranslation(
      task.itemId,
      task.field,
      task.targetLanguage,
    );
    if (!record || record.status === "succeeded") {
      return;
    }
    if (this.stopped || generation !== this.generation) {
      return;
    }
    if (isTargetLanguage(record.sourceText, record.targetLanguage)) {
      if (this.stopped || generation !== this.generation) {
        return;
      }
      await this.repository.updateTranslation({
        ...record,
        translatedText: record.sourceText,
        sourceLanguage: record.targetLanguage,
        status: "succeeded",
        lastError: null,
        translatedAt: Date.now(),
      });
      this.resetFailureState();
      if (this.stopped || generation !== this.generation) {
        return;
      }
      this.emitChange(task, "succeeded", record.targetLanguage);
      return;
    }

    const attempt = currentAttempt(record);
    let current: TranslationRecord = {
      ...record,
      status: "translating",
    };
    if (this.stopped || generation !== this.generation) {
      return;
    }
    await this.repository.updateTranslation(current);
    this.emitChange(task, current.status, current.targetLanguage);
    try {
      await this.enforceInterval();
      if (this.stopped || generation !== this.generation) {
        return;
      }
      const result = await this.translateWithTimeout(
        current.sourceText,
        current.targetLanguage,
      );
      if (this.stopped || generation !== this.generation) {
        return;
      }
      current = {
        ...current,
        translatedText: result.translatedText,
        sourceLanguage: result.detectedSourceLanguage,
        status: "succeeded",
        attemptCount: attempt,
        lastError: null,
        translatedAt: Date.now(),
      };
      await this.repository.updateTranslation(current);
      this.resetFailureState();
      this.emitChange(task, current.status, current.targetLanguage);
      return;
    } catch (error) {
      if (this.stopped || generation !== this.generation) {
        return;
      }
      const requestError = normalizeTranslationError(error);
      const shouldRetry = requestError.retryable && attempt < this.maxAttempts;
      current = {
        ...current,
        status: shouldRetry ? "pending" : "failed",
        attemptCount: attempt,
        lastError: requestError.message,
      };
      await this.repository.updateTranslation(current);
      if (this.stopped || generation !== this.generation) {
        return;
      }
      this.emitChange(task, current.status, current.targetLanguage);
      if (requestError.retryable) {
        this.consecutiveRetryableFailures += 1;
        if (shouldRetry) {
          const retryDelayMs = this.retryDelay(requestError);
          this.openCooldown(retryDelayMs);
          this.reportFailure(requestError, retryDelayMs, false);
          this.enqueue(
            {
              ...task,
              priority: 0,
            },
            true,
          );
        } else {
          this.reportFailure(requestError, 0, true);
        }
      } else {
        this.reportFailure(requestError, 0, true);
      }
    }
  }

  private async translateWithTimeout(
    sourceText: string,
    targetLanguage: string,
  ): Promise<TranslationResult> {
    let timeoutId: number | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = this.timerWindow.setTimeout(() => {
        reject(
          new TranslationRequestError(
            t("ui.translation_request_timed_out", {
              seconds: Math.max(1, Math.ceil(this.requestTimeoutMs / 1_000)),
            }),
            {
              kind: "timeout",
              retryable: true,
            },
          ),
        );
      }, this.requestTimeoutMs);
    });
    try {
      return await Promise.race([
        this.provider.translate(sourceText, "auto", targetLanguage),
        timeout,
      ]);
    } finally {
      if (timeoutId !== null) {
        this.timerWindow.clearTimeout?.(timeoutId);
      }
    }
  }

  private retryDelay(error: TranslationRequestError): number {
    const fallbackDelay =
      this.retryDelaysMs[this.retryDelaysMs.length - 1] ??
      DEFAULT_TRANSLATION_RETRY_DELAYS_MS[
        DEFAULT_TRANSLATION_RETRY_DELAYS_MS.length - 1
      ] ??
      300_000;
    const delayMs =
      error.retryAfterMs ??
      this.retryDelaysMs[
        Math.min(
          Math.max(this.consecutiveRetryableFailures - 1, 0),
          this.retryDelaysMs.length - 1,
        )
      ] ??
      fallbackDelay;
    return Math.min(Math.max(delayMs, 1_000), MAX_TRANSLATION_COOLDOWN_MS);
  }

  private openCooldown(delayMs: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delayMs);
    this.scheduleProcessing(this.cooldownUntil - Date.now());
  }

  private scheduleProcessing(delayMs: number): void {
    if (this.stopped || this.processingTimer !== null) {
      return;
    }
    this.processingTimer = this.timerWindow.setTimeout(() => {
      this.processingTimer = null;
      this.startProcessing();
    }, Math.max(0, Math.ceil(delayMs)));
  }

  private clearProcessingTimer(): void {
    if (this.processingTimer === null) {
      return;
    }
    this.timerWindow.clearTimeout?.(this.processingTimer);
    this.processingTimer = null;
  }

  private resetFailureState(): void {
    this.cooldownUntil = 0;
    this.consecutiveRetryableFailures = 0;
    this.lastReportedFailureKey = null;
    this.clearProcessingTimer();
  }

  private reportFailure(
    error: TranslationRequestError,
    retryDelayMs: number,
    exhausted: boolean,
  ): void {
    const key = `${exhausted ? "exhausted" : "retrying"}:${error.kind}:${error.status ?? ""}`;
    if (this.lastReportedFailureKey === key) {
      return;
    }
    this.lastReportedFailureKey = key;
    const message = exhausted
      ? error.retryable
        ? t("ui.translation_retry_exhausted", { error: error.message })
        : t("ui.translation_failed_with_reason", { error: error.message })
      : t("ui.translation_retry_scheduled", {
          error: error.message,
          seconds: Math.max(1, Math.ceil(retryDelayMs / 1_000)),
        });
    this.onError(new TranslationNoticeError(message));
  }

  private async enforceInterval(): Promise<void> {
    const remaining = 1_000 - (Date.now() - this.lastRequestAt);
    if (remaining > 0) {
      await delay(remaining, this.timerWindow);
    }
    this.lastRequestAt = Date.now();
  }

  private emitChange(
    task: TranslationTask,
    status: TranslationRecord["status"],
    targetLanguage: string = this.getSettings().targetLanguage,
  ): void {
    const change: TranslationChange = {
      itemId: task.itemId,
      field: task.field,
      targetLanguage,
      status,
    };
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error) {
        this.onError(error);
      }
    }
  }
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function isTargetLanguage(text: string, target: string): boolean {
  if (target.toLocaleLowerCase() !== "zh-cn") {
    return false;
  }
  const compact = text.replace(/\s+/g, "");
  if (!compact) {
    return true;
  }
  const hanCount = (compact.match(/\p{Script=Han}/gu) ?? []).length;
  const kanaOrHangul = (
    compact.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ??
    []
  ).length;
  const latinCount = (compact.match(/\p{Script=Latin}/gu) ?? []).length;
  return kanaOrHangul === 0 && hanCount > 0 && hanCount >= latinCount * 2;
}

function delay(
  milliseconds: number,
  timerWindow: TranslationTimerWindow,
): Promise<void> {
  return new Promise((resolve) =>
    timerWindow.setTimeout(resolve, milliseconds),
  );
}

function currentAttempt(record: TranslationRecord): number {
  return Math.max(1, record.attemptCount + 1);
}

function normalizeTranslationError(error: unknown): TranslationRequestError {
  if (error instanceof TranslationRequestError) {
    return error;
  }
  return new TranslationRequestError(
    error instanceof Error && error.message.trim()
      ? error.message
      : t("ui.translation_network_error"),
    {
      kind: "network",
      retryable: true,
    },
  );
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}
