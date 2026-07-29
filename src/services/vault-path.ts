import {
  lstat,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export async function resolveVaultDirectoryPath(
  vaultRoot: string,
  directory: string,
): Promise<string> {
  const value = directory.trim();
  if (!value || isAbsolute(value)) {
    throw new Error("请选择当前 Vault 内的相对目录");
  }
  const realVaultRoot = await realpath(vaultRoot);
  const lexicalDestination = resolve(realVaultRoot, value);
  if (!isPathInside(realVaultRoot, lexicalDestination)) {
    throw new Error("数据目录必须位于当前 Vault 内");
  }
  const realDestination =
    await resolveWithExistingAncestor(lexicalDestination);
  if (!isPathInside(realVaultRoot, realDestination)) {
    throw new Error("数据目录不能通过符号链接指向 Vault 外部");
  }
  return realDestination;
}

export function isPathInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return (
    path === "" ||
    (path !== ".." &&
      !path.startsWith(`..${sep}`) &&
      !isAbsolute(path))
  );
}

export async function listDirectorySuggestions(
  vaultRoot: string,
  query: string,
  limit = 30,
): Promise<string[]> {
  const trimmed = query.trim();
  if (isAbsolute(trimmed)) {
    return [];
  }
  const normalized = trimmed.replace(/^\/+|\/+$/g, "");
  const absoluteQuery = resolve(vaultRoot, normalized);
  if (!isPathInside(vaultRoot, absoluteQuery)) {
    return [];
  }
  const lexicalParent = !normalized
    ? vaultRoot
    : query.endsWith("/")
      ? absoluteQuery
      : dirname(absoluteQuery);
  const parentRelative = relative(vaultRoot, lexicalParent) || ".";
  const fragment = query.endsWith("/")
    ? ""
    : normalized.split("/").at(-1)?.toLocaleLowerCase() ?? "";
  try {
    const parent = await resolveVaultDirectoryPath(
      vaultRoot,
      parentRelative,
    );
    const entries = await readdir(parent, { withFileTypes: true });
    const candidates = await Promise.all(
      entries
        .filter((entry) =>
          entry.name.toLocaleLowerCase().startsWith(fragment),
        )
        .map(async (entry) => {
          const lexicalCandidate = join(lexicalParent, entry.name);
          const candidateRelative = relative(
            vaultRoot,
            lexicalCandidate,
          );
          try {
            const resolvedCandidate =
              await resolveVaultDirectoryPath(
                vaultRoot,
                candidateRelative,
              );
            return (await stat(resolvedCandidate)).isDirectory()
              ? candidateRelative
              : null;
          } catch {
            return null;
          }
        }),
    );
    return candidates
      .filter((candidate): candidate is string => candidate !== null)
      .sort((left, right) => left.localeCompare(right))
      .slice(0, limit);
  } catch {
    return [];
  }
}

async function resolveWithExistingAncestor(
  candidate: string,
): Promise<string> {
  let current = candidate;
  const missingSegments: string[] = [];
  while (true) {
    try {
      const existing = await realpath(current);
      return resolve(existing, ...missingSegments.reverse());
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
      const danglingLink = await lstat(current)
        .then((entry) => entry.isSymbolicLink())
        .catch(() => false);
      if (danglingLink) {
        throw new Error("数据目录包含无法解析的符号链接");
      }
      const parent = dirname(current);
      if (parent === current) {
        throw error;
      }
      missingSegments.push(basename(current));
      current = parent;
    }
  }
}

function isMissingPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: unknown }).code === "ENOENT"
  );
}
