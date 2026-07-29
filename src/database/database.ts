import type { DataAdapter } from "obsidian";
import type {
  BindParams,
  Database,
  SqlJsStatic,
} from "sql.js";
import initSqlJs from "sql.js/dist/sql-asm.js";

import type { DatabaseOperationCoordinator } from "../services/database-operation-coordinator";
import { CREATE_SCHEMA_SQL } from "./schema";

export class RssDatabase {
  private sql: SqlJsStatic | null = null;
  private database: Database | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly adapter: DataAdapter,
    private readonly databasePath: string,
    private operationCoordinator?: DatabaseOperationCoordinator,
  ) {}

  setOperationCoordinator(
    operationCoordinator: DatabaseOperationCoordinator,
  ): void {
    this.operationCoordinator = operationCoordinator;
  }

  async initialize(options: { createIfMissing?: boolean } = {}): Promise<void> {
    await ensureDirectory(this.adapter, parentPath(this.databasePath));
    this.sql = await initSqlJs();

    if (await this.adapter.exists(this.databasePath)) {
      const bytes = await this.adapter.readBinary(this.databasePath);
      this.database = new this.sql.Database(new Uint8Array(bytes));
    } else {
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
    const releaseOperation =
      this.operationCoordinator?.acquireOperation("database-write");
    let result!: T;
    const task = this.writeChain.then(async () => {
      this.raw.run("BEGIN IMMEDIATE");
      try {
        result = operation(this.raw);
        this.raw.run("COMMIT");
      } catch (error) {
        this.raw.run("ROLLBACK");
        throw error;
      }
      await this.persist();
    }).finally(() => releaseOperation?.());
    this.writeChain = task.then(
      () => undefined,
      () => undefined,
    );
    await task;
    return result;
  }

  async backup(destinationPath: string): Promise<void> {
    await this.writeChain;
    await ensureDirectory(this.adapter, parentPath(destinationPath));
    await this.adapter.copy(this.databasePath, destinationPath);
  }

  async restoreFromFile(sourcePath: string): Promise<void> {
    const bytes = await this.adapter.readBinary(sourcePath);
    await this.replaceFromBytes(new Uint8Array(bytes));
  }

  async replaceFromBytes(bytes: Uint8Array): Promise<void> {
    await this.writeChain;
    const sql = this.sql ?? (await this.loadSql());
    const next = new sql.Database(bytes);
    try {
      next.run(CREATE_SCHEMA_SQL);
      next.run(
        "UPDATE translations SET status='pending' WHERE status='translating'",
      );
      await this.persistDatabase(next);
    } catch (error) {
      next.close();
      throw error;
    }
    const previous = this.database;
    this.database = next;
    previous?.close();
  }

  exportBytes(): Uint8Array {
    return this.raw.export();
  }

  get path(): string {
    return this.databasePath;
  }

  private async persist(): Promise<void> {
    await this.persistDatabase(this.raw);
  }

  private async persistDatabase(database: Database): Promise<void> {
    const temporaryPath = `${this.databasePath}.tmp`;
    const previousPath = `${this.databasePath}.previous`;
    await removeIfExists(this.adapter, temporaryPath);
    await removeIfExists(this.adapter, previousPath);
    await this.adapter.writeBinary(
      temporaryPath,
      toArrayBuffer(database.export()),
    );
    const hadPrevious = await this.adapter.exists(this.databasePath);
    try {
      if (hadPrevious) {
        await this.adapter.rename(this.databasePath, previousPath);
      }
      await this.adapter.rename(temporaryPath, this.databasePath);
      await removeIfExists(this.adapter, previousPath);
    } catch (error) {
      if (
        hadPrevious &&
        !(await this.adapter.exists(this.databasePath)) &&
        (await this.adapter.exists(previousPath))
      ) {
        await this.adapter.rename(previousPath, this.databasePath);
      }
      await removeIfExists(this.adapter, temporaryPath);
      throw error;
    }
  }

  private async loadSql(): Promise<SqlJsStatic> {
    this.sql = await initSqlJs();
    return this.sql;
  }

}

export function databasePaths(
  dataDirectory: string,
): {
  databasePath: string;
  backupDirectory: string;
} {
  return {
    databasePath: normalizeVaultPath(
      `${dataDirectory}/rss-reader.sqlite3`,
    ),
    backupDirectory: normalizeVaultPath(`${dataDirectory}/backups`),
  };
}

export interface DatabaseInspection {
  exists: boolean;
  valid: boolean;
  error: string | null;
}

export async function inspectDatabaseFile(
  adapter: DataAdapter,
  databasePath: string,
): Promise<DatabaseInspection> {
  if (!(await adapter.exists(databasePath))) {
    return { exists: false, valid: false, error: null };
  }

  let database: Database | null = null;
  try {
    const sql = await initSqlJs();
    database = new sql.Database(
      new Uint8Array(await adapter.readBinary(databasePath)),
    );
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

function parentPath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

async function ensureDirectory(
  adapter: DataAdapter,
  directory: string,
): Promise<void> {
  if (!directory) {
    return;
  }
  let current = "";
  for (const segment of directory.split("/").filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }
}

async function removeIfExists(
  adapter: DataAdapter,
  path: string,
): Promise<void> {
  if (await adapter.exists(path)) {
    await adapter.remove(path);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function normalizeVaultPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+/g, "/");
}
