import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RssDatabase } from "../src/database/database";
import { ITEM_STATUSES, type TranslationRecord } from "../src/models/domain";
import { normalizeText } from "../src/models/item-identity";
import { RssRepository } from "../src/repositories/rss-repository";
import { MemoryAdapter } from "./helpers/memory-adapter";

describe("historical title and translation maintenance", () => {
  let adapter: MemoryAdapter;
  let database: RssDatabase;
  let repository: RssRepository;

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

  async function seed(): Promise<number[]> {
    const feedId = await repository.addFeed({ name: "Journal", url: "https://example.com/rss", enabled: true });
    const { insertedIds } = await repository.upsertParsedItems(feedId, ITEM_STATUSES.map((status, index) => ({
      stableGuid: `old-guid-${index}`, title: `Paper ${index}`, titleNorm: normalizeText(`Paper ${index}`),
      journal: "Journal", year: "2026", authors: "Alice", doi: "", link: "", pubDate: "", summary: "Abstract",
    })));
    await database.write((db) => {
      for (const [index, status] of ITEM_STATUSES.entries()) {
        const title = `<strong>Paper</strong> ${index}&#x20;`;
        db.run("UPDATE items SET title=$title,title_norm=$norm,item_status=$status WHERE id=$id", {
          $title: title, $norm: normalizeText(title), $status: status, $id: insertedIds[index]!,
        });
        db.run(`INSERT INTO translations(item_id,field,target_language,source_text,source_hash,
          source_normalized,translated_text,provider,status,translated_at)
          VALUES ($id,'title','zh-CN',$source,'original-hash',$source,'<b>译文</b>&#x20;标题','google-web','succeeded',123)`, {
          $id: insertedIds[index]!, $source: title,
        });
      }
    });
    return insertedIds;
  }

  it("backs up before cleaning, preserves all decisions and source snapshots, and runs once", async () => {
    const ids = await seed();
    await repository.repairTitleMarkup();
    const backups = (await adapter.list("Data/backups")).files.filter((path) => path.endsWith(".sqlite3"));
    expect(backups).toHaveLength(1);
    const snapshot = new DatabaseSync(adapter.getFullPath(backups[0]!), { readOnly: true });
    try {
      expect(snapshot.prepare("SELECT title FROM items WHERE id=?").get(ids[0]!)?.title)
        .toBe("<strong>Paper</strong> 0&#x20;");
      expect(snapshot.prepare("SELECT translated_text FROM translations WHERE item_id=?").get(ids[0]!)?.translated_text)
        .toBe("<b>译文</b>&#x20;标题");
    } finally { snapshot.close(); }
    for (const [index, status] of ITEM_STATUSES.entries()) {
      expect(repository.getItem(ids[index]!, "zh-CN")).toMatchObject({
        id: ids[index], stableGuid: `old-guid-${index}`, title: `Paper ${index}`,
        titleNorm: normalizeText(`Paper ${index}`), itemStatus: status, translatedTitle: "译文 标题",
      });
      expect(repository.getTranslation(ids[index]!, "title", "zh-CN")).toMatchObject({
        sourceText: `<strong>Paper</strong> ${index}&#x20;`, sourceHash: "original-hash", translatedAt: 123,
      });
    }
    await repository.repairTitleMarkup();
    expect((await adapter.list("Data/backups")).files.filter((path) => path.endsWith(".sqlite3"))).toEqual(backups);
    const result = await repository.upsertParsedItems(1, [{
      stableGuid: "new-clean-guid", title: "Paper 0", titleNorm: normalizeText("Paper 0"),
      journal: "Journal", year: "2026", authors: "Alice", doi: "", link: "", pubDate: "", summary: "Abstract",
    }]);
    expect(result.insertedIds).toEqual([]);
    expect(repository.getItem(ids[0]!)?.stableGuid).toBe("old-guid-0");
  });

  it("does not change data if the protection backup fails", async () => {
    const [id] = await seed();
    vi.spyOn(database, "backup").mockRejectedValueOnce(new Error("backup failed"));
    await expect(repository.repairTitleMarkup()).rejects.toThrow("backup failed");
    expect(repository.getItem(id!)?.title).toContain("<strong>");
    expect(repository.getMetadata("title_markup_repair_v1")).toBeNull();
  });

  it("rolls back the whole cleanup if a translation update fails", async () => {
    const [id] = await seed();
    await database.write((db) => {
      db.run("CREATE TRIGGER fail_cleanup BEFORE UPDATE ON translations BEGIN SELECT RAISE(ABORT,'cleanup failed'); END");
    });
    await expect(repository.repairTitleMarkup()).rejects.toThrow("cleanup failed");
    expect(repository.getItem(id!)?.title).toContain("<strong>");
    expect(repository.getMetadata("title_markup_repair_v1")).toBeNull();
    expect((await adapter.list("Data/backups")).files.filter((path) => path.endsWith(".sqlite3"))).toHaveLength(1);
  });

  it("excludes stale cached translations from cards and search, and rejects late responses", async () => {
    const [id] = await seed();
    await repository.repairTitleMarkup();
    const old = repository.getTranslation(id!, "title", "zh-CN")!;
    await database.write((db) => { db.run("UPDATE items SET title='Changed paper',summary='Changed abstract' WHERE id=$id", { $id: id! }); });
    const abstract: TranslationRecord = {
      ...old, field: "abstract", sourceText: "Abstract", sourceHash: "abstract-hash", translatedText: "旧摘要译文",
    };
    await repository.upsertTranslationTask(abstract);
    expect(repository.getItem(id!, "zh-CN")).toMatchObject({ translatedTitle: null, translatedAbstract: null, titleTranslationStatus: null });
    for (const query of ["译文 标题", "旧摘要译文"]) {
      expect(repository.listItems({ status: "unread", query, targetLanguage: "zh-CN" })).toEqual([]);
      expect(repository.countItems({ status: "unread", query, targetLanguage: "zh-CN" })).toBe(0);
    }
    await repository.upsertTranslationTask({ ...old, sourceText: "Changed paper", sourceHash: "new-hash", status: "pending" });
    await repository.updateTranslation({ ...old, translatedText: "Late old result", status: "succeeded" });
    expect(repository.getTranslation(id!, "title", "zh-CN")).toMatchObject({ sourceHash: "new-hash", status: "pending", translatedText: null });
  });
});
