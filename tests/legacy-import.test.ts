import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import initSqlJs from "sql.js/dist/sql-asm.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RssDatabase } from "../src/database/database";
import { CREATE_SCHEMA_SQL } from "../src/database/schema";
import { RssRepository } from "../src/repositories/rss-repository";
import { LegacyImportService } from "../src/services/legacy-import-service";

describe("legacy database import", () => {
  let database: RssDatabase;
  let repository: RssRepository;
  let service: LegacyImportService;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "rss-import-test-"));
    database = new RssDatabase(join(directory, "target.sqlite3"));
    await database.initialize();
    repository = new RssRepository(database);
    service = new LegacyImportService(
      database,
      join(directory, "backups"),
    );
  });

  afterEach(() => database.close());

  it("previews, imports and preserves legacy relations", async () => {
    const sql = await initSqlJs();
    const source = new sql.Database();
    source.run(CREATE_SCHEMA_SQL);
    source.run(
      "INSERT INTO feeds(id,name,url,enabled) VALUES (1,'Journal','https://example.com/rss',1)",
    );
    source.run(`
      INSERT INTO items(
        id,stable_guid,title,title_norm,authors,journal,year,doi,link,pub_date,summary,item_status
      ) VALUES (
        1,'legacy-guid','Legacy paper','legacy paper','Alice','Journal','2024','','','','Summary','interested'
      )
    `);
    source.run("INSERT INTO item_feeds(item_id,feed_id) VALUES (1,1)");
    const bytes = source.export();
    source.close();

    const preview = await service.preview(bytes);
    expect(preview.valid).toBe(true);
    expect(preview.counts).toMatchObject({
      feeds: 1,
      items: 1,
      item_feeds: 1,
    });

    const report = await service.import(bytes, "legacy.sqlite3");
    expect(report.imported.items).toBe(1);
    expect(repository.countByStatus().interested).toBe(1);
    expect(repository.listFeeds()).toHaveLength(1);
  });
});
