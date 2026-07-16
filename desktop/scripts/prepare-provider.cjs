const { existsSync, mkdirSync, cpSync, rmSync, writeFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { join, resolve } = require("node:path");

const desktopRoot = resolve(__dirname, "..");
const providerRoot = resolve(process.env.ESHOP_PROVIDER_SOURCE ?? join(desktopRoot, "..", "..", "eshop-windows-provider"));
const providerArtifact = join(providerRoot, "artifacts", "eshop-windows-provider");
const stagedRoot = join(desktopRoot, "build", "provider");
const stagedProvider = join(stagedRoot, "eshop-windows-provider");

function run(command, args, cwd) {
  const executable = process.platform === "win32" && (command === "npm" || command === "npx")
    ? `${command}.cmd`
    : command;
  console.log(`> ${command} ${args.join(" ")} (${cwd})`);
  execFileSync(executable, args, { cwd, stdio: "inherit" });
}

if (!existsSync(join(providerRoot, "package.json"))) {
  throw new Error(`Provider source not found: ${providerRoot}`);
}

run("npm", ["run", "build"], providerRoot);
if (process.platform === "win32") {
  run("npm", ["run", "helper:publish"], providerRoot);
} else {
  console.warn("Provider helper publish skipped outside Windows; release installer verification will require Windows CI.");
}
run("npm", ["run", "package"], providerRoot);

if (!existsSync(providerArtifact)) {
  throw new Error(`Provider artifact missing after package: ${providerArtifact}`);
}

rmSync(stagedRoot, { recursive: true, force: true });
mkdirSync(stagedRoot, { recursive: true });
cpSync(providerArtifact, stagedProvider, { recursive: true });

const git = (args) => execFileSync("git", args, { cwd: providerRoot, encoding: "utf8" }).trim();
const metadata = {
  providerRepository: providerRoot,
  providerCommit: git(["rev-parse", "HEAD"]),
  providerBranch: git(["branch", "--show-current"]),
  sourceArtifact: providerArtifact,
  stagedArtifact: stagedProvider,
  stagedAt: new Date().toISOString(),
};
writeFileSync(join(stagedRoot, "provider-build-metadata.json"), JSON.stringify(metadata, null, 2));
console.log(`staged provider -> ${stagedProvider}`);
