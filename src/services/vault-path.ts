import type { DataAdapter } from "obsidian";

import { t } from "../i18n";

export function resolveVaultDirectoryPath(
  directory: string,
): string {
  const value = directory.trim();
  if (!value || isAbsolutePath(value)) {
    throw new Error(t("ui.choose_a_relative_directory_inside_the_current_vault"));
  }
  const segments = value.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(t("ui.the_data_directory_must_be_inside_the_current_vault"));
  }
  const normalized = normalizeVaultPath(value);
  if (!normalized || normalized === "." || normalized.startsWith("../")) {
    throw new Error(t("ui.the_data_directory_must_be_inside_the_current_vault"));
  }
  return normalized;
}

export async function listDirectorySuggestions(
  adapter: DataAdapter,
  query: string,
  limit = 30,
): Promise<string[]> {
  const trimmed = query.trim();
  if (isAbsolutePath(trimmed) || trimmed.includes("..")) {
    return [];
  }
  const normalized = normalizeVaultPath(trimmed);
  const parts = normalized ? normalized.split("/") : [];
  const parent = query.endsWith("/")
    ? normalized
    : parts.slice(0, -1).join("/");
  const fragment = query.endsWith("/")
    ? ""
    : (parts[parts.length - 1] ?? "").toLocaleLowerCase();
  try {
    const { folders } = await adapter.list(parent || "/");
    return folders
      .map((folder) => normalizeVaultPath(folder))
      .filter((folder) =>
        (folder.split("/").slice(-1)[0] ?? "")
          .toLocaleLowerCase()
          .startsWith(fragment),
      )
      .sort((left, right) => left.localeCompare(right))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[a-zA-Z]:[\\/]/.test(path)
  );
}

function normalizeVaultPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}
