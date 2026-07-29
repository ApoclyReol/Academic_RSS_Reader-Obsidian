import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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
const obsidianRoot = join(buildRoot, "obsidian");
const pluginDirectory = join(obsidianRoot, manifest.id);
const zipName = `Academic-RSS-Reader-${manifest.version}.zip`;
const zipPath = join(buildRoot, zipName);
const requiredFiles = [
  "main.js",
  "manifest.json",
  "styles.css",
];

await rm(buildRoot, { recursive: true, force: true });
await mkdir(pluginDirectory, { recursive: true });

for (const fileName of requiredFiles) {
  await copyFile(
    join(projectRoot, fileName),
    join(pluginDirectory, fileName),
  );
}

const zip = spawnSync(
  "zip",
  ["-q", "-r", zipPath, manifest.id],
  {
    cwd: obsidianRoot,
    encoding: "utf8",
  },
);
if (zip.status !== 0) {
  throw new Error(zip.stderr || "Failed to create release ZIP");
}

const checksumLines = [];
for (const fileName of requiredFiles) {
  checksumLines.push(
    `${await sha256(join(pluginDirectory, fileName))}  build/obsidian/${manifest.id}/${fileName}`,
  );
}
checksumLines.push(`${await sha256(zipPath)}  build/${zipName}`);
await writeFile(
  join(buildRoot, "SHA256SUMS.txt"),
  `${checksumLines.join("\n")}\n`,
  "utf8",
);

process.stdout.write(
  [
    `Plugin directory: ${pluginDirectory}`,
    `ZIP archive: ${zipPath}`,
    `Checksums: ${join(buildRoot, "SHA256SUMS.txt")}`,
    "",
  ].join("\n"),
);

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
