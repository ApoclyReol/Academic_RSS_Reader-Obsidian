import { Window as HappyWindow } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  requestUrl: vi.fn(),
}));

import {
  hashText,
  isTargetLanguage,
  TranslationService,
} from "../src/services/translation-service";
import { RssDatabase } from "../src/database/database";
import { RssRepository } from "../src/repositories/rss-repository";
import {
  DEFAULT_SETTINGS,
  type RssReaderSettings,
} from "../src/models/settings";
import {
  TranslationRequestError,
  type TranslationProvider,
} from "../src/services/translation-provider";
import { MemoryAdapter } from "./helpers/memory-adapter";

const timerWindow = new HappyWindow() as unknown as Pick<
  Window,
  "setTimeout" | "clearTimeout"
>;

describe("translation helpers", () => {
  const resources: Array<{ database: RssDatabase; adapter: MemoryAdapter }> = [];

  afterEach(async () => {
    for (const resource of resources) {
      await resource.database.drain().catch(() => undefined);
      resource.database.close();
      resource.adapter.dispose();
    }
    resources.length = 0;
  });
  it("skips Chinese text for the Chinese target", () => {
    expect(isTargetLanguage("这是一个中文标题", "zh-CN")).toBe(true);
    expect(isTargetLanguage("这是一个中文标题", "zh-TW")).toBe(false);
    expect(isTargetLanguage("A study of libraries", "zh-CN")).toBe(false);
    expect(isTargetLanguage("人工智能 AI", "zh-CN")).toBe(true);
  });

  it("invalidates cache when source text changes", () => {
    expect(hashText("same")).toBe(hashText("same"));
    expect(hashText("same")).not.toBe(hashText("changed"));
  });

  it("bounds automatic retries and keeps the failed task for manual retry", async () => {
    const adapter = new MemoryAdapter();
    const database = new RssDatabase(adapter, "Data/rss-reader.sqlite3");
    await database.initialize();
    resources.push({ database, adapter });
    const repository = new RssRepository(database);
    const feedId = await repository.addFeed({
      name: "Translation feed",
      url: "https://example.com/translation",
      enabled: true,
    });
    const { insertedIds } = await repository.upsertParsedItems(feedId, [{
      stableGuid: "translation-guid",
      title: "An English title",
      titleNorm: "an english title",
      authors: "Alice",
      journal: "Translation journal",
      year: "2026",
      doi: "",
      link: "",
      pubDate: "",
      summary: "",
    }]);
    let attempts = 0;
    const provider: TranslationProvider = {
      id: "google-web",
      translate: async () => {
        attempts += 1;
        throw new Error("provider failed");
      },
    };
    const service = new TranslationService(
      repository,
      provider,
      () => DEFAULT_SETTINGS,
      timerWindow,
      undefined,
      undefined,
      {
        retryDelaysMs: [1_000, 1_000, 1_000],
      },
    );
    try {
      const changes: string[] = [];
      service.onChange((change) => changes.push(`${change.targetLanguage}:${change.status}`));
      await service.requestManual(insertedIds[0]!, "title");
      await waitForCondition(() => attempts === 3);
      expect(
        repository.getTranslation(insertedIds[0]!, "title", "zh-CN"),
      ).toMatchObject({
        status: "failed",
        attemptCount: 3,
        lastError: "provider failed",
      });
      expect(changes[changes.length - 1]).toBe("zh-CN:failed");

      const retry = service.retryFailed("title");
      await retry;
      await waitForCondition(() => attempts === 6);
    } finally {
      await service.stop();
    }
  }, 15_000);

  it("times out a stalled provider and stops after the retry budget", async () => {
    const adapter = new MemoryAdapter();
    const database = new RssDatabase(adapter, "Data/rss-reader.sqlite3");
    await database.initialize();
    resources.push({ database, adapter });
    const repository = new RssRepository(database);
    const feedId = await repository.addFeed({
      name: "Timeout feed",
      url: "https://example.com/timeout",
      enabled: true,
    });
    const { insertedIds } = await repository.upsertParsedItems(feedId, [{
      stableGuid: "timeout-guid",
      title: "A stalled translation",
      titleNorm: "a stalled translation",
      authors: "Alice",
      journal: "Timeout journal",
      year: "2026",
      doi: "",
      link: "",
      pubDate: "",
      summary: "",
    }]);
    const notices: unknown[] = [];
    const provider: TranslationProvider = {
      id: "google-web",
      translate: async () => new Promise<never>(() => undefined),
    };
    const service = new TranslationService(
      repository,
      provider,
      () => DEFAULT_SETTINGS,
      timerWindow,
      undefined,
      (error) => notices.push(error),
      {
        requestTimeoutMs: 25,
        retryDelaysMs: [1_000, 1_000, 1_000],
      },
    );
    try {
      await service.requestManual(insertedIds[0]!, "title");
      await waitForCondition(
        () =>
          repository.getTranslation(insertedIds[0]!, "title", "zh-CN")
            ?.status === "failed",
      );
      expect(
        repository.getTranslation(insertedIds[0]!, "title", "zh-CN"),
      ).toMatchObject({ attemptCount: 3, status: "failed" });
      expect(notices).toHaveLength(2);
    } finally {
      await service.stop();
    }
  }, 15_000);

  it("honors a retryable provider error without retrying forever", async () => {
    const adapter = new MemoryAdapter();
    const database = new RssDatabase(adapter, "Data/rss-reader.sqlite3");
    await database.initialize();
    resources.push({ database, adapter });
    const repository = new RssRepository(database);
    const feedId = await repository.addFeed({
      name: "Rate limit feed",
      url: "https://example.com/rate-limit",
      enabled: true,
    });
    const { insertedIds } = await repository.upsertParsedItems(feedId, [{
      stableGuid: "rate-limit-guid",
      title: "A rate limited translation",
      titleNorm: "a rate limited translation",
      authors: "Alice",
      journal: "Rate limit journal",
      year: "2026",
      doi: "",
      link: "",
      pubDate: "",
      summary: "",
    }]);
    let attempts = 0;
    const notices: unknown[] = [];
    const provider: TranslationProvider = {
      id: "google-web",
      translate: async () => {
        attempts += 1;
        throw new TranslationRequestError("rate limited", {
          kind: "rate-limit",
          retryable: true,
          retryAfterMs: 1,
          status: 429,
        });
      },
    };
    const service = new TranslationService(
      repository,
      provider,
      () => DEFAULT_SETTINGS,
      timerWindow,
      undefined,
      (error) => notices.push(error),
      {
        retryDelaysMs: [1_000, 1_000, 1_000],
      },
    );
    try {
      await service.requestManual(insertedIds[0]!, "title");
      await waitForCondition(() => attempts === 3);
      expect(
        repository.getTranslation(insertedIds[0]!, "title", "zh-CN"),
      ).toMatchObject({ attemptCount: 3, status: "failed" });
      expect(notices).toHaveLength(2);
    } finally {
      await service.stop();
    }
  }, 15_000);

  it("keeps translation cache entries separate when the target language changes", async () => {
    const adapter = new MemoryAdapter();
    const database = new RssDatabase(adapter, "Data/rss-reader.sqlite3");
    await database.initialize();
    resources.push({ database, adapter });
    const repository = new RssRepository(database);
    const feedId = await repository.addFeed({
      name: "Language feed",
      url: "https://example.com/language",
      enabled: true,
    });
    const { insertedIds } = await repository.upsertParsedItems(feedId, [{
      stableGuid: "language-guid",
      title: "An English title",
      titleNorm: "an english title",
      authors: "Alice",
      journal: "Language journal",
      year: "2026",
      doi: "",
      link: "",
      pubDate: "",
      summary: "",
    }]);
    const settings: RssReaderSettings = {
      ...DEFAULT_SETTINGS,
      targetLanguage: "zh-CN",
    };
    const targets: string[] = [];
    const provider: TranslationProvider = {
      id: "google-web",
      translate: async (_text, _sourceLanguage, targetLanguage) => {
        targets.push(targetLanguage);
        return {
          translatedText: targetLanguage === "zh-CN" ? "中文标题" : "English title",
          detectedSourceLanguage: "en",
        };
      },
    };
    const service = new TranslationService(
      repository,
      provider,
      () => settings,
      timerWindow,
    );
    const itemId = insertedIds[0]!;
    try {
      await service.requestManual(itemId, "title");
      await waitForCondition(() =>
        repository.getTranslation(itemId, "title", "zh-CN")?.status === "succeeded",
      );
      settings.targetLanguage = "en";
      await service.requestManual(itemId, "title");
      await waitForCondition(() =>
        repository.getTranslation(itemId, "title", "en")?.status === "succeeded",
      );
      expect(targets).toEqual(["zh-CN", "en"]);
      expect(repository.getTranslation(itemId, "title", "zh-CN")?.translatedText)
        .toBe("中文标题");
      expect(repository.getTranslation(itemId, "title", "en")?.translatedText)
        .toBe("English title");
    } finally {
      await service.stop();
    }
  }, 15_000);
});

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 350; index += 1) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve) => timerWindow.setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for translation task");
}
