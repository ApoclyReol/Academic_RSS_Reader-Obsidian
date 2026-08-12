import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

import {
  RssDatabase,
  inspectDatabaseFile,
  recoverDatabaseFile,
} from "../src/database/database";
import {
  CREATE_SCHEMA_SQL,
  SCHEMA_MIGRATIONS,
} from "../src/database/schema";
import { RssRepository } from "../src/repositories/rss-repository";
import {
  parseFeed,
  stableGuid,
} from "../src/services/rss-parser";
import { assertSqliteRuntimeCapabilities } from "../src/services/desktop-runtime";
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

  afterEach(() => {
    database.close();
    adapter.dispose();
  });

  it("applies ordered schema migrations for feeds and models", () => {
    const versions = database.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3, 4]);
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

  it("blocks hosts without DatabaseSync or the SQLite Backup API", () => {
    expect(() => assertSqliteRuntimeCapabilities({}, "22.15.0"))
      .toThrow(/22\.16|node:sqlite/i);
    expect(() => assertSqliteRuntimeCapabilities({ DatabaseSync: function DatabaseSync() {} } as never, "24.0.0"))
      .toThrow(/22\.16|node:sqlite/i);
  });

  it("upgrades a v3 database in place and preserves data state", async () => {
    const legacyAdapter = new MemoryAdapter();
    await createLegacyDatabase(legacyAdapter, "Legacy/rss-reader.sqlite3", 3);
    const legacyPath = legacyAdapter.getFullPath("Legacy/rss-reader.sqlite3");
    const legacy = new DatabaseSync(legacyPath);
    legacy.prepare(
      "INSERT INTO feeds(name,url,enabled) VALUES ('Legacy feed','https://example.com/legacy',1)",
    ).run();
    const feedId = Number(legacy.prepare("SELECT last_insert_rowid() AS id").get()?.id);
    legacy.prepare(
      `INSERT INTO items(
        stable_guid,title,title_norm,authors,journal,year,doi,link,item_status
      ) VALUES ('legacy-guid','Legacy paper','legacy paper','Alice','Old journal','2024','10.1000/legacy','https://example.com/legacy-paper','interested')`,
    ).run();
    const itemId = Number(legacy.prepare("SELECT last_insert_rowid() AS id").get()?.id);
    legacy.prepare(
      "INSERT INTO item_feeds(item_id,feed_id) VALUES ($itemId,$feedId)",
    ).run({ $itemId: itemId, $feedId: feedId });
    legacy.prepare(
      `INSERT INTO translations(
        item_id,field,source_text,translated_text,target_language,provider,
        source_hash,status,attempt_count
      ) VALUES ($itemId,'title','Legacy paper','旧文章','zh-CN','google-web','hash','succeeded',1)`,
    ).run({ $itemId: itemId });
    legacy.close();

    const migrated = new RssDatabase(
      legacyAdapter,
      "Legacy/rss-reader.sqlite3",
    );
    await migrated.initialize({ createIfMissing: false });
    const migratedRepository = new RssRepository(migrated);
    expect(migrated.query<{ version: number }>(
      "SELECT MAX(version) AS version FROM schema_migrations",
    )[0]?.version).toBe(4);
    expect(migratedRepository.getFeed(feedId)?.journalName).toBe("Legacy feed");
    expect(migratedRepository.getItem(itemId, "zh-CN")).toMatchObject({
      itemStatus: "interested",
      journal: "Legacy feed",
      translatedTitle: "旧文章",
    });
    expect(migrated.get<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key='legacy_identity_repair_v3'",
    )).toBeNull();
    expect(migrated.query("PRAGMA foreign_key_check")).toHaveLength(0);
    const backups = await legacyAdapter.list("Legacy/backups");
    expect(backups.files.some((path) => path.includes("before-schema4-"))).toBe(true);
    migrated.close();
    legacyAdapter.dispose();
  });

  it("reuses a v3 ScienceDirect item on the first update after migration", async () => {
    const legacyAdapter = new MemoryAdapter();
    await createLegacyDatabase(legacyAdapter, "Legacy/rss-reader.sqlite3", 3);
    const legacyPath = legacyAdapter.getFullPath("Legacy/rss-reader.sqlite3");
    const legacy = new DatabaseSync(legacyPath);
    legacy.prepare(
      "INSERT INTO feeds(name,url,enabled) VALUES ('Journal','https://rss.sciencedirect.com/publication/science/02684012',1)",
    ).run();
    const feedId = Number(
      legacy.prepare("SELECT last_insert_rowid() AS id").get()?.id,
    );
    const oldGuid = stableGuid({
      title: "Stable paper",
      journal: "Journal",
      year: "2026",
      authors: "Alice, Bob",
      doi: "",
    });
    legacy.prepare(
      `INSERT INTO items(
        stable_guid,title,title_norm,authors,journal,year,doi,link,item_status
      ) VALUES (
        $guid,'Stable paper','stablepaper','Alice, Bob','Journal','2026','',
        'https://www.sciencedirect.com/science/article/pii/S0268401226000587',
        'hidden'
      )`,
    ).run({ $guid: oldGuid });
    const oldItemId = Number(
      legacy.prepare("SELECT last_insert_rowid() AS id").get()?.id,
    );
    legacy.prepare(
      "INSERT INTO item_feeds(item_id,feed_id) VALUES ($itemId,$feedId)",
    ).run({ $itemId: oldItemId, $feedId: feedId });
    legacy.close();

    const migrated = new RssDatabase(
      legacyAdapter,
      "Legacy/rss-reader.sqlite3",
    );
    await migrated.initialize({ createIfMissing: false });
    const migratedRepository = new RssRepository(migrated);
    await migratedRepository.repairLegacyItemIdentity();
    const parsed = parseFeed(
      `<rss version="2.0"><channel><title>Journal</title><item>
        <title>Stable paper</title>
        <link>https://www.sciencedirect.com/science/article/pii/S0268401226000587?dgcid=rss_sd_all</link>
        <pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate>
      </item></channel></rss>`,
      "Journal",
      "Journal",
    );
    const result = await migratedRepository.upsertParsedItems(
      feedId,
      parsed.items,
    );

    expect(result).toMatchObject({
      insertedIds: [],
      duplicateHits: 1,
      newFeedLinks: 0,
    });
    expect(migratedRepository.countItems({ status: "hidden" })).toBe(1);
    expect(migratedRepository.getItem(oldItemId)).toMatchObject({
      id: oldItemId,
      stableGuid: oldGuid,
      authors: "Alice, Bob",
      itemStatus: "hidden",
      link:
        "https://www.sciencedirect.com/science/article/pii/S0268401226000587",
    });
    expect(migrated.query("PRAGMA foreign_key_check")).toHaveLength(0);
    migrated.close();
    legacyAdapter.dispose();
  });

  it("does not merge generic titles with different ScienceDirect PIIs", async () => {
    const feedId = await repository.addFeed({
      name: "Journal",
      url: "https://rss.sciencedirect.com/publication/science/02684012",
      enabled: true,
    });
    const first = parseFeed(
      `<rss version="2.0"><channel><title>Journal</title><item>
        <title>Editorial Board</title>
        <link>https://www.sciencedirect.com/science/article/pii/S0268401226000514?dgcid=rss_sd_all</link>
        <pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate>
      </item></channel></rss>`,
      "Journal",
    ).items[0]!;
    const second = parseFeed(
      `<rss version="2.0"><channel><title>Journal</title><item>
        <title>Editorial Board</title>
        <link>https://www.sciencedirect.com/science/article/pii/S0268401226000733?dgcid=rss_sd_all</link>
        <pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate>
      </item></channel></rss>`,
      "Journal",
    ).items[0]!;

    expect(first.stableGuid).not.toBe(second.stableGuid);
    const result = await repository.upsertParsedItems(feedId, [first, second]);
    expect(result.insertedIds).toHaveLength(2);
    expect(repository.countItems({ status: "unread" })).toBe(2);
  });

  it("rolls back a failed migration to the original v2 file", async () => {
    const rollbackAdapter = new MemoryAdapter();
    await createLegacyDatabase(rollbackAdapter, "Rollback/rss-reader.sqlite3", 2);
    const legacyPath = rollbackAdapter.getFullPath("Rollback/rss-reader.sqlite3");
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec("ALTER TABLE recommendation_keywords ADD COLUMN idf REAL NOT NULL DEFAULT 1");
    legacy.exec("PRAGMA user_version=2");
    legacy.close();

    const candidate = new RssDatabase(
      rollbackAdapter,
      "Rollback/rss-reader.sqlite3",
    );
    await expect(candidate.initialize({ createIfMissing: false })).rejects.toThrow(
      /idf|duplicate|already exists/i,
    );
    const restored = new DatabaseSync(legacyPath, { readOnly: true });
    expect(Number(restored.prepare(
      "SELECT MAX(version) AS version FROM schema_migrations",
    ).get()?.version)).toBe(2);
    expect(
      (restored.prepare("PRAGMA table_info(feeds)").all() as Array<{ name: string }>)
        .some((column) => column.name === "journal_name"),
    ).toBe(false);
    restored.close();
    const backups = await rollbackAdapter.list("Rollback/backups");
    expect(backups.files.some((path) => path.includes("before-schema4-"))).toBe(true);
    candidate.close();
    rollbackAdapter.dispose();
  });

  it("shows article journal first and deduplicates all feed defaults", async () => {
    const firstFeed = await repository.addFeed({
      name: "Subscription A",
      journalName: "Journal A",
      url: "https://example.com/a",
      enabled: true,
    });
    const secondFeed = await repository.addFeed({
      name: "Subscription B",
      journalName: "Journal B",
      url: "https://example.com/b",
      enabled: true,
    });
    await repository.upsertParsedItems(firstFeed, [{
      stableGuid: "article-journal-guid",
      title: "Article journal paper",
      titleNorm: "article journal paper",
      authors: "Alice",
      journal: "Article Journal",
      articleJournal: "Article Journal",
      year: "2026",
      doi: "",
      link: "https://example.com/paper",
      pubDate: "",
      summary: "",
    }]);
    await repository.upsertParsedItems(secondFeed, [{
      stableGuid: "article-journal-guid",
      title: "Article journal paper",
      titleNorm: "article journal paper",
      authors: "Alice",
      journal: "Article Journal",
      articleJournal: "Article Journal",
      year: "2026",
      doi: "",
      link: "https://example.com/paper",
      pubDate: "",
      summary: "",
    }]);
    const itemId = repository.listItems({ status: "unread" })[0]?.id;
    expect(itemId).toBeDefined();
    expect(repository.getItem(itemId!, "zh-CN")?.journal).toBe(
      "Article Journal / Journal A / Journal B",
    );

    await repository.updateFeed(firstFeed, {
      name: "Subscription A renamed",
      journalName: "Journal Renamed",
      url: "https://example.com/a",
      enabled: true,
    });
    expect(repository.getItem(itemId!, "zh-CN")?.journal).toBe(
      "Article Journal / Journal B / Journal Renamed",
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

  it("rejects backup paths outside the Vault-relative data directory", async () => {
    await expect(database.backup("../outside.sqlite3")).rejects.toThrow(
      /当前 Vault|Vault/i,
    );
    await expect(database.backup("/tmp/outside.sqlite3")).rejects.toThrow(
      /相对目录|Vault/i,
    );
  });

  it("writes, queries, reopens and fully validates 50,000 articles", async () => {
    const feedId = await repository.addFeed({
      name: "Performance feed",
      url: "https://example.com/performance",
      enabled: true,
    });
    const startedAt = performance.now();
    await database.write((db) => {
      const itemStatement = db.prepare(`
        INSERT INTO items(
          stable_guid,title,title_norm,authors,article_journal,year,doi,link,
          pub_date,summary
        ) VALUES (
          $guid,$title,$titleNorm,'Author','Performance journal','2026','',
          $link,'2026-01-01T00:00:00.000Z','Abstract'
        )
      `);
      const feedStatement = db.prepare(
        "INSERT INTO item_feeds(item_id,feed_id) VALUES ($itemId,$feedId)",
      );
      try {
        for (let index = 0; index < 50_000; index += 1) {
          itemStatement.run({
            $guid: `performance-guid-${index}`,
            $title: `Performance paper ${index}`,
            $titleNorm: `performance paper ${index}`,
            $link: `https://example.com/performance/${index}`,
          });
          const itemId = Number(
            db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0]?.[0],
          );
          feedStatement.run({ $itemId: itemId, $feedId: feedId });
        }
      } finally {
        itemStatement.free();
        feedStatement.free();
      }
    });
    const elapsed = performance.now() - startedAt;
    expect(database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM items",
    )?.count).toBe(50_000);
    expect(database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM item_feeds",
    )?.count).toBe(50_000);
    expect(database.get<{ id: number }>(
      "SELECT id FROM items WHERE title_norm=$titleNorm",
      { $titleNorm: "performance paper 49999" },
    )?.id).toBe(50_000);
    expect(elapsed).toBeLessThan(30_000);

    database.close();
    const reopened = new RssDatabase(adapter, "Data/test.sqlite3");
    await reopened.initialize({ createIfMissing: false });
    database = reopened;
    repository = new RssRepository(reopened);
    expect(await inspectDatabaseFile(adapter, database.path)).toMatchObject({
      valid: true,
      error: null,
    });
    expect(repository.countItems()).toBe(50_000);
  }, 45_000);

  it("reopens cleanly after a WAL-backed write", async () => {
    const feedId = await repository.addFeed({
      name: "WAL feed",
      url: "https://example.com/wal",
      enabled: true,
    });
    database.raw.native.exec("PRAGMA wal_autocheckpoint=1000000");
    await repository.upsertParsedItems(feedId, [{
      stableGuid: "wal-guid",
      title: "WAL paper",
      titleNorm: "wal paper",
      authors: "Author",
      journal: "WAL journal",
      year: "2026",
      doi: "",
      link: "https://example.com/wal-paper",
      pubDate: "2026-01-01T00:00:00.000Z",
      summary: "Abstract",
    }]);
    const nativePath = adapter.getFullPath(database.path);
    expect(existsSync(`${nativePath}-wal`) || existsSync(`${nativePath}-shm`)).toBe(true);

    database.close();
    const reopened = new RssDatabase(adapter, "Data/test.sqlite3");
    await reopened.initialize({ createIfMissing: false });
    database = reopened;
    repository = new RssRepository(reopened);
    expect(repository.listItems({ status: "unread" })[0]?.title).toBe(
      "WAL paper",
    );
    expect(await inspectDatabaseFile(adapter, database.path)).toMatchObject({
      valid: true,
      error: null,
    });
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
    expect(await inspectDatabaseFile(adapter, database.path)).toMatchObject({
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
    ).resolves.toBe(true);
    loaded.close();
  });

  it("recovers an invalid primary from temporary before previous", async () => {
    const recoveryAdapter = new MemoryAdapter();
    await recoveryAdapter.mkdir("Data");
    const temporaryBytes = databaseFileBytes(database, adapter);
    await repository.addFeed({
      name: "Previous only",
      url: "https://example.com/previous",
      enabled: true,
    });
    const previousBytes = databaseFileBytes(database, adapter);
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
    const validBytes = databaseFileBytes(database, adapter);
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
      databaseFileBytes(database, adapter).slice().buffer,
    );
    corruptingAdapter.corruptRecoveryCopy = true;

    await expect(
      recoverDatabaseFile(corruptingAdapter, "Data/rss-reader.sqlite3"),
    ).resolves.toMatchObject({ recovered: true });
  });

  it("rolls back the whole native transaction when an operation fails", async () => {
    await expect(
      database.write((db) => {
        db.run(
          "INSERT INTO feeds(name,journal_name,url,enabled) VALUES ('Broken','Broken','https://example.com/broken',1)",
        );
        throw new Error("operation failed");
      }),
    ).rejects.toThrow("operation failed");
    expect(repository.listFeeds()).toHaveLength(0);
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
            stable_guid,title,title_norm,article_journal,year,item_status
            ) VALUES ($guid,'投稿须知','投稿须知',NULL,'2026',$status)
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

async function createLegacyDatabase(
  adapter: MemoryAdapter,
  path: string,
  version: 2 | 3,
): Promise<void> {
  const directory = path.split("/").slice(0, -1).join("/");
  await adapter.mkdir(directory);
  const database = new DatabaseSync(adapter.getFullPath(path));
  database.exec(CREATE_SCHEMA_SQL);
  for (const migration of SCHEMA_MIGRATIONS.slice(0, version - 1)) {
    database.exec("BEGIN IMMEDIATE");
    for (const statement of migration.statements) {
      database.exec(statement);
    }
    database.prepare(
      "INSERT INTO schema_migrations(version) VALUES ($version)",
    ).run({ $version: migration.version });
    database.exec("COMMIT");
  }
  database.exec(`PRAGMA user_version=${version}`);
  database.close();
}

function databaseFileBytes(
  database: RssDatabase,
  adapter: MemoryAdapter,
): Uint8Array {
  database.raw.native.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  return new Uint8Array(readFileSync(adapter.getFullPath(database.path)));
}
