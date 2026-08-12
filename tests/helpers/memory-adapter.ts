import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type {
  DataAdapter,
  DataWriteOptions,
  ListedFiles,
  Stat,
} from "obsidian";

export class MemoryAdapter implements DataAdapter {
  readonly root = mkdtempSync(join(tmpdir(), "academic-rss-reader-test-"));

  getName(): string {
    return "memory";
  }

  getFullPath(path: string): string {
    return this.resolve(path);
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(this.resolve(path));
  }

  async stat(path: string): Promise<Stat | null> {
    const resolved = this.resolve(path);
    if (!existsSync(resolved)) {
      return null;
    }
    const stat = statSync(resolved);
    return {
      type: stat.isDirectory() ? "folder" : "file",
      ctime: stat.ctimeMs,
      mtime: stat.mtimeMs,
      size: stat.isDirectory() ? 0 : stat.size,
    };
  }

  async list(path: string): Promise<ListedFiles> {
    const normalized = clean(path);
    const resolved = this.resolve(normalized);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new Error(`Folder does not exist: ${normalized}`);
    }
    const files: string[] = [];
    const folders: string[] = [];
    for (const entry of readdirSync(resolved, { withFileTypes: true })) {
      const child = normalized ? `${normalized}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        folders.push(child);
      } else {
        files.push(child);
      }
    }
    return { files, folders };
  }

  async read(path: string): Promise<string> {
    return readFileSync(this.resolve(path), "utf8");
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const bytes = readFileSync(this.resolve(path));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  async write(
    path: string,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> {
    await this.writeBinary(path, new TextEncoder().encode(data).buffer, options);
  }

  async writeBinary(
    path: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<void> {
    const resolved = this.resolve(path);
    this.assertParent(resolved);
    writeFileSync(resolved, Buffer.from(data));
  }

  async append(
    path: string,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> {
    const resolved = this.resolve(path);
    this.assertParent(resolved);
    writeFileSync(resolved, `${existsSync(resolved) ? readFileSync(resolved, "utf8") : ""}${data}`);
  }

  async appendBinary(
    path: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<void> {
    const resolved = this.resolve(path);
    this.assertParent(resolved);
    writeFileSync(resolved, Buffer.concat([
      existsSync(resolved) ? readFileSync(resolved) : Buffer.alloc(0),
      Buffer.from(data),
    ]));
  }

  async process(
    path: string,
    callback: (data: string) => string,
    options?: DataWriteOptions,
  ): Promise<string> {
    const result = callback(await this.read(path));
    await this.write(path, result, options);
    return result;
  }

  getResourcePath(path: string): string {
    return `memory://${clean(path)}`;
  }

  async mkdir(path: string): Promise<void> {
    const resolved = this.resolve(path);
    const parent = resolve(resolved, "..");
    if (!existsSync(parent)) {
      throw new Error(`Parent folder does not exist: ${clean(path)}`);
    }
    mkdirSync(resolved);
  }

  async trashSystem(path: string): Promise<boolean> {
    await this.remove(path);
    return true;
  }

  async trashLocal(path: string): Promise<void> {
    await this.remove(path);
  }

  async rmdir(path: string, recursive: boolean): Promise<void> {
    rmSync(this.resolve(path), { recursive, force: false });
  }

  async remove(path: string): Promise<void> {
    rmSync(this.resolve(path));
  }

  async rename(path: string, newPath: string): Promise<void> {
    const source = this.resolve(path);
    const destination = this.resolve(newPath);
    if (!existsSync(source) || existsSync(destination)) {
      throw new Error(`Cannot rename ${path} to ${newPath}`);
    }
    renameSync(source, destination);
  }

  async copy(path: string, newPath: string): Promise<void> {
    const source = this.resolve(path);
    const destination = this.resolve(newPath);
    if (!existsSync(source) || existsSync(destination)) {
      throw new Error(`Cannot copy ${path} to ${newPath}`);
    }
    this.assertParent(destination);
    copyFileSync(source, destination);
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }

  private resolve(path: string): string {
    const normalized = clean(path);
    const resolved = resolve(this.root, normalized);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}/`)) {
      throw new Error(`Path escapes test Vault: ${path}`);
    }
    return resolved;
  }

  private assertParent(path: string): void {
    if (!existsSync(resolve(path, ".."))) {
      throw new Error(`Parent folder does not exist: ${relative(this.root, path)}`);
    }
  }
}

function clean(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}
