import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ZERO_OID = /^0+$/;
const CHERRY_PICK_RE = /\(cherry picked from commit ([0-9a-f]{40})\)/g;

export class ProvenanceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function git(repoRoot, args, { encoding = "utf8", allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: encoding === null ? null : encoding,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new ProvenanceError("GIT_EXECUTION", result.error.message);
  }
  if (!allowFailure && result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new ProvenanceError("UNKNOWN_GIT_OBJECT", detail || `git ${args.join(" ")} failed`);
  }
  return result;
}

function gitText(repoRoot, args, options = {}) {
  return String(git(repoRoot, args, options).stdout || "");
}

export function resolveCommit(repoRoot, ref) {
  if (typeof ref !== "string" || !ref.trim()) {
    throw new ProvenanceError("MISSING_REF", "commit/ref is required");
  }
  const result = git(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`], { allowFailure: true });
  const resolved = String(result.stdout || "").trim();
  if (result.status !== 0 || !FULL_SHA.test(resolved)) {
    throw new ProvenanceError("UNKNOWN_GIT_OBJECT", `cannot resolve commit: ${ref}`);
  }
  return resolved;
}

export function parents(repoRoot, commit) {
  const line = gitText(repoRoot, ["show", "-s", "--format=%P", commit]).trim();
  return line ? line.split(/\s+/) : [];
}

export function tree(repoRoot, commit) {
  return gitText(repoRoot, ["rev-parse", `${commit}^{tree}`]).trim();
}

export function isAncestor(repoRoot, ancestor, descendant) {
  const result = git(repoRoot, ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new ProvenanceError("UNKNOWN_GIT_OBJECT", `cannot compare ${ancestor} to ${descendant}`);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function blobBytes(repoRoot, oid) {
  if (ZERO_OID.test(oid)) return Buffer.alloc(0);
  const result = git(repoRoot, ["cat-file", "blob", oid], { encoding: null });
  return result.stdout;
}

function isForbiddenPath(filePath) {
  return filePath === "prisma/schema.prisma" || filePath.startsWith("prisma/migrations/");
}

function parseRawDiff(repoRoot, parent, commit) {
  const result = git(repoRoot, ["diff", "--raw", "-z", "--no-ext-diff", "--find-renames=1%", "--find-copies=1%", parent, commit, "--"], { encoding: null });
  const fields = result.stdout.toString("utf8").split("\0");
  const entries = [];
  for (let index = 0; index < fields.length - 1;) {
    const header = fields[index++];
    if (!header) continue;
    const filePath = fields[index++];
    const parts = header.slice(1).trim().split(/\s+/);
    if (parts.length < 5 || !filePath) {
      throw new ProvenanceError("UNKNOWN_GIT_OBJECT", `unparseable raw diff for ${commit}`);
    }
    const [oldMode, newMode, oldOid, newOid, status] = parts;
    const statusCode = status[0];
    let destinationPath = filePath;
    if (statusCode === "R" || statusCode === "C") {
      destinationPath = fields[index++];
    }
    entries.push({ oldMode, newMode, oldOid, newOid, statusCode, filePath, destinationPath });
  }
  return entries;
}

function isBinary(repoRoot, parent, commit, filePath) {
  const result = git(repoRoot, ["diff", "--numstat", "--no-ext-diff", parent, commit, "--", filePath], { allowFailure: true });
  if (result.status !== 0) {
    throw new ProvenanceError("UNKNOWN_GIT_OBJECT", `cannot inspect ${filePath}`);
  }
  return /^-\t-\t/.test(String(result.stdout || ""));
}

export function fingerprintCommit(repoRoot, commit) {
  const commitSha = resolveCommit(repoRoot, commit);
  const commitParents = parents(repoRoot, commitSha);
  if (commitParents.length !== 1) {
    throw new ProvenanceError("MERGE_COMMIT", `${commitSha} is not a single-parent commit`);
  }
  const parent = commitParents[0];
  const rawEntries = parseRawDiff(repoRoot, parent, commitSha);
  const entries = rawEntries.map((entry) => {
    const paths = [entry.filePath, entry.destinationPath];
    if (paths.some(isForbiddenPath)) {
      throw new ProvenanceError("SCHEMA_OR_MIGRATION", `${commitSha} touches ${paths.find(isForbiddenPath)}`);
    }
    if (entry.statusCode === "R" || entry.statusCode === "C") {
      throw new ProvenanceError("RENAME_OR_COPY", `${commitSha} contains ${entry.statusCode === "R" ? "rename" : "copy"}`);
    }
    if (
      entry.statusCode === "T" ||
      (entry.oldMode !== "000000" && entry.newMode !== "000000" && entry.oldMode !== entry.newMode)
    ) {
      throw new ProvenanceError("MODE_CHANGE", `${commitSha} changes file mode for ${entry.destinationPath}`);
    }
    if (entry.oldMode === "160000" || entry.newMode === "160000") {
      throw new ProvenanceError("SUBMODULE", `${commitSha} touches a submodule`);
    }
    if (isBinary(repoRoot, parent, commitSha, entry.destinationPath)) {
      throw new ProvenanceError("BINARY_FILE", `${commitSha} touches binary file ${entry.destinationPath}`);
    }
    const oldBytes = blobBytes(repoRoot, entry.oldOid);
    const newBytes = blobBytes(repoRoot, entry.newOid);
    return {
      path: entry.destinationPath,
      status: entry.statusCode,
      oldMode: entry.oldMode,
      newMode: entry.newMode,
      oldBytes: oldBytes.length,
      newBytes: newBytes.length,
      oldSha256: sha256(oldBytes),
      newSha256: sha256(newBytes),
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const canonical = JSON.stringify(entries);
  return {
    commit: commitSha,
    parent,
    entries,
    fingerprint: sha256(Buffer.from(canonical, "utf8")),
  };
}

function cherryPickSources(repoRoot, commit) {
  const message = gitText(repoRoot, ["show", "-s", "--format=%B", commit]);
  const matches = [...message.matchAll(CHERRY_PICK_RE)].map((match) => match[1]);
  return [...new Set(matches)];
}

function linearDelta(repoRoot, base, tip) {
  if (!isAncestor(repoRoot, base, tip)) {
    throw new ProvenanceError("RELEASE_BASE_NOT_ANCESTOR", `${base} is not an ancestor of ${tip}`);
  }
  const commits = gitText(repoRoot, ["rev-list", "--reverse", "--ancestry-path", `${base}..${tip}`])
    .trim().split(/\s+/).filter(Boolean);
  let previous = base;
  for (const commit of commits) {
    const commitParents = parents(repoRoot, commit);
    if (commitParents.length !== 1 || commitParents[0] !== previous) {
      throw new ProvenanceError("RELEASE_NOT_LINEAR", `${tip} contains a merge or non-linear release delta at ${commit}`);
    }
    previous = commit;
  }
  return commits;
}

function zeroContentMerge(repoRoot, commit) {
  const commitParents = parents(repoRoot, commit);
  if (commitParents.length < 2) return false;
  const commitTree = tree(repoRoot, commit);
  return commitParents.some((parent) => tree(repoRoot, parent) === commitTree);
}

function productionOnlyCommits(repoRoot, productionSha, mainSha) {
  return gitText(repoRoot, ["rev-list", "--reverse", `${mainSha}..${productionSha}`])
    .trim().split(/\s+/).filter(Boolean);
}

export function validateContentSubset(repoRoot, productionRef, mainRef) {
  const productionSha = resolveCommit(repoRoot, productionRef);
  const mainSha = resolveCommit(repoRoot, mainRef);
  const productionCommits = productionOnlyCommits(repoRoot, productionSha, mainSha);
  if (productionCommits.length === 0) {
    throw new ProvenanceError("NO_PRODUCTION_ONLY_COMMITS", "no production-only commits were found");
  }
  const mappings = [];
  for (const productionCommit of productionCommits) {
    const commitParents = parents(repoRoot, productionCommit);
    if (commitParents.length > 1) {
      if (zeroContentMerge(repoRoot, productionCommit)) continue;
      throw new ProvenanceError("MERGE_COMMIT", `${productionCommit} is a non-zero-content merge commit`);
    }
    const sources = cherryPickSources(repoRoot, productionCommit);
    if (sources.length !== 1) {
      throw new ProvenanceError("SOURCE_MAPPING_UNKNOWN", `${productionCommit} has no unique -x source mapping`);
    }
    const sourceCommit = sources[0];
    if (!isAncestor(repoRoot, sourceCommit, mainSha)) {
      throw new ProvenanceError("SOURCE_NON_ANCESTOR", `${sourceCommit} is not an ancestor of ${mainSha}`);
    }
    const sourceFingerprint = fingerprintCommit(repoRoot, sourceCommit);
    const productionFingerprint = fingerprintCommit(repoRoot, productionCommit);
    if (sourceFingerprint.fingerprint !== productionFingerprint.fingerprint) {
      throw new ProvenanceError("FINGERPRINT_MISMATCH", `${productionCommit} does not match source ${sourceCommit}`);
    }
    mappings.push({ productionCommit, sourceCommit, fingerprint: sourceFingerprint.fingerprint });
  }
  for (let index = 1; index < mappings.length; index += 1) {
    if (!isAncestor(repoRoot, mappings[index - 1].sourceCommit, mappings[index].sourceCommit)) {
      throw new ProvenanceError("SOURCE_ORDER_MISMATCH", "source commit order is not an ancestor-consistent sequence");
    }
  }
  return { productionSha, mainSha, mappings };
}

function requireFullSha(value, field) {
  if (typeof value !== "string" || !FULL_SHA.test(value)) {
    throw new ProvenanceError("INVALID_RECORD", `${field} must be a full commit SHA`);
  }
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProvenanceError("INVALID_RECORD", `${field} is required`);
  }
}

function validateRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ProvenanceError("INVALID_RECORD", "record must be an object");
  }
  for (const field of ["releaseId", "baseProductionSha", "sourceMainSha", "releaseSha", "founderAuthorization"]) {
    if (!(field in record)) throw new ProvenanceError("INVALID_RECORD", `missing ${field}`);
  }
  requireString(record.releaseId, "releaseId");
  if (!Array.isArray(record.taskIds) || record.taskIds.length === 0 || record.taskIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new ProvenanceError("INVALID_RECORD", "taskIds must be a non-empty string array");
  }
  requireFullSha(record.baseProductionSha, "baseProductionSha");
  requireFullSha(record.sourceMainSha, "sourceMainSha");
  requireFullSha(record.releaseSha, "releaseSha");
  if (!Array.isArray(record.includedSourceCommits) || record.includedSourceCommits.length === 0) {
    throw new ProvenanceError("INVALID_RECORD", "includedSourceCommits must be non-empty");
  }
  if (new Set(record.includedSourceCommits).size !== record.includedSourceCommits.length) {
    throw new ProvenanceError("INVALID_RECORD", "includedSourceCommits must be unique");
  }
  record.includedSourceCommits.forEach((commit, index) => requireFullSha(commit, `includedSourceCommits[${index}]`));
  const authorization = record.founderAuthorization;
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) {
    throw new ProvenanceError("INVALID_RECORD", "founderAuthorization must be an object");
  }
  if (authorization.approvedBy !== "Founder" || authorization.status !== "APPROVED") {
    throw new ProvenanceError("AUTHORIZATION_MISSING", "founderAuthorization must be Founder/APPROVED");
  }
  requireString(authorization.authorizationId, "founderAuthorization.authorizationId");
  requireString(authorization.approvedAt, "founderAuthorization.approvedAt");
  if (JSON.stringify(authorization.includedSourceCommits) !== JSON.stringify(record.includedSourceCommits)) {
    throw new ProvenanceError("AUTHORIZATION_SCOPE_MISMATCH", "Founder authorization does not exactly cover includedSourceCommits");
  }
  for (const field of ["deploymentId", "productionSha"]) {
    if (!(field in record)) throw new ProvenanceError("INVALID_RECORD", `missing ${field}`);
    if (record[field] !== "PENDING") requireFullSha(record[field], field);
  }
  if ((record.deploymentId === "PENDING") !== (record.productionSha === "PENDING")) {
    throw new ProvenanceError("INVALID_RECORD", "deploymentId and productionSha must both be PENDING or both be resolved");
  }
  if (record.deploymentId !== "PENDING") requireString(record.deploymentId, "deploymentId");
  return record;
}

export function validateSelectiveRelease(repoRoot, recordPath, productionRef, trustedRef, releaseRef = null) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  } catch (error) {
    throw new ProvenanceError("INVALID_RECORD", `cannot read record: ${error.message}`);
  }
  validateRecord(record);
  const authoritativeProduction = resolveCommit(repoRoot, productionRef);
  const trustedMain = resolveCommit(repoRoot, trustedRef);
  const releaseSha = resolveCommit(repoRoot, record.releaseSha);
  if (record.baseProductionSha !== authoritativeProduction) {
    throw new ProvenanceError("PRODUCTION_BASE_MISMATCH", `record base ${record.baseProductionSha} does not equal authoritative Production ${authoritativeProduction}`);
  }
  if (releaseRef && resolveCommit(repoRoot, releaseRef) !== releaseSha) {
    throw new ProvenanceError("RELEASE_REF_MISMATCH", "release ref does not point to record.releaseSha");
  }
  if (!isAncestor(repoRoot, record.sourceMainSha, trustedMain)) {
    throw new ProvenanceError("SOURCE_MAIN_NOT_TRUSTED", "sourceMainSha is not in trusted main lineage");
  }
  if (record.productionSha !== "PENDING" && record.productionSha !== releaseSha) {
    throw new ProvenanceError("DEPLOYMENT_SHA_MISMATCH", "post-deploy productionSha must equal releaseSha");
  }
  const releaseCommits = linearDelta(repoRoot, authoritativeProduction, releaseSha);
  if (releaseCommits.length !== record.includedSourceCommits.length) {
    throw new ProvenanceError("RELEASE_DELTA_MISMATCH", "release delta count does not equal included source commit count");
  }
  const mappings = [];
  for (let index = 1; index < record.includedSourceCommits.length; index += 1) {
    if (!isAncestor(repoRoot, record.includedSourceCommits[index - 1], record.includedSourceCommits[index])) {
      throw new ProvenanceError("SOURCE_ORDER_MISMATCH", "includedSourceCommits are not an ancestor-consistent sequence");
    }
  }
  for (let index = 0; index < releaseCommits.length; index += 1) {
    const releaseCommit = releaseCommits[index];
    const sources = cherryPickSources(repoRoot, releaseCommit);
    if (sources.length !== 1 || sources[0] !== record.includedSourceCommits[index]) {
      throw new ProvenanceError("SOURCE_MAPPING_MISMATCH", `${releaseCommit} mapping/order does not match includedSourceCommits[${index}]`);
    }
    const sourceCommit = sources[0];
    if (!isAncestor(repoRoot, sourceCommit, record.sourceMainSha)) {
      throw new ProvenanceError("SOURCE_NON_ANCESTOR", `${sourceCommit} is not an ancestor of sourceMainSha`);
    }
    const sourceParents = parents(repoRoot, sourceCommit);
    if (sourceParents.length !== 1) throw new ProvenanceError("MERGE_COMMIT", `${sourceCommit} is a merge commit`);
    const sourceFingerprint = fingerprintCommit(repoRoot, sourceCommit);
    const releaseFingerprint = fingerprintCommit(repoRoot, releaseCommit);
    if (sourceFingerprint.fingerprint !== releaseFingerprint.fingerprint) {
      throw new ProvenanceError("FINGERPRINT_MISMATCH", `${releaseCommit} does not match ${sourceCommit}`);
    }
    mappings.push({ releaseCommit, sourceCommit, fingerprint: sourceFingerprint.fingerprint });
  }
  const selectedPaths = new Set(mappings.flatMap((mapping) => fingerprintCommit(repoRoot, mapping.sourceCommit).entries.map((entry) => entry.path)));
  const overlaps = [];
  for (const filePath of selectedPaths) {
    const commits = gitText(repoRoot, ["rev-list", "--no-merges", record.sourceMainSha, "--", filePath]).trim().split(/\s+/).filter(Boolean);
    for (const commit of commits) {
      if (!record.includedSourceCommits.includes(commit)) overlaps.push(`${commit}:${filePath}`);
    }
  }
  return { record, authoritativeProduction, trustedMain, releaseSha, mappings, overlaps: [...new Set(overlaps)].slice(0, 50) };
}

export function validateNormalRelease(repoRoot, releaseBaseRef, approvedMainRef, resultRef) {
  const releaseBase = resolveCommit(repoRoot, releaseBaseRef);
  const approvedMain = resolveCommit(repoRoot, approvedMainRef);
  const result = resolveCommit(repoRoot, resultRef);
  if (!isAncestor(repoRoot, releaseBase, result)) throw new ProvenanceError("RELEASE_BASE_NOT_ANCESTOR", "release base is not an ancestor of result");
  if (!isAncestor(repoRoot, approvedMain, result)) throw new ProvenanceError("APPROVED_MAIN_NOT_ANCESTOR", "approved main is not an ancestor of result");
  const resultParents = parents(repoRoot, result);
  if (resultParents.length !== 2 || !resultParents.includes(releaseBase) || !resultParents.includes(approvedMain)) {
    throw new ProvenanceError("NORMAL_RELEASE_SHAPE", "result must be a two-parent merge of release base and approved main");
  }
  if (tree(repoRoot, result) !== tree(repoRoot, approvedMain)) {
    throw new ProvenanceError("TREE_MISMATCH", "normal release result tree differs from approved main tree");
  }
  return { releaseBase, approvedMain, result };
}

function parseOption(args, name, required = true) {
  const index = args.indexOf(name);
  if (index === -1) {
    if (required) throw new ProvenanceError("CLI", `${name} is required`);
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new ProvenanceError("CLI", `${name} requires a value`);
  return value;
}

function printError(error) {
  console.error(`REASON: ${error.code || "UNKNOWN"}`);
  console.error(`DETAIL: ${error.message}`);
}

export function runCli(argv = process.argv.slice(2)) {
  const mode = argv[0];
  const repoRoot = process.cwd();
  try {
    if (mode === "content-subset") {
      const production = parseOption(argv, "--production");
      const main = parseOption(argv, "--main");
      const result = validateContentSubset(repoRoot, production, main);
      console.log("CONTENT_SUBSET: PASS");
      console.log(`MAPPINGS: ${result.mappings.map((mapping) => `${mapping.productionCommit}->${mapping.sourceCommit}`).join(",")}`);
      process.exitCode = 0;
      return;
    }
    if (mode === "selective") {
      const record = parseOption(argv, "--record");
      const production = parseOption(argv, "--production");
      const trusted = parseOption(argv, "--trusted-ref", false) || "origin/main";
      const releaseRef = parseOption(argv, "--release-ref", false);
      const result = validateSelectiveRelease(repoRoot, record, production, trusted, releaseRef);
      console.log("AUTHORIZED_SELECTIVE_RELEASE: PASS");
      console.log(`Production SHA: ${result.authoritativeProduction}`);
      console.log(`Trusted main: ${result.trustedMain}`);
      console.log(`Release SHA: ${result.releaseSha}`);
      console.log(`Included mappings: ${result.mappings.map((mapping) => `${mapping.sourceCommit}->${mapping.releaseCommit}`).join(",")}`);
      console.log(`INFORMATIONAL OVERLAP REPORT: ${result.overlaps.length ? result.overlaps.join(",") : "NONE"}`);
      process.exitCode = 0;
      return;
    }
    if (mode === "normal") {
      const releaseBase = parseOption(argv, "--release-base");
      const approvedMain = parseOption(argv, "--approved-main");
      const resultRef = parseOption(argv, "--result");
      const result = validateNormalRelease(repoRoot, releaseBase, approvedMain, resultRef);
      console.log("NORMAL_RELEASE_TREE_EQUALITY: PASS");
      console.log(`Release base: ${result.releaseBase}`);
      console.log(`Approved main: ${result.approvedMain}`);
      console.log(`Result: ${result.result}`);
      process.exitCode = 0;
      return;
    }
    throw new ProvenanceError("CLI", "mode must be content-subset, selective, or normal");
  } catch (error) {
    printError(error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
