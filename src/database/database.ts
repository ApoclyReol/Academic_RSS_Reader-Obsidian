import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  BindParams,
  Database,
  SqlJsStatic,
} from "sql.js";
import initSqlJs from "sql.js/dist/sql-asm.js";

import { CREATE_SCHEMA_SQL } from "./schema";

export class RssDatabase {
  private sql: SqlJsStatic | null = null;
  private database: Database | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly databasePath: string,
  ) {}

  async initialize(options: { createIfMissing?: boolean } = {}): Promise<void> {
    await mkdir(dirname(this.databasePath), { recursive: true });
    this.sql = await initSqlJs();

    try {
      const bytes = await readFile(this.databasePath);
      this.database = new this.sql.Database(bytes);
    } catch (error) {
      if (!this.isMissingFile(error)) {
        throw error;
      }
      if (options.createIfMissing === false) {
        throw new Error("所选目录中没有 rss-reader.sqlite3");
      }
      this.database = new this.sql.Database();
    }

    this.database.run(CREATE_SCHEMA_SQL);
    this.database.run(
      "UPDATE translations SET status='pending' WHERE status='translating'",
    );
    await this.persist();
  }

  close(): void {
    this.database?.close();
    this.database = null;
  }

  get raw(): Database {
    if (!this.database) {
      throw new Error("数据库尚未初始化");
    }
    return this.database;
  }

  query<T>(sql: string, params: Record<string, unknown> = {}): T[] {
    const statement = this.raw.prepare(sql);
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

  get<T>(sql: string, params: Record<string, unknown> = {}): T | null {
    return this.query<T>(sql, params)[0] ?? null;
  }

  async write<T>(operation: (database: Database) => T): Promise<T> {
    let result!: T;
    const task = this.writeChain.then(async () => {
      this.raw.run("BEGIN IMMEDIATE");
      try {
        result = operation(this.raw);
        this.raw.run("COMMIT");
        await this.persist();
      } catch (error) {
        this.raw.run("ROLLBACK");
        throw error;
      }
    });
    this.writeChain = task.then(
      () => undefined,
      () => undefined,
    );
    await task;
    return result;
  }

  async backup(destinationPath: string): Promise<void> {
    await this.writeChain;
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(this.databasePath, destinationPath);
  }

  async restoreFromFile(sourcePath: string): Promise<void> {
    const bytes = await readFile(sourcePath);
    await this.replaceFromBytes(bytes);
  }

  async replaceFromBytes(bytes: Uint8Array): Promise<void> {
    await this.writeChain;
    const sql = this.sql ?? (await this.loadSql());
    const next = new sql.Database(bytes);
    next.run(CREATE_SCHEMA_SQL);
    this.database?.close();
    this.database = next;
    await this.persist();
  }

  exportBytes(): Uint8Array {
    return this.raw.export();
  }

  get path(): string {
    return this.databasePath;
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.databasePath}.tmp`;
    await writeFile(temporaryPath, this.raw.export());
    try {
      await rename(temporaryPath, this.databasePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private async loadSql(): Promise<SqlJsStatic> {
    this.sql = await initSqlJs();
    return this.sql;
  }

  private isMissingFile(error: unknown): boolean {
    return (
      error instanceof Error &&
      "code" in error &&
      (error as Error & { code?: unknown }).code === "ENOENT"
    );
  }
}

export function databasePaths(
  dataDirectory: string,
): {
  databasePath: string;
  backupDirectory: string;
} {
  return {
    databasePath: join(dataDirectory, "rss-reader.sqlite3"),
    backupDirectory: join(dataDirectory, "backups"),
  };
}

export interface DatabaseInspection {
  exists: boolean;
  valid: boolean;
  error: string | null;
}

export async function inspectDatabaseFile(
  databasePath: string,
): Promise<DatabaseInspection> {
  try {
    await access(databasePath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as Error & { code?: unknown }).code === "ENOENT"
    ) {
      return { exists: false, valid: false, error: null };
    }
    return {
      exists: false,
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let database: Database | null = null;
  try {
    const sql = await initSqlJs();
    database = new sql.Database(await readFile(databasePath));
    const integrity = database.exec("PRAGMA integrity_check");
    const result = integrity[0]?.values[0]?.[0];
    if (result !== "ok") {
      throw new Error(`SQLite 完整性检查失败：${String(result ?? "未知错误")}`);
    }
    const requiredTables = ["feeds", "items", "item_feeds"];
    const tables = new Set(
      database
        .exec("SELECT name FROM sqlite_master WHERE type='table'")[0]
        ?.values.map((row) => String(row[0])) ?? [],
    );
    const missing = requiredTables.filter((table) => !tables.has(table));
    if (missing.length > 0) {
      throw new Error(`数据库缺少核心表：${missing.join("、")}`);
    }
    return { exists: true, valid: true, error: null };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    database?.close();
  }
}
