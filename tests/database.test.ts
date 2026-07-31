import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RssDatabase,
  inspectDatabaseFile,
  recoverDatabaseFile,
} from "../src/database/database";
import { RssRepository } from "../src/repositories/rss-repository";
import { stableGuid } from "../src/services/rss-parser";
import { MemoryAdapter } from "./helpers/memory-adapter";

describe("database and repository", () => {
  let database: RssDatabase;
  let repository: RssRepository;
  let adapter: MemoryAdapter;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    database = new RssDatabase(adapter, "Data/test.sqlite3");
    await database.initialize();
    repository = new RssRepository(database);
  });

  afterEach(() => database.close());

  it("applies ordered schema migrations for feeds and models", () => {
    const versions = database.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3]);
    const feedColumns = database.query<{ name: string }>(
      "PRAGMA table_info(feeds)",
    );
    expect(feedColumns.map((row) => row.name)).toContain("etag");
    const modelColumns = database.query<{ name: string }>(
      "PRAGMA table_info(recommendation_models)",
    );
    expect(modelColumns.map((row) => row.name)).toContain(
      "training_hash",
    );
  });

  it("preserves disabled keywords across model replacement", async () => {
    await repository.replaceRecommendationResults({
      modelVersion: "model-before-disable",
      positiveCount: 2,
      negativeCount: 2,
      unreadCount: 0,
      errorMessage: null,
      keywords: [{
        keyword: "libraries",
        autoWeight: 1.5,
        positiveCount: 2,
        negativeCount: 0,
        idf: 1,
      }],
      scores: [],
    });
    await repository.setKeywordDisabled("libraries", true);
    await repository.replaceRecommendationResults({
      modelVersion: "model-after-disable",
      positiveCount: 2,
      negativeCount: 2,
      unreadCount: 0,
      errorMessage: null,
      keywords: [],
      scores: [],
    });
    const keyword = repository.listKeywords().find(
      (entry) => entry.keyword === "libraries",
    );
    expect(keyword?.isDisabled).toBe(true);
    expect(keyword?.effectiveWeight).toBe(0);
  });

  it("removes stale automatic keywords when replacing a model", async () => {
    const replace = async (
      version: string,
      keyword: string,
    ): Promise<void> =>
      repository.replaceRecommendationResults({
        modelVersion: version,
        positiveCount: 2,
        negativeCount: 2,
        unreadCount: 0,
        errorMessage: null,
        keywords: [{
          keyword,
          autoWeight: 1,
          positiveCount: 2,
          negativeCount: 0,
          idf: 1,
        }],
        scores: [],
      });
    await replace("model-one", "old-term");
    await replace("model-two", "new-term");
    const keywords = repository.listKeywords().map(
      (entry) => entry.keyword,
    );
    expect(keywords).toContain("new-term");
    expect(keywords).not.toContain("old-term");
  });

  it("stores feeds, items, shared links and recoverable statuses", async () => {
    const feedId = await repository.addFeed({
      name: "Journal",
      url: "https://example.com/rss",
      enabled: true,
    });
    const stored = await repository.upsertParsedItems(feedId, [
      {
        stableGuid: "guid-1",
        title: "Paper",
        titleNorm: "paper",
        authors: "Alice",
        journal: "Journal",
        year: "2024",
        doi: "",
        link: "https://example.com/paper",
        pubDate: "2024-01-01T00:00:00.000Z",
        summary: "Abstract",
      },
    ]);
    expect(stored.insertedIds).toHaveLength(1);
    expect(repository.countByStatus().unread).toBe(1);

    await repository.setItemStatus(stored.insertedIds, "hidden");
    expect(repository.countByStatus().hidden).toBe(1);
    await repository.setItemStatus(stored.insertedIds, "unread");
    expect(repository.countByStatus().unread).toBe(1);
  });

  it("deduplicates by stable GUID and records feed association", async () => {
    const feedId = await repository.addFeed({
      name: "Journal",
      url: "https://example.com/rss",
      enabled: true,
    });
    const item = {
      stableGuid: "same-guid",
      title: "Paper",
      titleNorm: "paper",
      authors: "Alice",
      journal: "Journal",
      year: "2024",
      doi: "",
      link: "",
      pubDate: "",
      summary: "",
    };
    await repository.upsertParsedItems(feedId, [item]);
    const duplicate = await repository.upsertParsedItems(feedId, [item]);
    expect(duplicate.insertedIds).toHaveLength(0);
    expect(duplicate.duplicateHits).toBe(1);
    expect(repository.countItems()).toBe(1);
  });

  it("exports and restores a database backup", async () => {
    await repository.addFeed({
      name: "Before restore",
      url: "https://example.com/before",
      enabled: true,
    });
    const destination = "Backups/backup.sqlite3";
    await database.backup(destination);
    await expect(adapter.exists(destination)).resolves.toBe(true);
    await repository.addFeed({
      name: "After backup",
      url: "https://example.com/after",
      enabled: true,
    });
    expect(repository.listFeeds()).toHaveLength(2);
    await database.restoreFromFile(destination);
    expect(repository.listFeeds()).toHaveLength(1);
  });

  it("does not create a database when existing-file loading is required", async () => {
    const path = "Missing/missing.sqlite3";
    const candidate = new RssDatabase(adapter, path);
    await expect(
      candidate.initialize({ createIfMissing: false }),
    ).rejects.toThrow("没有 rss-reader.sqlite3");
    await expect(adapter.exists(path)).resolves.toBe(false);
    candidate.close();
  });

  it("inspects valid and damaged databases without modifying them", async () => {
    expect(await inspectDatabaseFile(adapter, database.path)).toEqual({
      exists: true,
      valid: true,
      error: null,
    });
    const path = "Invalid/rss-reader.sqlite3";
    await adapter.mkdir("Invalid");
    const bytes = new TextEncoder().encode("not a sqlite database");
    await adapter.writeBinary(path, bytes.buffer);
    const result = await inspectDatabaseFile(adapter, path);
    expect(result.exists).toBe(true);
    expect(result.valid).toBe(false);
    expect(new Uint8Array(await adapter.readBinary(path))).toEqual(bytes);
  });

  it("uses a valid primary database without reading stale candidates", async () => {
    const trackingAdapter = new TrackingAdapter();
    const primary = new RssDatabase(
      trackingAdapter,
      "Data/rss-reader.sqlite3",
    );
    await primary.initialize();
    primary.close();
    await trackingAdapter.writeBinary(
      "Data/rss-reader.sqlite3.tmp",
      new TextEncoder().encode("stale temporary file").buffer,
    );
    trackingAdapter.trackCandidateReads = true;

    const loaded = new RssDatabase(
      trackingAdapter,
      "Data/rss-reader.sqlite3",
    );
    await loaded.initialize({ createIfMissing: false });

    expect(trackingAdapter.candidateReadBeforeRewrite).toBe(false);
    await expect(
      trackingAdapter.exists("Data/rss-reader.sqlite3.tmp"),
    ).resolves.toBe(false);
    loaded.close();
  });

  it("recovers an invalid primary from temporary before previous", async () => {
    const recoveryAdapter = new MemoryAdapter();
    await recoveryAdapter.mkdir("Data");
    const temporaryBytes = database.exportBytes();
    await repository.addFeed({
      name: "Previous only",
      url: "https://example.com/previous",
      enabled: true,
    });
    const previousBytes = database.exportBytes();
    await recoveryAdapter.writeBinary(
      "Data/rss-reader.sqlite3",
      new TextEncoder().encode("damaged").buffer,
    );
    await recoveryAdapter.writeBinary(
      "Data/rss-reader.sqlite3.tmp",
      temporaryBytes.slice().buffer,
    );
    await recoveryAdapter.writeBinary(
      "Data/rss-reader.sqlite3.previous",
      previousBytes.slice().buffer,
    );

    const result = await recoverDatabaseFile(
      recoveryAdapter,
      "Data/rss-reader.sqlite3",
    );

    expect(result.source).toBe("temporary");
    expect(result.recovered).toBe(true);
    await expect(
      inspectDatabaseFile(recoveryAdapter, "Data/rss-reader.sqlite3"),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      recoveryAdapter.exists("Data/rss-reader.sqlite3.previous"),
    ).resolves.toBe(false);
  });

  it("falls back to previous and preserves candidates when none are valid", async () => {
    const fallbackAdapter = new MemoryAdapter();
    await fallbackAdapter.mkdir("Data");
    const validBytes = database.exportBytes();
    await fallbackAdapter.writeBinary(
      "Data/rss-reader.sqlite3",
      new TextEncoder().encode("damaged primary").buffer,
    );
    await fallbackAdapter.writeBinary(
      "Data/rss-reader.sqlite3.tmp",
      new TextEncoder().encode("damaged temporary").buffer,
    );
    await fallbackAdapter.writeBinary(
      "Data/rss-reader.sqlite3.previous",
      validBytes.slice().buffer,
    );
    const recovered = await recoverDatabaseFile(
      fallbackAdapter,
      "Data/rss-reader.sqlite3",
    );
    expect(recovered.source).toBe("previous");

    const invalidAdapter = new MemoryAdapter();
    await invalidAdapter.mkdir("Data");
    for (const path of [
      "Data/rss-reader.sqlite3",
      "Data/rss-reader.sqlite3.tmp",
      "Data/rss-reader.sqlite3.previous",
    ]) {
      await invalidAdapter.writeBinary(
        path,
        new TextEncoder().encode(path).buffer,
      );
    }
    await expect(
      recoverDatabaseFile(invalidAdapter, "Data/rss-reader.sqlite3"),
    ).rejects.toThrow("backups");
    for (const path of [
      "Data/rss-reader.sqlite3",
      "Data/rss-reader.sqlite3.tmp",
      "Data/rss-reader.sqlite3.previous",
    ]) {
      await expect(invalidAdapter.exists(path)).resolves.toBe(true);
    }
  });

  it("restores the damaged primary and keeps candidates when recovery verification fails", async () => {
    const corruptingAdapter = new CorruptingCopyAdapter();
    await corruptingAdapter.mkdir("Data");
    const damaged = new TextEncoder().encode("damaged primary");
    await corruptingAdapter.writeBinary(
      "Data/rss-reader.sqlite3",
      damaged.buffer,
    );
    await corruptingAdapter.writeBinary(
      "Data/rss-reader.sqlite3.tmp",
      database.exportBytes().slice().buffer,
    );
    corruptingAdapter.corruptRecoveryCopy = true;

    await expect(
      recoverDatabaseFile(
        corruptingAdapter,
        "Data/rss-reader.sqlite3",
      ),
    ).rejects.toThrow();

    expect(
      new Uint8Array(
        await corruptingAdapter.readBinary(
          "Data/rss-reader.sqlite3",
        ),
      ),
    ).toEqual(damaged);
    await expect(
      corruptingAdapter.exists("Data/rss-reader.sqlite3.tmp"),
    ).resolves.toBe(true);
  });

  it("locks writes after memory and disk persistence diverge", async () => {
    const failingAdapter = new FailingWriteAdapter();
    const candidate = new RssDatabase(
      failingAdapter,
      "Data/rss-reader.sqlite3",
    );
    await candidate.initialize();
    failingAdapter.failWrites = true;

    await expect(
      candidate.write((db) => {
        db.run(
          "INSERT INTO feeds(name,url,enabled) VALUES ('Broken','https://example.com',1)",
        );
      }),
    ).rejects.toThrow("simulated write failure");
    expect(candidate.persistenceError?.message).toContain(
      "内存与磁盘状态可能不一致",
    );
    await expect(candidate.write(() => undefined)).rejects.toThrow(
      "已停止后续写入",
    );
    candidate.close();
  });

  it("repairs incompatible GUID duplicates without losing user state", async () => {
    const feedId = await repository.addFeed({
      name: "情报学报",
      url: "https://example.com/cnki",
      enabled: true,
    });
    await database.write((db) => {
      const canonicalGuid = stableGuid({
        title: "投稿须知",
        journal: "情报学报",
        year: "2026",
        authors: "",
        doi: "",
      });
      for (const [guid, status] of [
        [canonicalGuid, "hidden"],
        ["wrong-guid-2", "unread"],
      ] as Array<[string, string]>) {
        db.run(
          `
          INSERT INTO items(
            stable_guid,title,title_norm,journal,year,item_status
          ) VALUES ($guid,'投稿须知','投稿须知','情报学报-CNKI','2026',$status)
          `,
          { $guid: guid, $status: status },
        );
        const itemId = Number(
          db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0]?.[0],
        );
        db.run(
          "INSERT INTO item_feeds(item_id,feed_id) VALUES ($item,$feed)",
          { $item: itemId, $feed: feedId },
        );
      }
      db.run(
        `
        INSERT INTO translations(
          item_id,field,source_text,translated_text,target_language,
          provider,source_hash,status
        ) VALUES (
          (SELECT MAX(id) FROM items),'title','投稿须知','Submission guide',
          'en','google-web','hash','succeeded'
        )
        `,
      );
    });

    const repaired = await repository.repairLegacyItemIdentity();
    expect(repaired.removedItems).toBe(1);
    expect(repository.countItems({ status: "hidden" })).toBe(1);
    expect(
      database.get<{ translated_text: string }>(
        "SELECT translated_text FROM translations",
      )?.translated_text,
    ).toBe("Submission guide");
    expect(
      database.get<{ stable_guid: string }>(
        "SELECT stable_guid FROM items",
      )?.stable_guid,
    ).toMatch(/^cnki-local:/);
    expect(
      database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM item_feeds",
      )?.count,
    ).toBe(1);
    expect(database.query("PRAGMA foreign_key_check")).toHaveLength(0);
  });

  it("returns active translation states and stable item batches", async () => {
    const feedId = await repository.addFeed({
      name: "Batch journal",
      url: "https://example.com/batch",
      enabled: true,
    });
    const stored = await repository.upsertParsedItems(
      feedId,
      Array.from({ length: 205 }, (_, index) => ({
        stableGuid: `batch-guid-${index}`,
        title: `Batch paper ${index}`,
        titleNorm: `batch paper ${index}`,
        authors: "Author",
        journal: "Batch journal",
        year: "2026",
        doi: "",
        link: "",
        pubDate: new Date(
          Date.UTC(2026, 0, index + 1),
        ).toISOString(),
        summary: "",
      })),
    );
    await database.write((db) => {
      for (const [index, status] of [
        "pending",
        "translating",
        "failed",
      ].entries()) {
        db.run(
          `
          INSERT INTO translations(
            item_id,field,source_text,target_language,provider,
            source_hash,status,attempt_count
          ) VALUES (
            $itemId,'title',$sourceText,'zh-CN','google-web',
            $sourceHash,$status,0
          )
          `,
          {
            $itemId: stored.insertedIds[index]!,
            $sourceText: `Batch paper ${index}`,
            $sourceHash: `hash-${index}`,
            $status: status,
          },
        );
      }
    });

    const allItems = repository.listItems({
      status: "unread",
      limit: 500,
      targetLanguage: "zh-CN",
    });
    for (const [index, status] of [
      "pending",
      "translating",
      "failed",
    ].entries()) {
      expect(
        allItems.find(
          (item) => item.id === stored.insertedIds[index],
        )?.titleTranslationStatus,
      ).toBe(status);
    }

    const first = repository.listItems({
      status: "unread",
      limit: 100,
      offset: 0,
    });
    const second = repository.listItems({
      status: "unread",
      limit: 100,
      offset: 100,
    });
    const third = repository.listItems({
      status: "unread",
      limit: 100,
      offset: 200,
    });
    expect(first).toHaveLength(100);
    expect(second).toHaveLength(100);
    expect(third).toHaveLength(5);
    expect(
      new Set([...first, ...second, ...third].map((item) => item.id)).size,
    ).toBe(205);
  });
});

class TrackingAdapter extends MemoryAdapter {
  trackCandidateReads = false;
  candidateReadBeforeRewrite = false;
  private candidateRewritten = false;

  override async readBinary(path: string): Promise<ArrayBuffer> {
    if (
      this.trackCandidateReads &&
      path.endsWith(".tmp") &&
      !this.candidateRewritten
    ) {
      this.candidateReadBeforeRewrite = true;
    }
    return super.readBinary(path);
  }

  override async writeBinary(
    path: string,
    data: ArrayBuffer,
  ): Promise<void> {
    if (this.trackCandidateReads && path.endsWith(".tmp")) {
      this.candidateRewritten = true;
    }
    await super.writeBinary(path, data);
  }
}

class FailingWriteAdapter extends MemoryAdapter {
  failWrites = false;

  override async writeBinary(
    path: string,
    data: ArrayBuffer,
  ): Promise<void> {
    if (this.failWrites && path.endsWith(".tmp")) {
      throw new Error("simulated write failure");
    }
    await super.writeBinary(path, data);
  }
}

class CorruptingCopyAdapter extends MemoryAdapter {
  corruptRecoveryCopy = false;

  override async copy(path: string, newPath: string): Promise<void> {
    await super.copy(path, newPath);
    if (
      this.corruptRecoveryCopy &&
      newPath.endsWith("rss-reader.sqlite3")
    ) {
      await super.writeBinary(
        newPath,
        new TextEncoder().encode("corrupted during copy").buffer,
      );
    }
  }
}
