import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_ROLLUPS = new Set(["daily", "province", "ward", "order_index"]);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const projectDir = resolve(appDir, "..");
const sourceDir = resolve(process.argv[2] || join(projectDir, "truck_cost_pipeline/drive_output/data"));
const targetDir = resolve(process.argv[3] || join(appDir, "data"));

const manifestPath = join(sourceDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const rollups = (manifest.rollups || []).filter((rollup) => REQUIRED_ROLLUPS.has(rollup.name));

const missing = [...REQUIRED_ROLLUPS].filter((name) => !rollups.some((rollup) => rollup.name === name));
if (missing.length) {
  throw new Error(`Missing required rollups in manifest: ${missing.join(", ")}`);
}

await rm(targetDir, { recursive: true, force: true });
await mkdir(join(targetDir, "rollups"), { recursive: true });

const deployManifest = {
  generated_at: manifest.generated_at,
  format: manifest.format,
  rollups,
};

await writeFile(join(targetDir, "manifest.json"), `${JSON.stringify(deployManifest, null, 2)}\n`);

let totalBytes = Buffer.byteLength(JSON.stringify(deployManifest));
for (const rollup of rollups) {
  const sourceFile = join(sourceDir, rollup.file);
  const targetFile = join(targetDir, rollup.file);
  await mkdir(dirname(targetFile), { recursive: true });
  await copyFile(sourceFile, targetFile);
  totalBytes += rollup.size_bytes || 0;
}

const mb = totalBytes / 1024 / 1024;
console.log(`Prepared ${rollups.length} rollups in ${targetDir}`);
console.log(`Approx data size: ${mb.toFixed(1)} MB`);
