import type {
  DataAdapter,
  DataWriteOptions,
  ListedFiles,
  Stat,
} from "obsidian";

export class MemoryAdapter implements DataAdapter {
  private readonly files = new Map<
    string,
    { bytes: Uint8Array; ctime: number; mtime: number }
  >();
  private readonly folders = new Set<string>([""]);

  getName(): string {
    return "memory";
  }

  async exists(path: string): Promise<boolean> {
    const normalized = clean(path);
    return this.files.has(normalized) || this.folders.has(normalized);
  }

  async stat(path: string): Promise<Stat | null> {
    const normalized = clean(path);
    const file = this.files.get(normalized);
    if (file) {
      return {
        type: "file",
        ctime: file.ctime,
        mtime: file.mtime,
        size: file.bytes.byteLength,
      };
    }
    return this.folders.has(normalized)
      ? { type: "folder", ctime: 0, mtime: 0, size: 0 }
      : null;
  }

  async list(path: string): Promise<ListedFiles> {
    const normalized = clean(path);
    if (!this.folders.has(normalized)) {
      throw new Error(`Folder does not exist: ${normalized}`);
    }
    const prefix = normalized ? `${normalized}/` : "";
    const files = [...this.files.keys()].filter(
      (candidate) =>
        candidate.startsWith(prefix) &&
        !candidate.slice(prefix.length).includes("/"),
    );
    const folders = [...this.folders].filter(
      (candidate) =>
        candidate.startsWith(prefix) &&
        candidate !== normalized &&
        !candidate.slice(prefix.length).includes("/"),
    );
    return { files, folders };
  }

  async read(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.files.get(clean(path));
    if (!file) {
      throw new Error(`File does not exist: ${path}`);
    }
    return file.bytes.slice().buffer;
  }

  async write(
    path: string,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> {
    await this.writeBinary(
      path,
      new TextEncoder().encode(data).buffer,
      options,
    );
  }

  async writeBinary(
    path: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<void> {
    const normalized = clean(path);
    const parent = parentPath(normalized);
    if (!this.folders.has(parent)) {
      throw new Error(`Parent folder does not exist: ${parent}`);
    }
    const previous = this.files.get(normalized);
    const now = Date.now();
    this.files.set(normalized, {
      bytes: new Uint8Array(data.slice(0)),
      ctime: options?.ctime ?? previous?.ctime ?? now,
      mtime: options?.mtime ?? now,
    });
  }

  async append(
    path: string,
    data: string,
    options?: DataWriteOptions,
  ): Promise<void> {
    const current = (await this.exists(path)) ? await this.read(path) : "";
    await this.write(path, current + data, options);
  }

  async appendBinary(
    path: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<void> {
    const current = (await this.exists(path))
      ? new Uint8Array(await this.readBinary(path))
      : new Uint8Array();
    const appended = new Uint8Array(current.byteLength + data.byteLength);
    appended.set(current);
    appended.set(new Uint8Array(data), current.byteLength);
    await this.writeBinary(path, appended.buffer, options);
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
    const normalized = clean(path);
    const parent = parentPath(normalized);
    if (!this.folders.has(parent)) {
      throw new Error(`Parent folder does not exist: ${parent}`);
    }
    this.folders.add(normalized);
  }

  async trashSystem(path: string): Promise<boolean> {
    await this.remove(path);
    return true;
  }

  async trashLocal(path: string): Promise<void> {
    await this.remove(path);
  }

  async rmdir(path: string, recursive: boolean): Promise<void> {
    const normalized = clean(path);
    const prefix = `${normalized}/`;
    const hasChildren =
      [...this.files.keys(), ...this.folders].some((candidate) =>
        candidate.startsWith(prefix),
      );
    if (hasChildren && !recursive) {
      throw new Error(`Folder is not empty: ${normalized}`);
    }
    for (const candidate of [...this.files.keys()]) {
      if (candidate.startsWith(prefix)) {
        this.files.delete(candidate);
      }
    }
    for (const candidate of [...this.folders]) {
      if (candidate === normalized || candidate.startsWith(prefix)) {
        this.folders.delete(candidate);
      }
    }
  }

  async remove(path: string): Promise<void> {
    if (!this.files.delete(clean(path))) {
      throw new Error(`File does not exist: ${path}`);
    }
  }

  async rename(path: string, newPath: string): Promise<void> {
    const source = clean(path);
    const destination = clean(newPath);
    const file = this.files.get(source);
    if (!file || (await this.exists(destination))) {
      throw new Error(`Cannot rename ${source} to ${destination}`);
    }
    this.files.set(destination, file);
    this.files.delete(source);
  }

  async copy(path: string, newPath: string): Promise<void> {
    const source = this.files.get(clean(path));
    if (!source || (await this.exists(newPath))) {
      throw new Error(`Cannot copy ${path} to ${newPath}`);
    }
    await this.writeBinary(newPath, source.bytes.slice().buffer);
  }
}

function clean(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function parentPath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}
