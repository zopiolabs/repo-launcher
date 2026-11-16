"use strict";

// A deterministic, dependency-free ZIP writer using uncompressed entries.
const fs = require("node:fs");
const path = require("node:path");
const {createHash} = require("node:crypto");
const root = path.resolve(__dirname, "..");
const release = path.join(root, "release");
fs.mkdirSync(release, {recursive: true});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function files(directory, prefix = "") {
  return fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? files(path.join(directory, entry.name), name + "/") : entry.isFile() ? [name] : [];
  });
}

function archive(directory) {
  const names = files(directory);
  const local = [];
  const central = [];
  let offset = 0;
  for (const name of names) {
    const filename = Buffer.from(name, "utf8");
    const data = fs.readFileSync(path.join(directory, name));
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + data.length;
  }
  const directoryBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directoryBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryBuffer, end]);
}

const checksums = [];
for (const browser of ["chrome", "firefox"]) {
  const name = `repo-launcher-${browser}.zip`;
  const data = archive(path.join(root, browser));
  fs.writeFileSync(path.join(release, name), data);
  checksums.push(`${createHash("sha256").update(data).digest("hex")}  ${name}`);
}
fs.writeFileSync(path.join(release, "SHA256SUMS"), checksums.join("\n") + "\n");
console.log("Created release ZIPs and SHA256SUMS.");
