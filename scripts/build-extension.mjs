// Packs extension/ into public/downloads/akt16-extension.zip (manifest at the archive root), using
// Node built-ins only: a minimal ZIP writer with deflate (zlib) and CRC-32.
// Entries use a fixed timestamp, so the same sources always give a byte-identical archive.
// Usage: node scripts/build-extension.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SOURCE = join(ROOT, "extension");
export const OUTPUT = join(ROOT, "public", "downloads", "akt16-extension.zip");
const SKIP = new Set(["README.md", ".DS_Store", "Thumbs.db"]);

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// 2026-01-01 00:00 in MS-DOS format.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const UTF8_NAMES = 0x0800;

/** files: [{ name: "path/in/zip", data: Buffer }] → ZIP archive as a Buffer. */
export function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(UTF8_NAMES, 8);
    entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    // extra length, comment length, disk number, internal attributes: 0
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) return [];
      return entry.isDirectory() ? listFiles(path) : [path];
    })
    .sort();
}

/** Reads extension/, checks that the manifest's files exist and returns the archive entries. */
export function collect(source = SOURCE) {
  const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
  const referenced = [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    ...(manifest.background?.scripts ?? []),
    ...(manifest.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
  ].filter(Boolean);
  for (const file of referenced) {
    if (!existsSync(join(source, file))) throw new Error(`manifest.json references missing file: ${file}`);
  }
  return listFiles(source).map((path) => ({ name: relative(source, path).split(sep).join("/"), data: readFileSync(path) }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const files = collect();
  const archive = zip(files);
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, archive);
  const { version } = JSON.parse(readFileSync(join(SOURCE, "manifest.json"), "utf8"));
  console.log(`Extension ${version}: ${files.length} files, ${(archive.length / 1024).toFixed(1)} KB → ${relative(ROOT, OUTPUT)}`);
}
