const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { inflateSync } = require("node:zlib");

const root = resolve(__dirname, "..");
const SOURCE_PNG = join(root, "assets", "branding", "eshop-official-avatar-640.png");
const BUILD_DIR = join(root, "build");
const OUTPUTS = [
  join(BUILD_DIR, "icon.ico"),
  join(BUILD_DIR, "installer-icon.ico"),
  join(BUILD_DIR, "uninstaller-icon.ico"),
];
const REQUIRED_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIGNATURE = "89504e470d0a1a0a";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parsePng(file) {
  if (!existsSync(file)) fail(`source PNG missing: ${file}`);
  const buffer = readFileSync(file);
  if (buffer.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) fail(`invalid PNG signature: ${file}`);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (width !== 640 || height !== 640) fail(`source PNG must be 640x640, got ${width}x${height}`);
  if (bitDepth !== 8) fail(`source PNG must be 8-bit, got ${bitDepth}`);
  if (colorType !== 2 && colorType !== 6) fail(`source PNG must be RGB or RGBA, got color type ${colorType}`);
  if (interlace !== 0) fail("interlaced PNG is not supported for deterministic icon generation");
  if (!idat.length) fail("source PNG has no IDAT data");

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 4);
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[sourceOffset++];
    const row = Buffer.from(raw.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    unfilterRow(row, previous, channels, filter);

    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      pixels[dst] = row[src];
      pixels[dst + 1] = row[src + 1];
      pixels[dst + 2] = row[src + 2];
      pixels[dst + 3] = channels === 4 ? row[src + 3] : 255;
    }
    previous = row;
  }

  return { width, height, pixels, sha256: createHash("sha256").update(buffer).digest("hex") };
}

function unfilterRow(row, previous, bpp, filter) {
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? row[i - bpp] : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bpp ? previous[i - bpp] ?? 0 : 0;
    if (filter === 0) continue;
    if (filter === 1) row[i] = (row[i] + left) & 0xff;
    else if (filter === 2) row[i] = (row[i] + up) & 0xff;
    else if (filter === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) row[i] = (row[i] + paeth(left, up, upLeft)) & 0xff;
    else fail(`unsupported PNG filter: ${filter}`);
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function resizeRgba(image, size) {
  const out = Buffer.alloc(size * size * 4);
  const scaleX = image.width / size;
  const scaleY = image.height / size;

  for (let y = 0; y < size; y++) {
    const srcY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(srcY));
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = srcY - y0;
    for (let x = 0; x < size; x++) {
      const srcX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.floor(srcX));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = srcX - x0;
      const dst = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const c00 = image.pixels[(y0 * image.width + x0) * 4 + channel];
        const c10 = image.pixels[(y0 * image.width + x1) * 4 + channel];
        const c01 = image.pixels[(y1 * image.width + x0) * 4 + channel];
        const c11 = image.pixels[(y1 * image.width + x1) * 4 + channel];
        const top = c00 + (c10 - c00) * fx;
        const bottom = c01 + (c11 - c01) * fx;
        out[dst + channel] = clampByte(top + (bottom - top) * fy);
      }
    }
  }
  return out;
}

function makeDib(rgba, size) {
  const headerSize = 40;
  const pixelBytes = size * size * 4;
  const maskStride = Math.ceil(size / 32) * 4;
  const maskBytes = maskStride * size;
  const dib = Buffer.alloc(headerSize + pixelBytes + maskBytes);

  dib.writeUInt32LE(headerSize, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(pixelBytes, 20);
  dib.writeInt32LE(0, 24);
  dib.writeInt32LE(0, 28);
  dib.writeUInt32LE(0, 32);
  dib.writeUInt32LE(0, 36);

  for (let y = 0; y < size; y++) {
    const sourceY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const src = (sourceY * size + x) * 4;
      const dst = headerSize + (y * size + x) * 4;
      dib[dst] = rgba[src + 2];
      dib[dst + 1] = rgba[src + 1];
      dib[dst + 2] = rgba[src];
      dib[dst + 3] = rgba[src + 3];
    }
  }
  return dib;
}

function makeIco(image) {
  const entries = REQUIRED_SIZES.map((size) => ({ size, dib: makeDib(resizeRgba(image, size), size) }));
  const headerBytes = 6 + entries.length * 16;
  const totalBytes = headerBytes + entries.reduce((sum, entry) => sum + entry.dib.length, 0);
  const ico = Buffer.alloc(totalBytes);

  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(entries.length, 4);

  let imageOffset = headerBytes;
  entries.forEach((entry, index) => {
    const dir = 6 + index * 16;
    ico[dir] = entry.size === 256 ? 0 : entry.size;
    ico[dir + 1] = entry.size === 256 ? 0 : entry.size;
    ico[dir + 2] = 0;
    ico[dir + 3] = 0;
    ico.writeUInt16LE(1, dir + 4);
    ico.writeUInt16LE(32, dir + 6);
    ico.writeUInt32LE(entry.dib.length, dir + 8);
    ico.writeUInt32LE(imageOffset, dir + 12);
    entry.dib.copy(ico, imageOffset);
    imageOffset += entry.dib.length;
  });

  return ico;
}

const source = parsePng(SOURCE_PNG);
const ico = makeIco(source);
mkdirSync(BUILD_DIR, { recursive: true });
for (const output of OUTPUTS) writeFileSync(output, ico);

console.log(JSON.stringify({
  source: "desktop/assets/branding/eshop-official-avatar-640.png",
  sourceSha256: source.sha256,
  outputs: OUTPUTS.map((file) => file.replace(`${root}/`, "desktop/")),
  sizes: REQUIRED_SIZES,
}, null, 2));
