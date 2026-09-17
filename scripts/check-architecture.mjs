import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const protectedDirectories = [
  "src/database/",
  "src/infrastructure/",
  "src/models/",
  "src/repositories/",
];
const errors = [];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(target)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(target);
    }
  }
  return files;
}

function resolveSource(file, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const candidate = path.resolve(path.dirname(file), specifier);
  return path.relative(root, candidate).replaceAll(path.sep, "/");
}

for (const file of await walk(path.join(root, "src"))) {
  const relativeFile = path.relative(root, file).replaceAll(path.sep, "/");
  if (!protectedDirectories.some((directory) => relativeFile.startsWith(directory))) {
    continue;
  }
  const source = await readFile(file, "utf8");
  const specifiers = [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
  for (const specifier of specifiers) {
    const target = resolveSource(file, specifier);
    if (target?.startsWith("src/services/")) {
      errors.push(`${relativeFile} imports service module ${specifier}`);
    }
  }
}

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

console.log("Architecture dependency boundaries passed.");
