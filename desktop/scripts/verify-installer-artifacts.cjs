const { existsSync, readdirSync, readFileSync, statSync } = require("node:fs");
const { join, resolve } = require("node:path");
const pkg = require("../package.json");

const root = resolve(__dirname, "..");
const releaseDir = join(root, "release");
const providerDir = join(root, "build", "provider", "eshop-windows-provider");
const errors = [];

function requireFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) errors.push(`${label} missing: ${path}`);
}

const expectedInstaller = `E-Shop-Store-OS-Setup-${pkg.version}-x64.exe`;
requireFile(join(releaseDir, expectedInstaller), "installer");
requireFile(join(releaseDir, "SHA256SUMS.txt"), "SHA256SUMS");
requireFile(join(releaseDir, "build-manifest.json"), "build manifest");
requireFile(join(releaseDir, "artifact-list.json"), "artifact list");
requireFile(join(providerDir, "dist", "index.js"), "provider entry");
requireFile(join(providerDir, "provider-manifest.json"), "provider manifest");
requireFile(join(providerDir, "helper", "win-x64", "eshop-print-helper.exe"), "provider print helper");

const forbidden = [".env", ".env.local"];
for (const name of readdirSync(releaseDir, { withFileTypes: true }).map((entry) => entry.name)) {
  if (forbidden.includes(name)) errors.push(`forbidden file in release: ${name}`);
}

if (existsSync(join(releaseDir, "build-manifest.json"))) {
  const manifest = JSON.parse(readFileSync(join(releaseDir, "build-manifest.json"), "utf8"));
  if (manifest.product !== "E-Shop Store OS") errors.push("manifest product mismatch");
  if (manifest.desktopVersion !== pkg.version) errors.push("manifest desktopVersion mismatch");
  if (!manifest.desktopCommit) errors.push("manifest desktopCommit missing");
  if (!manifest.providerCommit) errors.push("manifest providerCommit missing");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("installer artifact static verification passed");
