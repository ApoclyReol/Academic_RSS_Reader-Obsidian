import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RssDatabase,
  inspectDatabaseFile,
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
