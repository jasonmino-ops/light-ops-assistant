const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const root = resolve(__dirname, "..");
const sourcePath = join(root, "assets", "branding", "eshop-official-avatar-640.png");
const outputPath = join(root, "release-ep-mb3-05a", "branding-verification.json");
const requiredSizes = [16, 24, 32, 48, 64, 128, 256];
const icoFiles = ["icon.ico", "installer-icon.ico", "uninstaller-icon.ico"].map((name) => join(root, "build", name));
const errors = [];

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function pngInfo(file) {
  if (!existsSync(file)) {
    errors.push(`missing source PNG: ${file}`);
    return null;
  }
  const buffer = readFileSync(file);
  const signatureOk = buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const info = {
    path: "desktop/assets/branding/eshop-official-avatar-640.png",
    signatureOk,
    width: signatureOk ? buffer.readUInt32BE(16) : 0,
    height: signatureOk ? buffer.readUInt32BE(20) : 0,
    bitDepth: signatureOk ? buffer[24] : 0,
    colorType: signatureOk ? buffer[25] : 0,
    sha256: sha256(file),
  };
  if (!info.signatureOk) errors.push("source PNG signature invalid");
  if (info.width !== 640 || info.height !== 640) errors.push(`source PNG dimensions invalid: ${info.width}x${info.height}`);
  return info;
}

function icoInfo(file) {
  if (!existsSync(file)) {
    errors.push(`missing ICO: ${file}`);
    return { path: file, valid: false, sizes: [] };
  }
  const buffer = readFileSync(file);
  const validHeader = buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1;
  const count = validHeader ? buffer.readUInt16LE(4) : 0;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16;
    entries.push({
      width: buffer[offset] || 256,
      height: buffer[offset + 1] || 256,
      planes: buffer.readUInt16LE(offset + 4),
      bitCount: buffer.readUInt16LE(offset + 6),
      bytesInRes: buffer.readUInt32LE(offset + 8),
      imageOffset: buffer.readUInt32LE(offset + 12),
    });
  }
  const sizes = entries.map((entry) => entry.width).sort((a, b) => a - b);
  for (const size of requiredSizes) {
    if (!sizes.includes(size)) errors.push(`${file} missing ${size}x${size}`);
  }
  for (const entry of entries) {
    if (entry.width !== entry.height) errors.push(`${file} contains non-square entry`);
    if (entry.bitCount !== 32) errors.push(`${file} contains non-32-bit entry`);
  }
  return {
    path: `desktop/build/${file.split(/[\\/]/).pop()}`,
    valid: validHeader,
    count,
    sizes,
    entries,
    sha256: sha256(file),
  };
}

const result = {
  ok: false,
  source: pngInfo(sourcePath),
  icoFiles: icoFiles.map(icoInfo),
  requiredSizes,
  builder: {
    output: "desktop/release-ep-mb3-05a",
    artifactName: "E-Shop-Store-OS-Setup-1.0.0-EP-MB3-05A-x64.exe",
  },
  errors,
};
result.ok = errors.length === 0;

mkdirSync(join(root, "release-ep-mb3-05a"), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
