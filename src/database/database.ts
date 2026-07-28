import {
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

  async initialize(): Promise<void> {
    await mkdir(dirname(this.databasePath), { recursive: true });
    this.sql = await initSqlJs();

    try {
      const bytes = await readFile(this.databasePath);
      this.database = new this.sql.Database(bytes);
    } catch (error) {
      if (!this.isMissingFile(error)) {
        throw error;
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
  pluginDirectory: string,
): {
  databasePath: string;
  backupDirectory: string;
} {
  return {
    databasePath: join(pluginDirectory, "rss-reader.sqlite3"),
    backupDirectory: join(pluginDirectory, "backups"),
  };
}

export function recoveryDatabasePath(pluginDirectory: string): string {
  return join(pluginDirectory, "rss-reader-recovery.sqlite3");
}
