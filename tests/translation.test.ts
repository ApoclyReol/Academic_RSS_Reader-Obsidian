import { Window as HappyWindow } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

import {
  hashText,
  isTargetLanguage,
  TranslationService,
} from "../src/services/translation-service";
import { RssDatabase } from "../src/database/database";
import { RssRepository } from "../src/repositories/rss-repository";
import { DEFAULT_SETTINGS } from "../src/models/settings";
import type { TranslationProvider } from "../src/services/translation-provider";
import { MemoryAdapter } from "./helpers/memory-adapter";

const timerWindow = new HappyWindow() as unknown as Pick<Window, "setTimeout">;

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
    expect(isTargetLanguage("A study of libraries", "zh-CN")).toBe(false);
    expect(isTargetLanguage("人工智能 AI", "zh-CN")).toBe(true);
  });

  it("invalidates cache when source text changes", () => {
    expect(hashText("same")).toBe(hashText("same"));
    expect(hashText("same")).not.toBe(hashText("changed"));
  });

  it("removes a failed request placeholder so the next request can retry", async () => {
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
    );
    try {
      const changes: string[] = [];
      service.onChange((change) => changes.push(`${change.targetLanguage}:${change.status}`));
      await service.requestManual(insertedIds[0]!, "title");
      await waitForCondition(() => attempts === 3);
      expect(repository.getTranslation(insertedIds[0]!, "title", "zh-CN")).toBeNull();
      expect(changes[changes.length - 1]).toBe("zh-CN:failed");

      const retry = service.requestManual(insertedIds[0]!, "title");
      await retry;
      await waitForCondition(() => attempts === 6);
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
    const settings = { ...DEFAULT_SETTINGS, targetLanguage: "zh-CN" };
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
