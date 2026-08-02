import {
  copyFile,
  mkdir,
  readFile,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(join(projectRoot, "manifest.json"), "utf8"),
);

if (manifest.id !== "academic-rss-reader") {
  throw new Error(`Unexpected plugin id: ${String(manifest.id)}`);
}
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error(`Invalid plugin version: ${String(manifest.version)}`);
}

const buildRoot = join(projectRoot, "build");
const requiredFiles = [
  "main.js",
  "manifest.json",
  "styles.css",
];

await rm(buildRoot, { recursive: true, force: true });
await mkdir(buildRoot, { recursive: true });

for (const fileName of requiredFiles) {
  await copyFile(
    join(projectRoot, fileName),
    join(buildRoot, fileName),
  );
}

process.stdout.write(
  [
    `Plugin files: ${buildRoot}`,
    ...requiredFiles.map((fileName) => `- ${join(buildRoot, fileName)}`),
    "",
  ].join("\n"),
);
