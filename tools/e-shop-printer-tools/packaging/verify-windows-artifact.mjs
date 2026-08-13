import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPeArtifact } from "./pe-utils.mjs";

const packagingDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(packagingDirectory, "..");
const outputDirectory = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(packageDirectory, "dist", "windows");
const artifactPath = path.join(outputDirectory, "E-Shop-Printer-Tools.exe");
const manifestPath = path.join(outputDirectory, "artifact-manifest.json");
if (!existsSync(artifactPath) || !existsSync(manifestPath)) throw new Error("WINDOWS_ARTIFACT_OR_MANIFEST_MISSING");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const inspection = inspectPeArtifact(artifactPath, manifest.buildCommit);
const checks = {
  filename: inspection.filename === "E-Shop-Printer-Tools.exe",
  pe32Plus: inspection.format === "PE32+",
  x64: inspection.architecture === "x86-64",
  windowsGui: inspection.subsystemName === "WINDOWS_GUI",
  unsigned: inspection.codeSigned === false,
  seaResource: inspection.seaResourceMarkerFound === true,
  buildCommitEmbedded: inspection.buildCommitEmbedded === true,
  productNameEmbedded: inspection.productNameEmbedded === true,
  manifestHashMatches: inspection.sha256 === manifest.artifact.sha256,
  manifestSizeMatches: inspection.sizeBytes === manifest.artifact.sizeBytes,
  safeModeDefault: manifest.safeMode === true,
  writeOperationsDisabled: manifest.writeOperationsEnabled === false,
  windowsExecutionNotClaimed: manifest.windowsExecutionVerified === false,
};
const passed = Object.values(checks).every(Boolean);
const result = { passed, checks, inspection };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!passed) process.exitCode = 1;
