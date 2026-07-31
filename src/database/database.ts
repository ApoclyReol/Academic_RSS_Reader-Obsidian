import type { DataAdapter } from "obsidian";
import type {
  BindParams,
  Database,
  SqlJsStatic,
} from "sql.js";
import initSqlJs from "sql.js/dist/sql-asm.js";

import { t } from "../i18n";
import type { DatabaseOperationCoordinator } from "../services/database-operation-coordinator";
import {
  CREATE_SCHEMA_SQL,
  SCHEMA_MIGRATIONS,
} from "./schema";

export class RssDatabase {
  private sql: SqlJsStatic | null = null;
  private database: Database | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private pendingWrites = 0;
  private storageError: Error | null = null;
  private recoveryResult: DatabaseRecoveryResult | null = null;

  constructor(
    private readonly adapter: DataAdapter,
    private readonly databasePath: string,
    private operationCoordinator?: DatabaseOperationCoordinator,
    private readonly onStorageFailure: (error: Error) => void =
      () => undefined,
  ) {}

  setOperationCoordinator(
    operationCoordinator: DatabaseOperationCoordinator,
  ): void {
    this.operationCoordinator = operationCoordinator;
  }

  async initialize(options: { createIfMissing?: boolean } = {}): Promise<void> {
    await ensureDirectory(this.adapter, parentPath(this.databasePath));
    this.sql = await initSqlJs();

    const inspection = await inspectDatabaseFile(
      this.adapter,
      this.databasePath,
    );
    if (inspection.valid) {
      this.recoveryResult = {
        recovered: false,
        source: "primary",
        primaryError: null,
      };
      await removeIfExists(this.adapter, `${this.databasePath}.tmp`);
      await removeIfExists(this.adapter, `${this.databasePath}.previous`);
      const bytes = await this.adapter.readBinary(this.databasePath);
      this.database = new this.sql.Database(new Uint8Array(bytes));
    } else {
      const hasRecoveryCandidate =
        (await this.adapter.exists(`${this.databasePath}.tmp`)) ||
        (await this.adapter.exists(`${this.databasePath}.previous`));
      if (inspection.exists || hasRecoveryCandidate) {
        this.recoveryResult = await recoverDatabaseFile(
          this.adapter,
          this.databasePath,
        );
        const bytes = await this.adapter.readBinary(this.databasePath);
        this.database = new this.sql.Database(new Uint8Array(bytes));
      } else {
        if (options.createIfMissing === false) {
          throw new Error(t("ui.the_selected_directory_does_not_contain_rss_reader_sqlite3"));
        }
        this.recoveryResult = {
          recovered: false,
          source: "created",
          primaryError: null,
        };
        this.database = new this.sql.Database();
      }
    }

    this.database.run(CREATE_SCHEMA_SQL);
    applySchemaMigrations(this.database);
    this.database.run(
      "UPDATE translations SET status='pending' WHERE status='translating'",
    );
    await this.persist();
  }

  close(): void {
    if (this.pendingWrites > 0) {
      throw new Error(t("ui.the_database_still_has_a_save_operation_in_progress"));
    }
    this.database?.close();
    this.database = null;
  }

  async drain(): Promise<void> {
    await this.writeChain;
    this.assertStorageHealthy();
  }

  get raw(): Database {
    if (!this.database) {
      throw new Error(t("ui.the_database_has_not_been_initialized"));
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
    this.assertStorageHealthy();
    const releaseOperation =
      this.operationCoordinator?.acquireOperation("database-write");
    let result!: T;
    let committed = false;
    this.pendingWrites += 1;
    const task = this.writeChain.then(async () => {
      this.assertStorageHealthy();
      this.raw.run("BEGIN IMMEDIATE");
      try {
        result = operation(this.raw);
        this.raw.run("COMMIT");
        committed = true;
      } catch (error) {
        this.raw.run("ROLLBACK");
        throw error;
      }
      try {
        await this.persist();
      } catch (error) {
        if (committed) {
          this.markStorageFailure(error);
        }
        throw error;
      }
    }).finally(() => {
      this.pendingWrites -= 1;
      releaseOperation?.();
    });
    this.writeChain = task.then(
      () => undefined,
      () => undefined,
    );
    await task;
    return result;
  }

  async backup(destinationPath: string): Promise<void> {
    await this.drain();
    await ensureDirectory(this.adapter, parentPath(destinationPath));
    await this.adapter.copy(this.databasePath, destinationPath);
  }

  async restoreFromFile(sourcePath: string): Promise<void> {
    const bytes = await this.adapter.readBinary(sourcePath);
    await this.replaceFromBytes(new Uint8Array(bytes));
  }

  async replaceFromBytes(bytes: Uint8Array): Promise<void> {
    await this.drain();
    const sql = this.sql ?? (await this.loadSql());
    const next = new sql.Database(bytes);
    try {
      next.run(CREATE_SCHEMA_SQL);
      applySchemaMigrations(next);
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

  get recovery(): DatabaseRecoveryResult | null {
    return this.recoveryResult;
  }

  get persistenceError(): Error | null {
    return this.storageError;
  }

  private async persist(): Promise<void> {
    await this.persistDatabase(this.raw);
  }

  private async persistDatabase(database: Database): Promise<void> {
    const temporaryPath = `${this.databasePath}.tmp`;
    const previousPath = `${this.databasePath}.previous`;
    this.assertStorageHealthy();
    await this.adapter.writeBinary(
      temporaryPath,
      toArrayBuffer(database.export()),
    );
    const temporaryInspection = await inspectDatabaseFile(
      this.adapter,
      temporaryPath,
    );
    if (!temporaryInspection.valid) {
      throw new Error(
        temporaryInspection.error ?? t("ui.the_temporary_database_snapshot_failed_validation"),
      );
    }
    const hadPrevious = await this.adapter.exists(this.databasePath);
    try {
      if (hadPrevious) {
        await this.adapter.rename(this.databasePath, previousPath);
      }
      await this.adapter.rename(temporaryPath, this.databasePath);
      const persisted = await inspectDatabaseFile(
        this.adapter,
        this.databasePath,
      );
      if (!persisted.valid) {
        throw new Error(persisted.error ?? t("ui.the_saved_database_failed_validation"));
      }
      await removeIfExists(this.adapter, previousPath);
    } catch (error) {
      if (
        hadPrevious &&
        (await this.adapter.exists(previousPath))
      ) {
        await removeIfExists(this.adapter, this.databasePath);
        await this.adapter.rename(previousPath, this.databasePath);
      }
      throw error;
    }
  }

  private assertStorageHealthy(): void {
    if (this.storageError) {
      throw this.storageError;
    }
  }

  private markStorageFailure(error: unknown): void {
    if (this.storageError) {
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    this.storageError = new Error(
      t("database.save_failed", { detail }),
    );
    this.onStorageFailure(this.storageError);
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

export type DatabaseRecoverySource =
  | "primary"
  | "temporary"
  | "previous"
  | "created";

export interface DatabaseRecoveryResult {
  recovered: boolean;
  source: DatabaseRecoverySource;
  primaryError: string | null;
}

function applySchemaMigrations(database: Database): void {
  const applied = new Set<number>();
  const statement = database.prepare(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  try {
    while (statement.step()) {
      applied.add(Number(statement.get()[0]));
    }
  } finally {
    statement.free();
  }
  for (const migration of SCHEMA_MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }
    database.run("BEGIN");
    try {
      for (const sql of migration.statements) {
        database.run(sql);
      }
      database.run(
        `INSERT INTO schema_migrations(version) VALUES (${migration.version})`,
      );
      database.run("COMMIT");
    } catch (error) {
      database.run("ROLLBACK");
      throw error;
    }
  }
}

export async function recoverDatabaseFile(
  adapter: DataAdapter,
  databasePath: string,
): Promise<DatabaseRecoveryResult> {
  const primary = await inspectDatabaseFile(adapter, databasePath);
  if (primary.valid) {
    return {
      recovered: false,
      source: "primary",
      primaryError: null,
    };
  }

  const candidates = [
    { source: "temporary" as const, path: `${databasePath}.tmp` },
    { source: "previous" as const, path: `${databasePath}.previous` },
  ];
  let selected: (typeof candidates)[number] | null = null;
  const errors: string[] = [];
  for (const candidate of candidates) {
    const inspection = await inspectDatabaseFile(adapter, candidate.path);
    if (inspection.valid) {
      selected = candidate;
      break;
    }
    if (inspection.exists && inspection.error) {
      errors.push(`${candidate.path}: ${inspection.error}`);
    }
  }
  if (!selected) {
    const detail = [primary.error, ...errors].filter(Boolean).join("; ");
    throw new Error(t("database.recovery_invalid", { detail }));
  }

  const displacedPath = `${databasePath}.recovery-displaced`;
  await removeIfExists(adapter, displacedPath);
  if (primary.exists) {
    await adapter.rename(databasePath, displacedPath);
  }
  try {
    await adapter.copy(selected.path, databasePath);
    const restored = await inspectDatabaseFile(adapter, databasePath);
    if (!restored.valid) {
      throw new Error(restored.error ?? t("ui.the_restored_database_failed_validation"));
    }
    await removeIfExists(adapter, displacedPath);
    await removeIfExists(adapter, `${databasePath}.tmp`);
    await removeIfExists(adapter, `${databasePath}.previous`);
    return {
      recovered: true,
      source: selected.source,
      primaryError: primary.error,
    };
  } catch (error) {
    await removeIfExists(adapter, databasePath);
    if (await adapter.exists(displacedPath)) {
      await adapter.rename(displacedPath, databasePath);
    }
    throw error;
  }
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
      throw new Error(t("database.integrity_failed", {
        detail: String(result ?? t("ui.unknown_error")),
      }));
    }
    const requiredTables = ["feeds", "items", "item_feeds"];
    const tables = new Set(
      database
        .exec("SELECT name FROM sqlite_master WHERE type='table'")[0]
        ?.values.map((row) => String(row[0])) ?? [],
    );
    const missing = requiredTables.filter((table) => !tables.has(table));
    if (missing.length > 0) {
      throw new Error(t("database.missing_tables", {
        tables: missing.join(", "),
      }));
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
