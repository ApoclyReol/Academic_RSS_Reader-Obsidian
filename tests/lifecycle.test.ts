import { Window as HappyWindow } from "happy-dom";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { RssDatabase } from "../src/database/database";
import { DEFAULT_SETTINGS } from "../src/models/settings";
import { RssRepository } from "../src/repositories/rss-repository";
import { DatabaseOperationCoordinator } from "../src/services/database-operation-coordinator";
import type {
  TranslationProvider,
  TranslationResult,
} from "../src/services/translation-provider";
import { TranslationService } from "../src/services/translation-service";
import { MemoryAdapter } from "./helpers/memory-adapter";

const timerWindow = new HappyWindow() as unknown as Pick<
  Window,
  "setTimeout"
>;

describe("database lifecycle coordination", () => {
  const databases: RssDatabase[] = [];

  afterEach(() => {
    for (const database of databases) {
      database.close();
    }
    databases.length = 0;
  });

  it("rejects transitions while operations are active", () => {
    const coordinator = new DatabaseOperationCoordinator();
    for (const kind of [
      "database-write",
      "feed-update",
      "translation",
      "llm-review",
      "recommendation",
    ] as const) {
      const releaseOperation = coordinator.acquireOperation(kind);
      expect(() => coordinator.acquireTransition()).toThrow(
        "后台任务正在执行",
      );
      releaseOperation();
    }

    const releaseTransition = coordinator.acquireTransition();
    expect(() => coordinator.acquireOperation("feed-update")).toThrow(
      "数据库正在切换或恢复",
    );
    releaseTransition();
    expect(() => coordinator.acquireTransition()).not.toThrow();
  });

  it("waits for an in-flight translation and prevents post-stop writes", async () => {
    const coordinator = new DatabaseOperationCoordinator();
    const { database, repository, itemIds } = await createRepository(
      coordinator,
      1,
    );
    databases.push(database);

    let markStarted!: () => void;
    let resolveTranslation!: (result: TranslationResult) => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const provider: TranslationProvider = {
      id: "google-web",
      translate: () => {
        markStarted();
        return new Promise<TranslationResult>((resolve) => {
          resolveTranslation = resolve;
        });
      },
    };
    const service = new TranslationService(
      repository,
      provider,
      () => DEFAULT_SETTINGS,
      timerWindow,
      coordinator,
    );
    await service.initialize();
    await service.requestManual(itemIds[0]!, "title");
    await started;

    let stopped = false;
    const stopping = service.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    resolveTranslation({
      translatedText: "译文",
      detectedSourceLanguage: "en",
    });
    await stopping;

    const record = repository.getTranslation(
      itemIds[0]!,
      "title",
      "zh-CN",
    );
    expect(record?.status).toBe("translating");
    expect(record?.translatedText).toBeNull();
  });

  it("normalizes and resumes pending translations after restore", async () => {
    const coordinator = new DatabaseOperationCoordinator();
    const { database, repository, itemIds } = await createRepository(
      coordinator,
      3,
    );
    databases.push(database);
    for (const [index, status] of [
      "pending",
      "translating",
      "failed",
    ].entries()) {
      await repository.upsertTranslationTask({
        itemId: itemIds[index]!,
        field: "title",
        sourceText: `English title ${index}`,
        translatedText: null,
        sourceLanguage: null,
        targetLanguage: "zh-CN",
        provider: "google-web",
        sourceHash: `hash-${index}`,
        status: status as "pending" | "translating" | "failed",
        attemptCount: 0,
        lastError: status === "failed" ? "failed" : null,
        translatedAt: null,
      });
    }
    const restoredBytes = database.exportBytes();
    const translatedTexts: string[] = [];
    const provider: TranslationProvider = {
      id: "google-web",
      translate: async (text) => {
        translatedTexts.push(text);
        return {
          translatedText: `译文 ${translatedTexts.length}`,
          detectedSourceLanguage: "en",
        };
      },
    };
    const service = new TranslationService(
      repository,
      provider,
      () => DEFAULT_SETTINGS,
      timerWindow,
      coordinator,
    );

    const releaseTransition = coordinator.acquireTransition();
    await database.replaceFromBytes(restoredBytes);
    await service.initialize();
    expect(
      repository.listTranslationsByStatus(["pending"]),
    ).toHaveLength(2);
    expect(
      repository.listTranslationsByStatus(["failed"]),
    ).toHaveLength(1);
    releaseTransition();
    service.resume();

    await vi.waitFor(
      () => {
        expect(translatedTexts).toHaveLength(2);
        expect(
          repository.listTranslationsByStatus(["succeeded"]),
        ).toHaveLength(2);
      },
      { timeout: 2_500 },
    );
    await service.stop();
  });
});

async function createRepository(
  coordinator: DatabaseOperationCoordinator,
  itemCount: number,
): Promise<{
  database: RssDatabase;
  repository: RssRepository;
  itemIds: number[];
}> {
  const adapter = new MemoryAdapter();
  const database = new RssDatabase(
    adapter,
    "Data/rss-reader.sqlite3",
    coordinator,
  );
  await database.initialize();
  const repository = new RssRepository(database);
  const feedId = await repository.addFeed({
    name: "Journal",
    url: "https://example.com/rss",
    enabled: true,
  });
  const stored = await repository.upsertParsedItems(
    feedId,
    Array.from({ length: itemCount }, (_, index) => ({
      stableGuid: `guid-${index}`,
      title: `English title ${index}`,
      titleNorm: `english title ${index}`,
      authors: "Author",
      journal: "Journal",
      year: "2026",
      doi: "",
      link: "",
      pubDate: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      summary: "",
    })),
  );
  return {
    database,
    repository,
    itemIds: stored.insertedIds,
  };
}
