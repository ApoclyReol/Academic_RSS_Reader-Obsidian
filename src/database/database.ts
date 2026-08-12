import type { DataAdapter } from "obsidian";
import type {
  DatabaseSync,
  StatementSync,
} from "node:sqlite";

import { t } from "../i18n";
import type { DatabaseOperationCoordinator } from "../services/database-operation-coordinator";
import {
  assertSqliteRuntime,
  loadFileSystemModule,
  loadPathModule,
} from "../services/desktop-runtime";
import { resolveVaultDirectoryPath } from "../services/vault-path";
import {
  CREATE_SCHEMA_SQL,
  SCHEMA_MIGRATIONS,
  SCHEMA_VERSION,
} from "./schema";

export type SqliteValue = null | number | bigint | string | Uint8Array;
export type SqliteRow = Record<string, unknown>;
export type SqliteParams = Record<string, unknown>;
export type Database = SqliteDatabase;
export type BindParams = SqliteParams;
export type SqlValue = unknown;

interface SqliteExecResult {
  columns: string[];
  values: unknown[][];
}

export class SqliteStatement {
  private bound: SqliteParams = {};
  private rows: SqliteRow[] | null = null;
  private rowIndex = 0;
  private current: SqliteRow | null = null;

  constructor(private readonly statement: StatementSync) {
    this.statement.setAllowUnknownNamedParameters(true);
  }

  bind(params: SqliteParams = {}): void {
    this.bound = params;
    this.rows = null;
    this.rowIndex = 0;
    this.current = null;
  }

  all(params: SqliteParams = this.bound): SqliteRow[] {
    return this.statement.all(params as Record<string, SqliteValue>);
  }

  get(params: SqliteParams = this.bound): unknown[] {
    const row = this.statement.get(
      params as Record<string, SqliteValue>,
    ) as SqliteRow | undefined;
    return row ? Object.values(row) : [];
  }

  getAsObjectFromFirstRow(): SqliteRow {
    const row = this.statement.get(
      this.bound as Record<string, SqliteValue>,
    ) as SqliteRow | undefined;
    return row ?? {};
  }

  getAsObject(): SqliteRow {
    return this.current ?? {};
  }

  step(): boolean {
    this.rows ??= this.all();
    this.current = this.rows[this.rowIndex] ?? null;
    this.rowIndex += 1;
    return this.current !== null;
  }

  run(params: SqliteParams = this.bound): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  } {
    return this.statement.run(params as Record<string, SqliteValue>);
  }

  free(): void {
    // StatementSync is released by the runtime and has no explicit free API.
  }
}

export class SqliteDatabase {
  private lastChanges = 0;

  constructor(private readonly database: DatabaseSync) {}

  exec(sql: string): SqliteExecResult[] {
    const trimmed = sql.trim();
    const statements = splitSqlStatements(trimmed);
    const results: SqliteExecResult[] = [];
    for (const statementText of statements) {
      if (/^(?:SELECT|PRAGMA|WITH)\b/i.test(statementText)) {
        const statement = this.prepare(statementText);
        const rows = statement.all();
        const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];
        results.push({
          columns,
          values: rows.map((row) => columns.map((column) => row[column])),
        });
      } else {
        this.database.exec(statementText);
      }
    }
    return results;
  }

  run(sql: string, params: SqliteParams = {}): void {
    const statement = this.database.prepare(sql);
    statement.setAllowUnknownNamedParameters(true);
    const result = statement.run(params as Record<string, SqliteValue>);
    this.lastChanges = Number(result.changes);
  }

  getRowsModified(): number {
    return this.lastChanges;
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.database.prepare(sql));
  }

  close(): void {
    this.database.close();
  }

  get isTransaction(): boolean {
    return this.database.isTransaction;
  }

  get native(): DatabaseSync {
    return this.database;
  }
}

type NativeDataAdapter = DataAdapter & {
  getFullPath(normalizedPath: string): string;
};

export class RssDatabase {
  private database: SqliteDatabase | null = null;
  private nativeDatabase: DatabaseSync | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private pendingWrites = 0;
  private storageError: Error | null = null;
  private recoveryResult: DatabaseRecoveryResult | null = null;
  private nativeDatabasePath: string | null = null;

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
    const safeDatabasePath = resolveVaultDirectoryPath(this.databasePath);
    await ensureDirectory(this.adapter, parentPath(safeDatabasePath));
    assertSqliteRuntime();
    const nativePath = this.nativePath();
    const exists = loadFileSystemModule().existsSync(nativePath);
    if (!exists && options.createIfMissing === false) {
      throw new Error(t("ui.the_selected_directory_does_not_contain_rss_reader_sqlite3"));
    }

    try {
      this.openConnection();
      this.recoveryResult = {
        recovered: false,
        source: exists ? "primary" : "created",
        primaryError: null,
      };
    } catch (error) {
      this.closeIfOpen();
      if (!exists && !hasNativeRecoveryCandidate(nativePath)) {
        removeDatabaseArtifacts(nativePath);
        throw error;
      }
      const inspected = inspectNativeDatabaseFile(nativePath, true);
      if (inspected.valid && !hasNativeRecoveryCandidate(nativePath)) {
        throw error;
      }
      const recovery = recoverNativeDatabaseFile(nativePath);
      this.recoveryResult = {
        recovered: true,
        source: recovery.source,
        primaryError: error instanceof Error ? error.message : String(error),
      };
      this.openConnection();
    }
  }

  close(): void {
    if (this.pendingWrites > 0) {
      throw new Error(t("ui.the_database_still_has_a_save_operation_in_progress"));
    }
    this.closeIfOpen();
  }

  async drain(): Promise<void> {
    await this.writeChain;
    this.assertStorageHealthy();
  }

  get raw(): SqliteDatabase {
    if (!this.database) {
      throw new Error(t("ui.the_database_has_not_been_initialized"));
    }
    return this.database;
  }

  query<T>(sql: string, params: SqliteParams = {}): T[] {
    const statement = this.raw.prepare(sql);
    return statement.all(params) as T[];
  }

  get<T>(sql: string, params: SqliteParams = {}): T | null {
    const statement = this.raw.prepare(sql);
    const rows = statement.all(params) as T[];
    return rows[0] ?? null;
  }

  async write<T>(
    operation: (database: SqliteDatabase) => T | Promise<T>,
  ): Promise<T> {
    this.assertStorageHealthy();
    const releaseOperation =
      this.operationCoordinator?.acquireOperation("database-write");
    this.pendingWrites += 1;
    let result!: T;
    const task = this.writeChain.then(async () => {
      this.assertStorageHealthy();
      const database = this.raw;
      database.exec("BEGIN IMMEDIATE");
      try {
        result = await operation(database);
        database.exec("COMMIT");
      } catch (error) {
        if (database.isTransaction) {
          database.exec("ROLLBACK");
        }
        throw error;
      }
    }).catch((error: unknown) => {
      this.markStorageFailureIfCommitError(error);
      throw error;
    }).finally(() => {
      this.pendingWrites -= 1;
      releaseOperation?.();
    });
    this.writeChain = task.then(() => undefined, () => undefined);
    await task;
    return result;
  }

  async backup(destinationPath: string): Promise<void> {
    await this.drain();
    const safeDestinationPath = resolveVaultDirectoryPath(destinationPath);
    await ensureDirectory(this.adapter, parentPath(safeDestinationPath));
    const destination = fullPath(this.adapter, safeDestinationPath);
    const fs = loadFileSystemModule();
    const path = loadPathModule();
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    removeDatabaseArtifacts(destination);
    await assertSqliteRuntime().backup(this.nativeConnection(), destination);
    const inspection = inspectNativeDatabaseFile(destination, true);
    if (!inspection.valid) {
      removeDatabaseArtifacts(destination);
      throw new Error(inspection.error ?? t("ui.the_saved_database_failed_validation"));
    }
  }

  async restoreFromFile(sourcePath: string): Promise<void> {
    await this.drain();
    const source = fullPath(this.adapter, sourcePath);
    const target = this.nativePath();
    const incoming = `${target}.incoming`;
    const rollback = `${target}.rollback`;
    const fs = loadFileSystemModule();
    const path = loadPathModule();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    removeDatabaseArtifacts(incoming);
    removeDatabaseArtifacts(rollback);
    const sourceDatabase = openReadOnlyDatabase(source);
    try {
      await assertSqliteRuntime().backup(sourceDatabase, incoming);
    } catch (error) {
      removeDatabaseArtifacts(incoming);
      throw error;
    } finally {
      sourceDatabase.close();
    }
    const incomingInspection = inspectNativeDatabaseFile(incoming, true);
    if (!incomingInspection.valid) {
      removeDatabaseArtifacts(incoming);
      throw new Error(incomingInspection.error ?? t("ui.the_restored_database_failed_validation"));
    }
    this.checkpointWal();
    this.close();
    if (fs.existsSync(target)) {
      fs.renameSync(target, rollback);
      renameDatabaseSidecars(target, rollback);
    }
    try {
      fs.renameSync(incoming, target);
      const installed = inspectNativeDatabaseFile(target, true);
      if (!installed.valid) {
        throw new Error(installed.error ?? t("ui.the_restored_database_failed_validation"));
      }
      checkpointNativeDatabaseFile(target);
      removeDatabaseArtifacts(rollback);
      this.openConnection();
    } catch (error) {
      removeDatabaseArtifacts(target);
      if (fs.existsSync(rollback)) {
        fs.renameSync(rollback, target);
        renameDatabaseSidecars(rollback, target);
      }
      this.openConnection();
      throw error;
    }
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

  private nativePath(): string {
    if (!this.nativeDatabasePath) {
      this.nativeDatabasePath = fullPath(this.adapter, this.databasePath);
    }
    return this.nativeDatabasePath;
  }

  private nativeConnection(): DatabaseSync {
    if (!this.nativeDatabase) {
      throw new Error(t("ui.the_database_has_not_been_initialized"));
    }
    return this.nativeDatabase;
  }

  private checkpointWal(): void {
    this.nativeConnection().exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  private openConnection(): void {
    if (this.database) {
      return;
    }
    const runtime = assertSqliteRuntime();
    const native = new runtime.DatabaseSync(this.nativePath(), {
      open: true,
      readOnly: false,
      timeout: 5_000,
      enableForeignKeyConstraints: true,
    });
    let migrationProtection: string | null = null;
    try {
      native.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      const tables = native
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      if (tables.length === 0) {
        native.exec("BEGIN IMMEDIATE");
        try {
          native.exec(CREATE_SCHEMA_SQL);
          native.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
          native.exec("COMMIT");
        } catch (error) {
          native.exec("ROLLBACK");
          throw error;
        }
        applySchemaMigrations(native);
      } else {
        const appliedVersion = latestSchemaVersion(native);
        if (appliedVersion < SCHEMA_VERSION) {
          migrationProtection = createMigrationProtectionBackup(native);
        }
        applySchemaMigrations(native);
        native.exec(
          "CREATE INDEX IF NOT EXISTS idx_items_identity_fallback_journal ON items(title_norm, authors, year, article_journal)",
        );
        native.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
      }
      native.exec(
        "UPDATE translations SET status='pending' WHERE status='translating';",
      );
      native.exec("PRAGMA journal_mode=WAL;");
      const inspection = inspectConnection(native, true);
      if (!inspection.valid) {
        throw new Error(inspection.error ?? t("ui.the_saved_database_failed_validation"));
      }
      this.nativeDatabase = native;
      this.database = new SqliteDatabase(native);
    } catch (error) {
      native.close();
      if (migrationProtection) {
        restoreNativeSnapshot(this.nativePath(), migrationProtection);
      }
      throw error;
    }
  }

  private closeIfOpen(): void {
    this.database?.close();
    this.database = null;
    this.nativeDatabase = null;
  }

  private assertStorageHealthy(): void {
    if (this.storageError) {
      throw this.storageError;
    }
  }

  private markStorageFailureIfCommitError(error: unknown): void {
    if (this.storageError || !(error instanceof Error)) {
      return;
    }
    if (/database|disk|readonly|locked|io/i.test(error.message)) {
      this.storageError = new Error(t("database.save_failed", {
        detail: error.message,
      }));
      this.onStorageFailure(this.storageError);
    }
  }
}

export function databasePaths(
  dataDirectory: string,
): { databasePath: string; backupDirectory: string } {
  return {
    databasePath: normalizeVaultPath(`${dataDirectory}/rss-reader.sqlite3`),
    backupDirectory: normalizeVaultPath(`${dataDirectory}/backups`),
  };
}

export interface DatabaseInspection {
  exists: boolean;
  valid: boolean;
  migrationRequired?: boolean;
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

function applySchemaMigrations(database: DatabaseSync): void {
  const applied = new Set<number>(
    (database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>)
      .map((row) => Number(row.version)),
  );
  for (const migration of SCHEMA_MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const sql of migration.statements) {
        database.exec(sql);
      }
      database
        .prepare("INSERT INTO schema_migrations(version) VALUES ($version)")
        .run({ $version: migration.version });
      database.exec("COMMIT");
    } catch (error) {
      if (database.isTransaction) {
        database.exec("ROLLBACK");
      }
      throw error;
    }
  }
}

function latestSchemaVersion(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT MAX(version) AS version FROM schema_migrations")
    .get() as { version?: number } | undefined;
  return Number(row?.version ?? 0);
}

function createMigrationProtectionBackup(database: DatabaseSync): string | null {
  const nativePath = database.location();
  if (!nativePath) {
    return null;
  }
  const fs = loadFileSystemModule();
  const path = loadPathModule();
  const directory = path.join(path.dirname(nativePath), "backups");
  fs.mkdirSync(directory, { recursive: true });
  let target = path.join(
    directory,
    `before-schema${SCHEMA_VERSION}-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite3`,
  );
  let suffix = 1;
  while (fs.existsSync(target)) {
    target = path.join(
      directory,
      `before-schema${SCHEMA_VERSION}-${new Date().toISOString().replace(/[:.]/g, "-")}-${suffix}.sqlite3`,
    );
    suffix += 1;
  }
  const escaped = target.replaceAll("'", "''");
  database.exec(`VACUUM INTO '${escaped}'`);
  return target;
}

function restoreNativeSnapshot(target: string, snapshot: string): void {
  const fs = loadFileSystemModule();
  const rollback = `${target}.migration-rollback`;
  removeDatabaseArtifacts(rollback);
  removeDatabaseSidecars(target);
  if (fs.existsSync(target)) {
    fs.renameSync(target, rollback);
  }
  try {
    fs.copyFileSync(snapshot, target);
    removeDatabaseSidecars(target);
    removeDatabaseArtifacts(rollback);
  } catch (error) {
    removeDatabaseArtifacts(target);
    if (fs.existsSync(rollback)) {
      fs.renameSync(rollback, target);
    }
    throw new Error(t("database.migration_rollback_restored", {
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export async function recoverDatabaseFile(
  adapter: DataAdapter,
  databasePath: string,
): Promise<DatabaseRecoveryResult> {
  const recovery = recoverNativeDatabaseFile(fullPath(adapter, databasePath));
  return {
    recovered: true,
    source: recovery.source,
    primaryError: recovery.primaryError,
  };
}

export async function inspectDatabaseFile(
  adapter: DataAdapter,
  databasePath: string,
): Promise<DatabaseInspection> {
  return inspectNativeDatabaseFile(fullPath(adapter, databasePath), true);
}

function recoverNativeDatabaseFile(nativePath: string): {
  source: DatabaseRecoverySource;
  primaryError: string | null;
} {
  const primary = inspectNativeDatabaseFile(nativePath, true);
  if (primary.valid) {
    return { source: "primary", primaryError: null };
  }
  const candidates: Array<{
    source: DatabaseRecoverySource;
    path: string;
  }> = [
    { source: "temporary", path: `${nativePath}.tmp` },
    { source: "previous", path: `${nativePath}.previous` },
    { source: "temporary", path: `${nativePath}.incoming` },
    { source: "previous", path: `${nativePath}.rollback` },
  ];
  const selected = candidates.find((candidate) =>
    inspectNativeDatabaseFile(candidate.path, true).valid,
  );
  if (!selected) {
    throw new Error(t("database.recovery_invalid", {
      detail: primary.error ?? t("ui.unknown_error"),
    }));
  }
  const fs = loadFileSystemModule();
  const path = loadPathModule();
  fs.mkdirSync(path.dirname(nativePath), { recursive: true });
  const displaced = `${nativePath}.recovery-displaced`;
  removeNativeIfExists(displaced);
  if (fs.existsSync(nativePath)) {
    fs.renameSync(nativePath, displaced);
    renameDatabaseSidecars(nativePath, displaced);
  }
  try {
    fs.renameSync(selected.path, nativePath);
    renameDatabaseSidecars(selected.path, nativePath);
    const restored = inspectNativeDatabaseFile(nativePath, true);
    if (!restored.valid) {
      throw new Error(restored.error ?? t("ui.the_restored_database_failed_validation"));
    }
    checkpointNativeDatabaseFile(nativePath);
    removeDatabaseArtifacts(displaced);
    for (const candidate of candidates) {
      removeDatabaseArtifacts(candidate.path);
    }
    removeDatabaseSidecars(nativePath);
    return { source: selected.source, primaryError: primary.error };
  } catch (error) {
    if (fs.existsSync(nativePath)) {
      removeDatabaseArtifacts(selected.path);
      fs.renameSync(nativePath, selected.path);
      renameDatabaseSidecars(nativePath, selected.path);
    }
    if (fs.existsSync(displaced)) {
      fs.renameSync(displaced, nativePath);
      renameDatabaseSidecars(displaced, nativePath);
    }
    throw error;
  }
}

function inspectNativeDatabaseFile(
  nativePath: string,
  full: boolean,
): DatabaseInspection {
  const fs = loadFileSystemModule();
  if (!fs.existsSync(nativePath)) {
    return { exists: false, valid: false, error: null };
  }
  let database: DatabaseSync | null = null;
  try {
    database = openReadOnlyDatabase(nativePath);
    return inspectConnection(database, full);
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

function inspectConnection(
  database: DatabaseSync,
  full: boolean,
): DatabaseInspection {
  const requiredTables = [
    "schema_migrations",
    "feeds",
    "items",
    "item_feeds",
    "recommendation_scores",
    "recommendation_keywords",
    "recommendation_models",
    "translations",
    "app_metadata",
  ];
  const tables = new Set(
    (database
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>)
      .map((row) => row.name),
  );
  const missing = requiredTables.filter((table) => !tables.has(table));
  if (missing.length > 0) {
    return {
      exists: true,
      valid: false,
      error: t("database.missing_tables", { tables: missing.join(", ") }),
    };
  }
  const schemaVersion = latestSchemaVersion(database);
  if (schemaVersion > SCHEMA_VERSION) {
    return {
      exists: true,
      valid: false,
      error: t("database.unsupported_schema_version", {
        actual: schemaVersion,
        expected: SCHEMA_VERSION,
      }),
    };
  }
  if (full) {
    const integrity = String(
      (database.prepare("PRAGMA integrity_check").get() as {
        integrity_check: string;
      }).integrity_check,
    );
    if (integrity !== "ok") {
      return {
        exists: true,
        valid: false,
        error: t("database.integrity_failed", { detail: integrity }),
      };
    }
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      return {
        exists: true,
        valid: false,
        error: t("database.foreign_key_check_failed"),
      };
    }
  }
  return {
    exists: true,
    valid: true,
    migrationRequired: schemaVersion < SCHEMA_VERSION,
    error: null,
  };
}

function openReadOnlyDatabase(nativePath: string): DatabaseSync {
  return new (assertSqliteRuntime().DatabaseSync)(nativePath, {
    readOnly: true,
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
}

function checkpointNativeDatabaseFile(nativePath: string): void {
  const database = new (assertSqliteRuntime().DatabaseSync)(nativePath, {
    readOnly: false,
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
  try {
    database.exec("PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE);");
  } finally {
    database.close();
  }
}

function hasNativeRecoveryCandidate(nativePath: string): boolean {
  const fs = loadFileSystemModule();
  return [
    `${nativePath}.tmp`,
    `${nativePath}.previous`,
    `${nativePath}.incoming`,
    `${nativePath}.rollback`,
  ].some((path) => fs.existsSync(path));
}

function removeNativeIfExists(nativePath: string): void {
  loadFileSystemModule().rmSync(nativePath, { force: true });
}

function removeDatabaseSidecars(nativePath: string): void {
  removeNativeIfExists(`${nativePath}-wal`);
  removeNativeIfExists(`${nativePath}-shm`);
}

function renameDatabaseSidecars(source: string, destination: string): void {
  const fs = loadFileSystemModule();
  for (const suffix of ["-wal", "-shm"]) {
    const sourcePath = `${source}${suffix}`;
    if (fs.existsSync(sourcePath)) {
      removeNativeIfExists(`${destination}${suffix}`);
      fs.renameSync(sourcePath, `${destination}${suffix}`);
    }
  }
}

function removeDatabaseArtifacts(nativePath: string): void {
  removeNativeIfExists(nativePath);
  removeDatabaseSidecars(nativePath);
}

function fullPath(adapter: DataAdapter, normalizedPath: string): string {
  const nativeAdapter = adapter as NativeDataAdapter;
  if (typeof nativeAdapter.getFullPath !== "function") {
    throw new Error(t("database.adapter_full_path_unavailable"));
  }
  return nativeAdapter.getFullPath(resolveVaultDirectoryPath(normalizedPath));
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

function normalizeVaultPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+/g, "/");
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement) {
        statements.push(statement);
      }
      start = index + 1;
    }
  }
  const last = sql.slice(start).trim();
  if (last) {
    statements.push(last);
  }
  return statements;
}
