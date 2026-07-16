const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const size = 256;
const headerSize = 40;
const pixelBytes = size * size * 4;
const maskStride = Math.ceil(size / 32) * 4;
const maskBytes = maskStride * size;
const dibSize = headerSize + pixelBytes + maskBytes;
const ico = Buffer.alloc(6 + 16 + dibSize);

ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = 0;
ico[7] = 0;
ico[8] = 0;
ico[9] = 0;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(dibSize, 14);
ico.writeUInt32LE(22, 18);

const dib = ico.subarray(22);
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

function clamp(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function setPixel(x, y, r, g, b, a = 255) {
  const row = size - 1 - y;
  const offset = headerSize + (row * size + x) * 4;
  dib[offset] = clamp(b);
  dib[offset + 1] = clamp(g);
  dib[offset + 2] = clamp(r);
  dib[offset + 3] = clamp(a);
}

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const nx = (x - size / 2) / (size / 2);
    const ny = (y - size / 2) / (size / 2);
    const d = Math.sqrt(nx * nx + ny * ny);
    if (d > 0.92) {
      setPixel(x, y, 0, 0, 0, 0);
      continue;
    }
    const t = y / (size - 1);
    setPixel(x, y, 18 + 14 * t, 92 + 80 * t, 148 + 70 * t, 255);
  }
}

for (let y = 58; y < 198; y++) {
  for (let x = 54; x < 202; x++) {
    const edge = x < 62 || x >= 194 || y < 66 || y >= 190;
    setPixel(x, y, edge ? 236 : 248, edge ? 244 : 250, edge ? 248 : 252, 255);
  }
}

for (let y = 86; y < 102; y++) {
  for (let x = 84; x < 172; x++) setPixel(x, y, 26, 112, 184, 255);
}

for (let y = 122; y < 138; y++) {
  for (let x = 84; x < 152; x++) setPixel(x, y, 230, 71, 80, 255);
}

for (let y = 158; y < 174; y++) {
  for (let x = 84; x < 184; x++) setPixel(x, y, 36, 148, 112, 255);
}

mkdirSync(join(__dirname, "..", "build"), { recursive: true });
writeFileSync(join(__dirname, "..", "build", "icon.ico"), ico);
console.log("generated desktop/build/icon.ico");
