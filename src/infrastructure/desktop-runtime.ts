type SqliteModule = typeof import("node:sqlite");
type FileSystemModule = typeof import("node:fs");
type PathModule = typeof import("node:path");
type CryptoModule = Pick<
  typeof import("node:crypto"),
  "createHash" | "randomUUID"
>;

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

export function loadCryptoModule(): CryptoModule {
  assertNativeHost();
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep Node crypto behind the desktop runtime boundary.
  return require("node:crypto") as CryptoModule;
}

export function sha256(value: string): string {
  return loadCryptoModule().createHash("sha256").update(value).digest("hex");
}

export function randomUuid(): string {
  return loadCryptoModule().randomUUID();
}

export function assertSqliteRuntime(): SqliteModule {
  const nodeVersion = currentNodeVersion();
  try {
    const runtime = loadSqliteModule();
    assertSqliteRuntimeCapabilities(runtime, nodeVersion);
    return runtime;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === t("ui.native_sqlite_runtime_required", {
        node: nodeVersion,
      })
    ) {
      throw error;
    }
    throw new Error(t("ui.native_sqlite_runtime_required", {
      node: nodeVersion,
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

function currentNodeVersion(): string {
  return typeof process !== "undefined" && process.versions?.node
    ? process.versions.node
    : "unknown";
}

function assertNativeHost(): void {
  if (typeof process === "undefined" || !process.versions?.node) {
    throw new Error(t("ui.native_sqlite_desktop_host_required"));
  }
}
