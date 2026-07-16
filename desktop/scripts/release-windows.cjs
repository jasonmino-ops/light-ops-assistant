const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { join, resolve } = require("node:path");
const pkg = require("../package.json");

const root = resolve(__dirname, "..");
const releaseDir = join(root, "release-ep-mb3-05a");
const releasePackage = "EP-MB3-05A";
const expectedInstaller = `E-Shop-Store-OS-Setup-${pkg.version}-${releasePackage}-x64.exe`;
const expectedBlockmap = `${expectedInstaller}.blockmap`;

function run(command, args, cwd = root) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && (command === "npm" || command === "npx"),
  });
}

function git(args, cwd = root) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

run("node", ["scripts/generate-icon.cjs"]);
run("node", ["scripts/prepare-provider.cjs"]);
run("npm", ["run", "compile"]);

const providerMetadataPath = join(root, "build", "provider", "provider-build-metadata.json");
const providerMetadata = existsSync(providerMetadataPath)
  ? JSON.parse(readFileSync(providerMetadataPath, "utf8"))
  : null;

const manifest = {
  product: "E-Shop Store OS",
  releasePackage,
  desktopVersion: pkg.version,
  providerVersion: null,
  desktopCommit: git(["rev-parse", "HEAD"], join(root, "..")),
  providerCommit: providerMetadata?.providerCommit ?? null,
  channel: process.env.ESHOP_RELEASE_CHANNEL ?? "stable",
  buildTime: new Date().toISOString(),
  platform: "win32",
  arch: "x64",
};

const providerManifestPath = join(root, "build", "provider", "eshop-windows-provider", "provider-manifest.json");
if (existsSync(providerManifestPath)) {
  manifest.providerVersion = JSON.parse(readFileSync(providerManifestPath, "utf8")).version ?? null;
}

writeFileSync(join(releaseDir, "build-manifest.json"), JSON.stringify(manifest, null, 2));
run("npx", ["electron-builder", "--win", "--x64", "--publish", "never"]);

const artifacts = readdirSync(releaseDir)
  .filter((name) => (
    name === expectedInstaller
    || name === expectedBlockmap
    || name === "latest.yml"
    || name === "build-manifest.json"
  ))
  .sort();
const lines = [];
const list = [];
for (const name of artifacts) {
  const file = join(releaseDir, name);
  if (statSync(file).isFile()) {
    const digest = sha256(file);
    lines.push(`${digest}  ${name}`);
    list.push({ filename: name, sizeBytes: statSync(file).size, sha256: digest });
  }
}
writeFileSync(join(releaseDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
writeFileSync(join(releaseDir, "artifact-list.json"), JSON.stringify(list, null, 2));
console.log(JSON.stringify(list, null, 2));
