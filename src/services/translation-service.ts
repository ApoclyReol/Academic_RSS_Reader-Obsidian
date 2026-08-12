import { createHash } from "node:crypto";

import type {
  TranslationField,
  TranslationRecord,
} from "../models/domain";
import type { RssReaderSettings } from "../models/settings";
import { RssRepository } from "../repositories/rss-repository";
import type { DatabaseOperationCoordinator } from "./database-operation-coordinator";
import type { TranslationProvider } from "./translation-provider";

type TaskPriority = 0 | 1 | 2 | 3;

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
    private readonly timerWindow: Pick<Window, "setTimeout">,
    private readonly operationCoordinator?: DatabaseOperationCoordinator,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async initialize(): Promise<void> {
    this.queue = [];
    this.stopped = false;
    this.generation += 1;
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

  async retryFailed(): Promise<void> {
    for (const record of this.repository.listTranslationsByStatus(["failed"])) {
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
      translatedText: force ? null : (existing?.translatedText ?? null),
      sourceLanguage: force ? null : (existing?.sourceLanguage ?? null),
      targetLanguage,
      provider: "google-web",
      sourceHash,
      status: "pending",
      attemptCount: force ? 0 : (existing?.attemptCount ?? 0),
      lastError: null,
      translatedAt: force ? null : (existing?.translatedAt ?? null),
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

  private enqueue(task: TranslationTask): void {
    const current = this.queue.find(
      (queued) =>
        queued.itemId === task.itemId &&
        queued.field === task.field &&
        queued.targetLanguage === task.targetLanguage,
    );
    if (current) {
      current.priority = Math.min(current.priority, task.priority) as TaskPriority;
    } else {
      this.queue.push(task);
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
    const releaseOperation =
      this.operationCoordinator?.tryAcquireOperation("translation");
    if (this.operationCoordinator && !releaseOperation) {
      return;
    }
    this.processing = true;
    const processingPromise = (async () => {
      while (!this.stopped && this.queue.length > 0) {
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
      if (this.stopped || generation !== this.generation) {
        return;
      }
      this.emitChange(task, "succeeded", record.targetLanguage);
      return;
    }

    let current: TranslationRecord = {
      ...record,
      status: "translating",
    };
    if (this.stopped || generation !== this.generation) {
      return;
    }
    await this.repository.updateTranslation(current);
    this.emitChange(task, current.status, current.targetLanguage);
    for (let attempt = current.attemptCount + 1; attempt <= 3; attempt += 1) {
      try {
        await this.enforceInterval();
        if (this.stopped || generation !== this.generation) {
          return;
        }
        const result = await this.provider.translate(
          current.sourceText,
          "auto",
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
        this.emitChange(task, current.status, current.targetLanguage);
        return;
      } catch (error) {
        if (this.stopped || generation !== this.generation) {
          return;
        }
        current = {
          ...current,
          status: attempt >= 3 ? "failed" : "translating",
          attemptCount: attempt,
          lastError: error instanceof Error ? error.message : String(error),
        };
        if (this.stopped || generation !== this.generation) {
          return;
        }
        await this.repository.updateTranslation(current);
        if (attempt < 3) {
          await delay(1_000 * attempt, this.timerWindow);
          if (this.stopped || generation !== this.generation) {
            return;
          }
        }
      }
    }
    if (current.status === "failed") {
      if (this.stopped || generation !== this.generation) {
        return;
      }
      await this.repository.deleteTranslationTask(
        current.itemId,
        current.field,
        current.targetLanguage,
      );
    }
    this.emitChange(task, current.status, current.targetLanguage);
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
    targetLanguage = this.getSettings().targetLanguage,
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
  if (!target.toLocaleLowerCase().startsWith("zh")) {
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
  timerWindow: Pick<Window, "setTimeout">,
): Promise<void> {
  return new Promise((resolve) =>
    timerWindow.setTimeout(resolve, milliseconds),
  );
}
