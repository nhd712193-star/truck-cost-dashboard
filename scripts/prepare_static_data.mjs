import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip, createGzip } from "node:zlib";
import { once } from "node:events";

const REQUIRED_ROLLUPS = new Set(["daily", "province", "ward", "order_index"]);
const COPIED_ROLLUPS = new Set(["daily", "province", "ward"]);

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
  rollups: rollups.filter((rollup) => COPIED_ROLLUPS.has(rollup.name)),
};

await writeFile(join(targetDir, "manifest.json"), `${JSON.stringify(deployManifest, null, 2)}\n`);

let totalBytes = Buffer.byteLength(JSON.stringify(deployManifest));
for (const rollup of deployManifest.rollups) {
  const sourceFile = join(sourceDir, rollup.file);
  const targetFile = join(targetDir, rollup.file);
  await mkdir(dirname(targetFile), { recursive: true });
  await copyFile(sourceFile, targetFile);
  totalBytes += rollup.size_bytes || 0;
}

const orderIndexRollup = rollups.find((rollup) => rollup.name === "order_index");
const orderIndexPartitions = await partitionOrderIndexByMonth(
  join(sourceDir, orderIndexRollup.file),
  join(targetDir, "rollups/order_index"),
);

deployManifest.order_index_partitions = orderIndexPartitions;
await writeFile(join(targetDir, "manifest.json"), `${JSON.stringify(deployManifest, null, 2)}\n`);
totalBytes += orderIndexPartitions.reduce((sum, partition) => sum + (partition.size_bytes || 0), 0);

const mb = totalBytes / 1024 / 1024;
console.log(`Prepared ${deployManifest.rollups.length} rollups and ${orderIndexPartitions.length} order_index partitions in ${targetDir}`);
console.log(`Approx data size: ${mb.toFixed(1)} MB`);

function csvFieldAt(line, targetIndex) {
  let field = "";
  let quote = false;
  let index = 0;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (quote) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quote = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quote = true;
    } else if (char === ",") {
      if (index === targetIndex) return field;
      field = "";
      index += 1;
    } else {
      field += char;
    }
  }

  return index === targetIndex ? field : "";
}

async function gzipWrite(stream, text) {
  if (!stream.write(text)) {
    await once(stream, "drain");
  }
}

async function closePartition(partition) {
  partition.gzip.end();
  await once(partition.output, "finish");
}

async function partitionOrderIndexByMonth(sourceFile, targetFolder) {
  await mkdir(targetFolder, { recursive: true });

  const reader = createInterface({
    input: createReadStream(sourceFile).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const writers = new Map();
  let header = "";
  let costDateIndex = -1;
  let costMonthIndex = -1;

  for await (const line of reader) {
    if (!header) {
      header = line;
      const columns = line.split(",");
      costDateIndex = columns.indexOf("cost_date");
      costMonthIndex = columns.indexOf("cost_month");
      if (costDateIndex === -1 || costMonthIndex === -1) {
        throw new Error("order_index.csv.gz must contain cost_date and cost_month columns");
      }
      continue;
    }

    if (!line) continue;

    const costDate = csvFieldAt(line, costDateIndex);
    const month = csvFieldAt(line, costMonthIndex) || costDate.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;

    if (!writers.has(month)) {
      const file = `rollups/order_index/month=${month}.csv.gz`;
      const outputPath = join(targetDir, file);
      await mkdir(dirname(outputPath), { recursive: true });
      const gzip = createGzip({ level: 9 });
      const output = createWriteStream(outputPath);
      gzip.pipe(output);
      writers.set(month, {
        month,
        file,
        path: outputPath,
        gzip,
        output,
        rows: 0,
        min_date: "",
        max_date: "",
      });
      await gzipWrite(gzip, `${header}\n`);
    }

    const writer = writers.get(month);
    writer.rows += 1;
    if (costDate) {
      if (!writer.min_date || costDate < writer.min_date) writer.min_date = costDate;
      if (!writer.max_date || costDate > writer.max_date) writer.max_date = costDate;
    }
    await gzipWrite(writer.gzip, `${line}\n`);
  }

  await Promise.all([...writers.values()].map(closePartition));

  const partitions = [];
  for (const writer of writers.values()) {
    const fileStat = await stat(writer.path);
    partitions.push({
      month: writer.month,
      file: writer.file,
      rows: writer.rows,
      min_date: writer.min_date,
      max_date: writer.max_date,
      size_bytes: fileStat.size,
    });
  }

  return partitions.sort((a, b) => a.month.localeCompare(b.month));
}
