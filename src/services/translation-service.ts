import { createHash } from "node:crypto";

import type {
  TranslationField,
  TranslationRecord,
} from "../models/domain";
import type { RssReaderSettings } from "../models/settings";
import { RssRepository } from "../repositories/rss-repository";
import type { TranslationProvider } from "./translation-provider";

type TaskPriority = 0 | 1 | 2 | 3;

interface TranslationTask {
  itemId: number;
  field: TranslationField;
  priority: TaskPriority;
  manual: boolean;
}

export class TranslationService {
  private queue: TranslationTask[] = [];
  private processing = false;
  private stopped = false;
  private lastRequestAt = 0;
  private listeners = new Set<() => void>();

  constructor(
    private readonly repository: RssRepository,
    private readonly provider: TranslationProvider,
    private readonly getSettings: () => RssReaderSettings,
  ) {}

  async initialize(): Promise<void> {
    for (const record of this.repository.listTranslationsByStatus(["pending"])) {
      this.enqueue({
        itemId: record.itemId,
        field: record.field,
        priority: record.field === "title" ? 2 : 3,
        manual: false,
      });
    }
  }

  stop(): void {
    this.stopped = true;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  enqueueNewItems(itemIds: number[]): void {
    const settings = this.getSettings();
    for (const itemId of itemIds) {
      if (settings.autoTranslateTitles) {
        void this.prepareAndEnqueue(itemId, "title", 2, false);
      }
      if (settings.abstractTranslationMode === "automatic") {
        void this.prepareAndEnqueue(itemId, "abstract", 3, false);
      }
    }
  }

  requestOnOpen(itemId: number): void {
    if (this.getSettings().abstractTranslationMode === "on-open") {
      void this.prepareAndEnqueue(itemId, "abstract", 1, false);
    }
  }

  requestManual(
    itemId: number,
    field: TranslationField,
    force = false,
  ): void {
    void this.prepareAndEnqueue(itemId, field, 0, true, force);
  }

  retryFailed(): void {
    for (const record of this.repository.listTranslationsByStatus(["failed"])) {
      void this.prepareAndEnqueue(
        record.itemId,
        record.field,
        0,
        true,
        true,
      );
    }
  }

  private async prepareAndEnqueue(
    itemId: number,
    field: TranslationField,
    priority: TaskPriority,
    manual: boolean,
    force = false,
  ): Promise<void> {
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
    await this.repository.upsertTranslationTask(targetRecord);
    this.enqueue({ itemId, field, priority, manual });
  }

  private enqueue(task: TranslationTask): void {
    const current = this.queue.find(
      (queued) =>
        queued.itemId === task.itemId && queued.field === task.field,
    );
    if (current) {
      current.priority = Math.min(current.priority, task.priority) as TaskPriority;
      current.manual ||= task.manual;
    } else {
      this.queue.push(task);
    }
    this.queue.sort((left, right) => left.priority - right.priority);
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.stopped) {
      return;
    }
    this.processing = true;
    try {
      while (!this.stopped && this.queue.length > 0) {
        const nextIndex = this.queue.findIndex(
          (task) =>
            task.manual || !this.getSettings().pauseAutomaticTranslation,
        );
        if (nextIndex < 0) {
          break;
        }
        const [task] = this.queue.splice(nextIndex, 1);
        if (task) {
          await this.runTask(task);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async runTask(task: TranslationTask): Promise<void> {
    const settings = this.getSettings();
    const record = this.repository.getTranslation(
      task.itemId,
      task.field,
      settings.targetLanguage,
    );
    if (!record || record.status === "succeeded") {
      return;
    }
    if (isTargetLanguage(record.sourceText, record.targetLanguage)) {
      await this.repository.updateTranslation({
        ...record,
        translatedText: record.sourceText,
        sourceLanguage: record.targetLanguage,
        status: "succeeded",
        lastError: null,
        translatedAt: Date.now(),
      });
      this.emitChange();
      return;
    }

    let current: TranslationRecord = {
      ...record,
      status: "translating",
    };
    await this.repository.updateTranslation(current);
    this.emitChange();
    for (let attempt = current.attemptCount + 1; attempt <= 3; attempt += 1) {
      try {
        await this.enforceInterval();
        const result = await this.provider.translate(
          current.sourceText,
          "auto",
          current.targetLanguage,
        );
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
        this.emitChange();
        return;
      } catch (error) {
        current = {
          ...current,
          status: attempt >= 3 ? "failed" : "translating",
          attemptCount: attempt,
          lastError: error instanceof Error ? error.message : String(error),
        };
        await this.repository.updateTranslation(current);
        if (attempt < 3) {
          await delay(1_000 * attempt);
        }
      }
    }
    this.emitChange();
  }

  private async enforceInterval(): Promise<void> {
    const remaining = 1_000 - (Date.now() - this.lastRequestAt);
    if (remaining > 0) {
      await delay(remaining);
    }
    this.lastRequestAt = Date.now();
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
