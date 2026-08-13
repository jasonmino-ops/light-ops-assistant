import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File } from "./pe-utils.mjs";

const packagingDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(packagingDirectory, "..");
const repeatRoot = path.join(packageDirectory, "build", "repeatability");
const first = path.join(repeatRoot, "first");
const second = path.join(repeatRoot, "second");
rmSync(repeatRoot, { recursive: true, force: true });

for (const output of [first, second]) {
  execFileSync(process.execPath, [path.join(packagingDirectory, "build-windows-sea.mjs"), "--output-dir", output], {
    cwd: packageDirectory,
    stdio: "inherit",
  });
}

const firstExe = path.join(first, "E-Shop-Printer-Tools.exe");
const secondExe = path.join(second, "E-Shop-Printer-Tools.exe");
const firstHash = sha256File(firstExe);
const secondHash = sha256File(secondExe);
const firstManifest = readFileSync(path.join(first, "artifact-manifest.json"), "utf8");
const secondManifest = readFileSync(path.join(second, "artifact-manifest.json"), "utf8");
const result = {
  repeatable: firstHash === secondHash && firstManifest === secondManifest,
  firstSha256: firstHash,
  secondSha256: secondHash,
  manifestsIdentical: firstManifest === secondManifest,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.repeatable) process.exitCode = 1;
