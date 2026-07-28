import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  BindParams,
  Database,
  SqlValue,
} from "sql.js";
import initSqlJs from "sql.js/dist/sql-asm.js";

import { RssDatabase } from "../database/database";

const REQUIRED_TABLES = [
  "feeds",
  "items",
  "item_feeds",
  "recommendation_scores",
  "recommendation_keywords",
  "recommendation_models",
] as const;

type RequiredTable = (typeof REQUIRED_TABLES)[number];

export interface LegacyPreview {
  valid: boolean;
  missingTables: string[];
  counts: Record<RequiredTable, number>;
  sourceBytes: number;
}

export interface LegacyImportReport {
  importedAt: string;
  sourceFile: string;
  sourceCounts: Record<RequiredTable, number>;
  imported: Record<RequiredTable, number>;
  skipped: Record<RequiredTable, number>;
  conflicts: string[];
  sourceBackup: string;
  targetBackup: string;
}

type Row = Record<string, SqlValue>;

export class LegacyImportService {
  constructor(
    private readonly database: RssDatabase,
    private readonly backupDirectory: string,
  ) {}

  async preview(bytes: Uint8Array): Promise<LegacyPreview> {
    const source = await this.openSource(bytes);
    try {
      const tables = new Set(
        query<Row>(
          source,
          "SELECT name FROM sqlite_master WHERE type='table'",
        ).map((row) => String(row.name)),
      );
      const missingTables = REQUIRED_TABLES.filter(
        (table) => !tables.has(table),
      );
      const counts = emptyCounts();
      for (const table of REQUIRED_TABLES) {
        if (tables.has(table)) {
          counts[table] = Number(
            query<Row>(source, `SELECT COUNT(*) AS count FROM ${table}`)[0]
              ?.count ?? 0,
          );
        }
      }
      return {
        valid: missingTables.length === 0,
        missingTables,
        counts,
        sourceBytes: bytes.byteLength,
      };
    } finally {
      source.close();
    }
  }

  async import(
    bytes: Uint8Array,
    sourceFileName: string,
  ): Promise<LegacyImportReport> {
    const preview = await this.preview(bytes);
    if (!preview.valid) {
      throw new Error(`旧数据库缺少表：${preview.missingTables.join("、")}`);
    }
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    await mkdir(this.backupDirectory, { recursive: true });
    const sourceBackup = join(
      this.backupDirectory,
      `legacy-${timestamp}.sqlite3`,
    );
    const targetBackup = join(
      this.backupDirectory,
      `before-import-${timestamp}.sqlite3`,
    );
    await writeFile(sourceBackup, bytes);
    await this.database.backup(targetBackup);

    const source = await this.openSource(bytes);
    const imported = emptyCounts();
    const skipped = emptyCounts();
    const conflicts: string[] = [];
    try {
      await this.database.write((target) => {
        const feedMap = new Map<number, number>();
        const itemMap = new Map<number, number>();

        for (const row of query<Row>(source, "SELECT * FROM feeds ORDER BY id")) {
          const oldId = Number(row.id);
          const existing = singleValue(
            target,
            "SELECT id FROM feeds WHERE url=$url",
            { $url: row.url },
          );
          if (existing !== null) {
            feedMap.set(oldId, Number(existing));
            skipped.feeds += 1;
            continue;
          }
          target.run(
            `
            INSERT INTO feeds(
              name,url,enabled,created_at,updated_at,last_checked_at,last_error
            ) VALUES ($name,$url,$enabled,$created,$updated,$checked,$error)
            `,
            sqlParams({
              $name: row.name,
              $url: row.url,
              $enabled: row.enabled,
              $created: row.created_at,
              $updated: row.updated_at,
              $checked: row.last_checked_at,
              $error: row.last_error,
            }),
          );
          feedMap.set(oldId, Number(singleValue(target, "SELECT last_insert_rowid()")));
          imported.feeds += 1;
        }

        for (const row of query<Row>(source, "SELECT * FROM items ORDER BY id")) {
          const oldId = Number(row.id);
          const existing = singleValue(
            target,
            "SELECT id FROM items WHERE stable_guid=$guid",
            { $guid: row.stable_guid },
          );
          if (existing !== null) {
            itemMap.set(oldId, Number(existing));
            skipped.items += 1;
            continue;
          }
          target.run(
            `
            INSERT INTO items(
              stable_guid,title,title_norm,authors,journal,year,doi,link,pub_date,
              summary,first_seen_at,last_seen_at,item_status
            ) VALUES (
              $guid,$title,$titleNorm,$authors,$journal,$year,$doi,$link,$pubDate,
              $summary,$firstSeen,$lastSeen,$status
            )
            `,
            sqlParams({
              $guid: row.stable_guid,
              $title: row.title,
              $titleNorm: row.title_norm,
              $authors: row.authors,
              $journal: row.journal,
              $year: row.year,
              $doi: row.doi,
              $link: row.link,
              $pubDate: row.pub_date,
              $summary: row.summary,
              $firstSeen: row.first_seen_at,
              $lastSeen: row.last_seen_at,
              $status: row.item_status,
            }),
          );
          itemMap.set(oldId, Number(singleValue(target, "SELECT last_insert_rowid()")));
          imported.items += 1;
        }

        for (const row of query<Row>(
          source,
          "SELECT * FROM item_feeds ORDER BY item_id,feed_id",
        )) {
          const itemId = itemMap.get(Number(row.item_id));
          const feedId = feedMap.get(Number(row.feed_id));
          if (!itemId || !feedId) {
            conflicts.push(
              `item_feeds(${String(row.item_id)},${String(row.feed_id)}) 缺少映射`,
            );
            continue;
          }
          const existing = singleValue(
            target,
            "SELECT 1 FROM item_feeds WHERE item_id=$item AND feed_id=$feed",
            { $item: itemId, $feed: feedId },
          );
          if (existing !== null) {
            skipped.item_feeds += 1;
            continue;
          }
          target.run(
            `
            INSERT INTO item_feeds(item_id,feed_id,first_seen_at,last_seen_at)
            VALUES ($item,$feed,$firstSeen,$lastSeen)
            `,
            sqlParams({
              $item: itemId,
              $feed: feedId,
              $firstSeen: row.first_seen_at,
              $lastSeen: row.last_seen_at,
            }),
          );
          imported.item_feeds += 1;
        }

        for (const row of query<Row>(
          source,
          "SELECT * FROM recommendation_models ORDER BY created_at",
        )) {
          const exists = singleValue(
            target,
            "SELECT 1 FROM recommendation_models WHERE model_version=$version",
            { $version: row.model_version },
          );
          if (exists !== null) {
            skipped.recommendation_models += 1;
            continue;
          }
          target.run(
            `
            INSERT INTO recommendation_models(
              model_version,positive_count,negative_count,unread_count,created_at,error_message
            ) VALUES ($version,$positive,$negative,$unread,$created,$error)
            `,
            sqlParams({
              $version: row.model_version,
              $positive: row.positive_count,
              $negative: row.negative_count,
              $unread: row.unread_count,
              $created: row.created_at,
              $error: row.error_message,
            }),
          );
          imported.recommendation_models += 1;
        }

        for (const row of query<Row>(
          source,
          "SELECT * FROM recommendation_keywords",
        )) {
          const exists = singleValue(
            target,
            "SELECT 1 FROM recommendation_keywords WHERE keyword=$keyword",
            { $keyword: row.keyword },
          );
          target.run(
            `
            INSERT INTO recommendation_keywords(
              keyword,auto_weight,positive_count,negative_count,manual_direction,
              manual_weight,is_disabled,model_version,updated_at
            ) VALUES (
              $keyword,$auto,$positive,$negative,$direction,$manual,$disabled,$version,$updated
            )
            ON CONFLICT(keyword) DO UPDATE SET
              manual_direction=COALESCE(
                recommendation_keywords.manual_direction,excluded.manual_direction
              ),
              manual_weight=COALESCE(
                recommendation_keywords.manual_weight,excluded.manual_weight
              ),
              is_disabled=MAX(
                recommendation_keywords.is_disabled,excluded.is_disabled
              )
            `,
            sqlParams({
              $keyword: row.keyword,
              $auto: row.auto_weight,
              $positive: row.positive_count,
              $negative: row.negative_count,
              $direction: row.manual_direction,
              $manual: row.manual_weight,
              $disabled: row.is_disabled,
              $version: row.model_version,
              $updated: row.updated_at,
            }),
          );
          if (exists === null) {
            imported.recommendation_keywords += 1;
          } else {
            skipped.recommendation_keywords += 1;
          }
        }

        for (const row of query<Row>(
          source,
          "SELECT * FROM recommendation_scores",
        )) {
          const itemId = itemMap.get(Number(row.item_id));
          if (!itemId) {
            conflicts.push(
              `recommendation_scores(${String(row.item_id)}) 缺少条目映射`,
            );
            continue;
          }
          const exists = singleValue(
            target,
            "SELECT 1 FROM recommendation_scores WHERE item_id=$item",
            { $item: itemId },
          );
          if (exists !== null) {
            skipped.recommendation_scores += 1;
            continue;
          }
          target.run(
            `
            INSERT INTO recommendation_scores(
              item_id,keyword_score,keyword_tier,final_tier,llm_tier,llm_error,
              matched_keywords,model_version,content_hash,scored_at,llm_reviewed_at
            ) VALUES (
              $item,$score,$keywordTier,$finalTier,$llmTier,$llmError,
              $matched,$version,$hash,$scored,$reviewed
            )
            `,
            sqlParams({
              $item: itemId,
              $score: row.keyword_score,
              $keywordTier: row.keyword_tier,
              $finalTier: row.final_tier,
              $llmTier: row.llm_tier,
              $llmError: row.llm_error,
              $matched: row.matched_keywords,
              $version: row.model_version,
              $hash: row.content_hash,
              $scored: row.scored_at,
              $reviewed: row.llm_reviewed_at,
            }),
          );
          imported.recommendation_scores += 1;
        }
      });
    } catch (error) {
      throw new Error(
        `导入失败，插件数据库已回滚。恢复点：${targetBackup}。${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      source.close();
    }

    const report: LegacyImportReport = {
      importedAt: new Date().toISOString(),
      sourceFile: sourceFileName,
      sourceCounts: preview.counts,
      imported,
      skipped,
      conflicts,
      sourceBackup,
      targetBackup,
    };
    await writeFile(
      join(this.backupDirectory, `migration-report-${timestamp}.json`),
      JSON.stringify(report, null, 2),
      "utf8",
    );
    return report;
  }

  private async openSource(bytes: Uint8Array): Promise<Database> {
    const sql = await initSqlJs();
    return new sql.Database(bytes);
  }
}

function emptyCounts(): Record<RequiredTable, number> {
  return {
    feeds: 0,
    items: 0,
    item_feeds: 0,
    recommendation_scores: 0,
    recommendation_keywords: 0,
    recommendation_models: 0,
  };
}

function query<T>(
  database: Database,
  sql: string,
  params: Record<string, unknown> = {},
): T[] {
  const statement = database.prepare(sql);
  try {
    statement.bind(params as BindParams);
    const rows: T[] = [];
    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }
    return rows;
  } finally {
    statement.free();
  }
}

function singleValue(
  database: Database,
  sql: string,
  params: Record<string, unknown> = {},
): unknown {
  const statement = database.prepare(sql);
  try {
    statement.bind(params as BindParams);
    return statement.step() ? (statement.get()[0] ?? null) : null;
  } finally {
    statement.free();
  }
}

function sqlParams(values: Record<string, unknown>): BindParams {
  return values as BindParams;
}
