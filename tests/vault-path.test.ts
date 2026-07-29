import {
  mkdir,
  mkdtemp,
  realpath,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  join,
  resolve,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listDirectorySuggestions,
  resolveVaultDirectoryPath,
} from "../src/services/vault-path";

describe("vault directory boundaries", () => {
  it("accepts inside paths and missing leaf directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "rss-reader-vault-"));
    await mkdir(join(root, "Data"));
    const realRoot = await realpath(root);
    await expect(
      resolveVaultDirectoryPath(root, "Data/RSS"),
    ).resolves.toBe(resolve(realRoot, "Data/RSS"));
  });

  it("rejects absolute paths, traversal and external symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "rss-reader-vault-"));
    const outside = await mkdtemp(join(tmpdir(), "rss-reader-outside-"));
    await symlink(outside, join(root, "External"));

    await expect(
      resolveVaultDirectoryPath(root, outside),
    ).rejects.toThrow("相对目录");
    await expect(
      resolveVaultDirectoryPath(root, "../outside"),
    ).rejects.toThrow("必须位于当前 Vault 内");
    await expect(
      resolveVaultDirectoryPath(root, "External/Data"),
    ).rejects.toThrow("符号链接指向 Vault 外部");
  });

  it("keeps empty suggestions inside the vault root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "rss-reader-parent-"));
    const root = join(parent, "Vault");
    const outside = join(parent, "Outside");
    await mkdir(join(root, "Inside"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(root, "External"));

    const suggestions = await listDirectorySuggestions(root, "");
    expect(suggestions).toEqual(["Inside"]);
    expect(suggestions.every((value) => !value.startsWith(".."))).toBe(
      true,
    );
    await expect(
      listDirectorySuggestions(root, outside),
    ).resolves.toEqual([]);
  });
});
