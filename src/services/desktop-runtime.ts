type SqliteModule = typeof import("node:sqlite");
type FileSystemModule = typeof import("node:fs");
type PathModule = typeof import("node:path");

import { t } from "../i18n";

export function loadSqliteModule(): SqliteModule {
  assertNativeHost();
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime detection keeps unsupported hosts loadable.
  return require("node:sqlite") as SqliteModule;
}

export function loadFileSystemModule(): FileSystemModule {
  assertNativeHost();
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- The native boundary is intentionally loaded only on Desktop.
  return require("node:fs") as FileSystemModule;
}

export function loadPathModule(): PathModule {
  assertNativeHost();
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- The native boundary is intentionally loaded only on Desktop.
  return require("node:path") as PathModule;
}

export function assertSqliteRuntime(): SqliteModule {
  try {
    const runtime = loadSqliteModule();
    assertSqliteRuntimeCapabilities(runtime, process.versions.node);
    return runtime;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === t("ui.native_sqlite_runtime_required", {
        node: process.versions.node,
      })
    ) {
      throw error;
    }
    throw new Error(t("ui.native_sqlite_runtime_required", {
      node: process.versions.node,
    }));
  }
}

export function assertSqliteRuntimeCapabilities(
  runtime: Partial<SqliteModule>,
  nodeVersion: string,
): void {
  const [major = 0, minor = 0] = nodeVersion.split(".").map(Number);
  if (
    major < 22 ||
    (major === 22 && minor < 16) ||
    typeof runtime.DatabaseSync !== "function" ||
    typeof runtime.backup !== "function"
  ) {
    throw new Error(t("ui.native_sqlite_runtime_required", {
      node: nodeVersion,
    }));
  }
}

function assertNativeHost(): void {
  if (typeof process === "undefined" || !process.versions?.node) {
    throw new Error(t("ui.native_sqlite_desktop_host_required"));
  }
}
