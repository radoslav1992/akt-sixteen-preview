// The extension package: a ZIP written with Node built-ins must round-trip and carry a valid manifest.
import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { collect, crc32, zip } from "../scripts/build-extension.mjs";

function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const localNameLen = buf.readUInt16LE(offset + 26);
    const body = buf.subarray(offset + 30 + localNameLen, offset + 30 + localNameLen + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(crc32(data), name).toBe(crc);
    files.set(name, data);
    p += 46 + nameLen;
  }
  return files;
}

describe("extension package", () => {
  it("computes standard CRC-32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("round-trips every file with the manifest at the root", () => {
    const files = collect();
    const names = files.map((f) => f.name);
    expect(names).toContain("manifest.json");
    expect(names).not.toContain("README.md");
    for (const size of [16, 32, 48, 128]) expect(names).toContain(`icons/icon-${size}.png`);

    const out = unzip(zip(files));
    expect([...out.keys()]).toEqual(names);
    for (const f of files) expect(out.get(f.name).equals(f.data), f.name).toBe(true);

    const manifest = JSON.parse(out.get("manifest.json").toString("utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.permissions).toEqual(["contextMenus", "storage"]);
    expect(manifest.host_permissions).toEqual(["https://akt16.org/*"]);
    expect(manifest.browser_specific_settings.gecko.id).toBe("extension@akt16.org");
    expect(manifest.content_scripts[0].js).toEqual(["extract.js", "content.js"]);
  });

  it("is reproducible", () => {
    const files = collect();
    expect(zip(files).equals(zip(files))).toBe(true);
  });
});
