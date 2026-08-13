import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { build } from "esbuild";
import { inspectPeArtifact, setWindowsGuiSubsystem, sha256File, stripPeAuthenticode } from "./pe-utils.mjs";

const packagingDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(packagingDirectory, "..");
const repositoryDirectory = path.resolve(packageDirectory, "../..");
const nodeVersion = "24.14.0";
const archiveName = `node-v${nodeVersion}-win-x64.zip`;
const releaseBaseUrl = `https://nodejs.org/dist/v${nodeVersion}`;
const sentinelFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function outputArgument() {
  const index = process.argv.indexOf("--output-dir");
  if (index < 0) return path.join(packageDirectory, "dist", "windows");
  const value = process.argv[index + 1];
  if (!value) throw new Error("--output-dir requires a path");
  return path.resolve(process.cwd(), value);
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function download(url, outputPath) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`DOWNLOAD_FAILED ${response.status}: ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, data);
  return data;
}

function expectedArchiveHash(shasums) {
  const line = shasums.split(/\r?\n/).find((entry) => entry.trim().endsWith(`  ${archiveName}`));
  if (!line) throw new Error(`ARCHIVE_HASH_NOT_FOUND: ${archiveName}`);
  const hash = line.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error("INVALID_ARCHIVE_HASH");
  return hash.toLowerCase();
}

async function ensureWindowsNode(cacheDirectory) {
  mkdirSync(cacheDirectory, { recursive: true });
  const archivePath = path.join(cacheDirectory, archiveName);
  const shasumsPath = path.join(cacheDirectory, `node-v${nodeVersion}-SHASUMS256.txt`);
  if (!existsSync(shasumsPath)) await download(`${releaseBaseUrl}/SHASUMS256.txt`, shasumsPath);
  if (!existsSync(archivePath)) await download(`${releaseBaseUrl}/${archiveName}`, archivePath);
  const expectedHash = expectedArchiveHash(readFileSync(shasumsPath, "utf8"));
  const actualHash = sha256File(archivePath);
  if (actualHash !== expectedHash) throw new Error(`NODE_ARCHIVE_HASH_MISMATCH: ${actualHash}`);

  const extractedDirectory = path.join(cacheDirectory, `node-v${nodeVersion}-win-x64`);
  const runtimePath = path.join(extractedDirectory, "node.exe");
  if (!existsSync(runtimePath)) new AdmZip(archivePath).extractAllTo(cacheDirectory, true);
  if (!existsSync(runtimePath)) throw new Error("WINDOWS_NODE_RUNTIME_NOT_EXTRACTED");
  return { runtimePath, archivePath, archiveSha256: actualHash, expectedArchiveHash: expectedHash };
}

function assertLocalNodeVersion() {
  if (process.version !== `v${nodeVersion}`) {
    throw new Error(`BUILD_NODE_VERSION_MISMATCH: expected v${nodeVersion}, got ${process.version}`);
  }
}

async function main() {
  assertLocalNodeVersion();
  const outputDirectory = outputArgument();
  const workDirectory = path.join(packageDirectory, "build", "sea");
  const cacheDirectory = path.join(packageDirectory, "build", "cache");
  rmSync(workDirectory, { recursive: true, force: true });
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(workDirectory, { recursive: true });
  mkdirSync(outputDirectory, { recursive: true });

  const buildCommit = (process.env.E_SHOP_BUILD_COMMIT || execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryDirectory,
    encoding: "utf8",
  })).trim();
  if (!/^[0-9a-f]{40}$/.test(buildCommit)) throw new Error(`INVALID_BUILD_COMMIT: ${buildCommit}`);

  const launcherScript = readFileSync(path.join(packageDirectory, "src", "app", "winformsLauncher.ps1"), "utf8");
  const bundledMain = path.join(workDirectory, "review-app.cjs");
  await build({
    entryPoints: [path.join(packageDirectory, "src", "app", "main.ts")],
    outfile: bundledMain,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    legalComments: "none",
    sourcemap: false,
    minify: false,
    define: {
      __BUILD_COMMIT__: JSON.stringify(buildCommit),
      __WINFORMS_SCRIPT__: JSON.stringify(launcherScript),
    },
  });

  const seaBlob = path.join(workDirectory, "sea-prep.blob");
  const seaConfig = path.join(workDirectory, "sea-config.json");
  writeFileSync(seaConfig, `${JSON.stringify({
    main: bundledMain,
    output: seaBlob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }, null, 2)}\n`);
  execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

  const runtime = await ensureWindowsNode(cacheDirectory);
  const artifactPath = path.join(outputDirectory, "E-Shop-Printer-Tools.exe");
  copyFileSync(runtime.runtimePath, artifactPath);
  const signatureRemoval = stripPeAuthenticode(artifactPath);

  const postjectCli = path.join(packageDirectory, "node_modules", "postject", "dist", "cli.js");
  execFileSync(process.execPath, [
    postjectCli,
    artifactPath,
    "NODE_SEA_BLOB",
    seaBlob,
    "--sentinel-fuse",
    sentinelFuse,
  ], { stdio: "inherit" });
  setWindowsGuiSubsystem(artifactPath);

  const pe = inspectPeArtifact(artifactPath, buildCommit);
  if (pe.architecture !== "x86-64") throw new Error(`ARTIFACT_ARCHITECTURE_INVALID: ${pe.architecture}`);
  if (pe.subsystemName !== "WINDOWS_GUI") throw new Error(`ARTIFACT_SUBSYSTEM_INVALID: ${pe.subsystemName}`);
  if (pe.codeSigned) throw new Error("REVIEW_ARTIFACT_MUST_REPORT_UNSIGNED");
  if (!pe.seaResourceMarkerFound) throw new Error("NODE_SEA_RESOURCE_NOT_FOUND");
  if (!pe.buildCommitEmbedded || !pe.productNameEmbedded) throw new Error("PRODUCT_METADATA_NOT_EMBEDDED");

  const manifest = {
    productName: "E-Shop Printer Tools",
    version: "P0.5",
    buildCommit,
    safeMode: true,
    writeOperationsEnabled: false,
    packagingTechnology: "Node.js Single Executable Application (SEA) + postject",
    guiTechnology: "Windows PowerShell 5.1 / .NET Framework WinForms launcher",
    targetPlatform: "Windows",
    targetArchitecture: "x64",
    runtimeDependencies: [
      "Windows PowerShell 5.1",
      ".NET Framework WinForms (Windows inbox component)",
    ],
    codeSigned: false,
    fieldVerification: "NOT_FIELD_VERIFIED",
    windowsExecutionVerified: false,
    buildCommand: "npm run package:windows",
    artifact: pe,
    nodeRuntime: {
      version: nodeVersion,
      sourceUrl: `${releaseBaseUrl}/${archiveName}`,
      archiveSha256: runtime.archiveSha256,
      archiveHashVerifiedAgainst: `${releaseBaseUrl}/SHASUMS256.txt`,
      signatureRemovedBeforeInjection: signatureRemoval.removedCertificateSize > 0,
    },
    bundle: {
      sha256: sha256(readFileSync(bundledMain)),
      seaUseSnapshot: false,
      seaUseCodeCache: false,
    },
  };
  writeFileSync(path.join(outputDirectory, "artifact-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(outputDirectory, "INDEPENDENT-REVIEW.txt"), [
    "E-Shop Printer Tools P0.5 — Independent Review",
    "",
    `Build Commit: ${buildCommit}`,
    `Artifact SHA-256: ${pe.sha256}`,
    `Artifact Size: ${pe.sizeBytes} bytes`,
    "Target: Windows x64 (PE32+ GUI)",
    "Code Signed: NO",
    "SAFE_MODE Default: true",
    "Write Operations Enabled: NO",
    "Windows Execution Verified: NO",
    "Field Verification: NOT FIELD VERIFIED",
    "",
    "The review build can read Windows network state, enumerate USB printers, send MP4200FIND,",
    "parse MP4200FOUND, connect-probe TCP 9100, and generate provisioning/queue previews.",
    "It has no UI or local API route for MP4200SAVE, queue mutation, driver installation, or printing.",
    "",
    "Local log: %LOCALAPPDATA%\\E-Shop Printer Tools\\logs\\e-shop-printer-tools.log",
    "",
  ].join("\r\n"));
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

await main();
