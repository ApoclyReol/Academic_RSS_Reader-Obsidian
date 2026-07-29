import { describe, expect, it } from "vitest";

import {
  listDirectorySuggestions,
  resolveVaultDirectoryPath,
} from "../src/services/vault-path";
import { MemoryAdapter } from "./helpers/memory-adapter";

describe("vault directory boundaries", () => {
  it("accepts normalized Vault-relative directories", () => {
    expect(resolveVaultDirectoryPath("Data/RSS")).toBe("Data/RSS");
    expect(resolveVaultDirectoryPath("Data\\RSS")).toBe("Data/RSS");
  });

  it("rejects empty, absolute and traversal paths", () => {
    expect(() => resolveVaultDirectoryPath("")).toThrow("相对目录");
    expect(() => resolveVaultDirectoryPath("/tmp/outside")).toThrow(
      "相对目录",
    );
    expect(() => resolveVaultDirectoryPath("C:\\outside")).toThrow(
      "相对目录",
    );
    expect(() => resolveVaultDirectoryPath("../outside")).toThrow(
      "必须位于当前 Vault 内",
    );
  });

  it("lists matching folders through the Vault adapter", async () => {
    const adapter = new MemoryAdapter();
    await adapter.mkdir("Data");
    await adapter.mkdir("Data/RSS");
    await adapter.mkdir("Data/Research");
    await adapter.mkdir("Notes");

    await expect(
      listDirectorySuggestions(adapter, "Data/R"),
    ).resolves.toEqual(["Data/Research", "Data/RSS"]);
    await expect(
      listDirectorySuggestions(adapter, "../"),
    ).resolves.toEqual([]);
  });
});
