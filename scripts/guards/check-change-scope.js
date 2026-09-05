#!/usr/bin/env node

const fs = require("fs");
const crypto = require("crypto");
const childProcess = require("child_process");
const path = require("path");
const process = require("process");

const CONFIG_PATH = path.join(
  process.cwd(),
  "docs",
  "change-gates",
  "gate-config.json"
);

const TASK_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

class GuardInputError extends Error {}

function normalizeFilePath(filePath, repoRoot = process.cwd()) {
  if (typeof filePath !== "string") {
    throw new GuardInputError("path must be a string");
  }

  const trimmed = filePath.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new GuardInputError("path must be non-empty and contain no NUL bytes");
  }

  const resolvedRoot = path.resolve(repoRoot);
  let relativePath;

  if (path.isAbsolute(trimmed)) {
    const resolvedPath = path.resolve(trimmed);
    relativePath = path.relative(resolvedRoot, resolvedPath);
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new GuardInputError("absolute path is outside the repository");
    }
    relativePath = relativePath.split(path.sep).join("/");
  } else {
    relativePath = trimmed.replace(/\\/g, "/");
    if (/^[A-Za-z]:\//.test(relativePath) || relativePath.startsWith("//")) {
      throw new GuardInputError("foreign absolute paths are not accepted");
    }
    relativePath = relativePath.replace(/^(?:\.\/)+/, "");
  }

  if (relativePath.split("/").includes("..")) {
    throw new GuardInputError("path traversal is not accepted");
  }

  const normalized = path.posix.normalize(relativePath);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw new GuardInputError("path does not resolve to a repository file");
  }

  return normalized;
}

function getFilesArg(argv) {
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--files" || argv[index] === "–files") {
      return argv[index + 1];
    }

    if (argv[index].startsWith("--files=")) {
      return argv[index].slice("--files=".length);
    }

    if (argv[index].startsWith("–files=")) {
      return argv[index].slice("–files=".length);
    }
  }

  return null;
}

function getTaskIdArg(argv) {
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--task-id") {
      return argv[index + 1];
    }

    if (argv[index].startsWith("--task-id=")) {
      return argv[index].slice("--task-id=".length);
    }
  }

  return null;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error("gate-config.json not found at docs/change-gates/gate-config.json");
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    throw new Error(`failed to parse gate-config.json: ${error.message}`);
  }
}

function validateIsoTimestamp(value, fieldName) {
  if (
    typeof value !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new GuardInputError(`${fieldName} must be an ISO timestamp`);
  }
}

function validateException(exception, repoRoot = process.cwd()) {
  if (!exception || typeof exception !== "object" || Array.isArray(exception)) {
    throw new GuardInputError("exception must be an object");
  }
  if (exception.version !== 1) {
    throw new GuardInputError("exception.version must be 1");
  }
  if (typeof exception.taskId !== "string" || !TASK_ID_PATTERN.test(exception.taskId)) {
    throw new GuardInputError("exception.taskId is invalid");
  }
  if (typeof exception.featureBranch !== "string" || !exception.featureBranch.trim()) {
    throw new GuardInputError("exception.featureBranch is required");
  }
  if (exception.authorizationType !== "FOUNDER_APPROVED_TASK_SCOPED_EXCEPTION") {
    throw new GuardInputError("exception.authorizationType is not authorized");
  }
  if (exception.trustedRef !== "origin/main") {
    throw new GuardInputError("exception.trustedRef must be origin/main");
  }
  if (exception.status !== "ACTIVE" && exception.status !== "CLOSED") {
    throw new GuardInputError("exception.status must be ACTIVE or CLOSED");
  }
  if (exception.approvedBy !== "Founder") {
    throw new GuardInputError("exception.approvedBy must be Founder");
  }
  if (exception.closeAfter !== "FEATURE_MERGE") {
    throw new GuardInputError("exception.closeAfter must be FEATURE_MERGE");
  }
  if (typeof exception.reason !== "string" || !exception.reason.trim()) {
    throw new GuardInputError("exception.reason is required");
  }
  if (
    typeof exception.baseOriginMainSha !== "string" ||
    !COMMIT_SHA_PATTERN.test(exception.baseOriginMainSha)
  ) {
    throw new GuardInputError("exception.baseOriginMainSha must be a full commit SHA");
  }
  if (
    !Array.isArray(exception.authorizedCommits) ||
    exception.authorizedCommits.length === 0 ||
    exception.authorizedCommits.some(
      (commit) => typeof commit !== "string" || !COMMIT_SHA_PATTERN.test(commit)
    )
  ) {
    throw new GuardInputError("exception.authorizedCommits must contain full commit SHAs");
  }
  validateIsoTimestamp(exception.createdAt, "exception.createdAt");
  validateIsoTimestamp(exception.approvedAt, "exception.approvedAt");
  if (Date.parse(exception.approvedAt) < Date.parse(exception.createdAt)) {
    throw new GuardInputError("exception.approvedAt cannot precede createdAt");
  }
  if (exception.status === "ACTIVE") {
    if (exception.closedAt != null || exception.featureMergeCommitSha != null) {
      throw new GuardInputError("ACTIVE exception cannot contain closure metadata");
    }
  } else {
    validateIsoTimestamp(exception.closedAt, "exception.closedAt");
    if (
      typeof exception.featureMergeCommitSha !== "string" ||
      !COMMIT_SHA_PATTERN.test(exception.featureMergeCommitSha)
    ) {
      throw new GuardInputError("CLOSED exception must record the feature merge commit SHA");
    }
  }

  if (!Array.isArray(exception.authorizedPaths) || exception.authorizedPaths.length === 0) {
    throw new GuardInputError("exception.authorizedPaths must be a non-empty array");
  }

  const normalizedPaths = exception.authorizedPaths.map((authorizedPath) => {
    if (typeof authorizedPath !== "string" || /[*?\[\]]/.test(authorizedPath)) {
      throw new GuardInputError("exception paths must be exact and contain no wildcard");
    }
    const normalized = normalizeFilePath(authorizedPath, repoRoot);
    if (normalized !== authorizedPath) {
      throw new GuardInputError("exception paths must use canonical repository-relative form");
    }
    return normalized;
  });

  if (new Set(normalizedPaths).size !== normalizedPaths.length) {
    throw new GuardInputError("exception.authorizedPaths contains duplicates");
  }

  const hashes = exception.authorizedPathSha256;
  if (!hashes || typeof hashes !== "object" || Array.isArray(hashes)) {
    throw new GuardInputError("exception.authorizedPathSha256 must be an object");
  }
  const hashPaths = Object.keys(hashes).sort();
  const authorizedPaths = [...normalizedPaths].sort();
  if (
    hashPaths.length !== authorizedPaths.length ||
    hashPaths.some((hashPath, index) => hashPath !== authorizedPaths[index])
  ) {
    throw new GuardInputError("exception hashes must exactly cover authorizedPaths");
  }
  for (const authorizedPath of normalizedPaths) {
    if (typeof hashes[authorizedPath] !== "string" || !SHA256_PATTERN.test(hashes[authorizedPath])) {
      throw new GuardInputError(`exception hash is invalid for ${authorizedPath}`);
    }
  }

  return {
    ...exception,
    authorizedPaths: normalizedPaths,
  };
}

function loadTrustedWorkingFile(relativePath, repoRoot, label) {
  let trustedContent;
  try {
    trustedContent = childProcess.execFileSync(
      "git",
      ["show", `origin/main:${relativePath}`],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch (error) {
    throw new GuardInputError(`trusted origin/main ${label} is unavailable`);
  }

  const workingPath = path.join(repoRoot, ...relativePath.split("/"));
  let workingContent;
  try {
    workingContent = fs.readFileSync(workingPath);
  } catch (error) {
    throw new GuardInputError(`working-tree ${label} is unavailable: ${error.message}`);
  }
  if (
    trustedContent.length !== workingContent.length ||
    !crypto.timingSafeEqual(trustedContent, workingContent)
  ) {
    throw new GuardInputError(`working-tree ${label} differs from trusted origin/main`);
  }

  return trustedContent;
}

function loadExceptionForTask(taskId, repoRoot = process.cwd()) {
  if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId)) {
    throw new GuardInputError("--task-id is invalid");
  }

  const exceptionRelativePath = `docs/change-gates/exceptions/${taskId}.json`;
  const exceptionPath = path.join(repoRoot, ...exceptionRelativePath.split("/"));
  if (!exceptionPath.startsWith(`${path.resolve(repoRoot)}${path.sep}`)) {
    throw new GuardInputError("exception path escaped the repository");
  }

  loadTrustedWorkingFile("docs/change-gates/gate-config.json", repoRoot, "gate config");

  let trustedContent;
  try {
    trustedContent = loadTrustedWorkingFile(exceptionRelativePath, repoRoot, "exception");
  } catch (error) {
    if (error.message === "trusted origin/main exception is unavailable") {
      throw new GuardInputError(`no trusted origin/main exception is registered for task ${taskId}`);
    }
    throw error;
  }

  let exception;
  try {
    exception = JSON.parse(trustedContent.toString("utf8"));
  } catch (error) {
    throw new GuardInputError(`failed to parse trusted task exception: ${error.message}`);
  }
  const validated = validateException(exception, repoRoot);
  validateExceptionGitProvenance(validated, repoRoot);
  return validated;
}

function gitIsAncestor(repoRoot, ancestor, descendant) {
  const result = childProcess.spawnSync(
    "git",
    ["merge-base", "--is-ancestor", ancestor, descendant],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return result.status === 0;
}

function validateExceptionGitProvenance(exception, repoRoot = process.cwd()) {
  if (!gitIsAncestor(repoRoot, exception.baseOriginMainSha, "origin/main")) {
    throw new GuardInputError("exception base is not an ancestor of trusted origin/main");
  }

  for (let index = 0; index < exception.authorizedCommits.length; index += 1) {
    const commit = exception.authorizedCommits[index];
    if (!gitIsAncestor(repoRoot, exception.baseOriginMainSha, commit)) {
      throw new GuardInputError(`authorized commit ${commit} is outside the approved base lineage`);
    }
    if (index > 0 && !gitIsAncestor(repoRoot, exception.authorizedCommits[index - 1], commit)) {
      throw new GuardInputError("exception.authorizedCommits are not in ancestor order");
    }
    if (!gitIsAncestor(repoRoot, commit, "HEAD")) {
      throw new GuardInputError(`authorized commit ${commit} is not an ancestor of current HEAD`);
    }
  }

  const authorizedHead = exception.authorizedCommits[exception.authorizedCommits.length - 1];
  for (const authorizedPath of exception.authorizedPaths) {
    let approvedContent;
    try {
      approvedContent = childProcess.execFileSync(
        "git",
        ["show", `${authorizedHead}:${authorizedPath}`],
        { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }
      );
    } catch (error) {
      throw new GuardInputError(`authorized commit does not contain ${authorizedPath}`);
    }
    const approvedHash = crypto.createHash("sha256").update(approvedContent).digest("hex");
    if (approvedHash !== exception.authorizedPathSha256[authorizedPath]) {
      throw new GuardInputError(`authorized commit content hash mismatch for ${authorizedPath}`);
    }
  }
}

function getCurrentBranch(repoRoot = process.cwd()) {
  try {
    const branch = childProcess.execFileSync(
      "git",
      ["branch", "--show-current"],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (!branch) {
      throw new Error("detached HEAD");
    }
    return branch;
  } catch (error) {
    throw new GuardInputError(`unable to determine current git branch: ${error.message}`);
  }
}

function sha256RepositoryFile(repoRoot, filePath) {
  const fullPath = path.resolve(repoRoot, ...filePath.split("/"));
  const relativePath = path.relative(path.resolve(repoRoot), fullPath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new GuardInputError("authorized file escaped the repository");
  }
  const stat = fs.lstatSync(fullPath);
  if (!stat.isFile()) {
    throw new GuardInputError("authorized path is not a regular file");
  }
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function isExactFileRule(rule) {
  return path.posix.extname(rule) !== "";
}

function matchAbsolute(filePath, rules) {
  for (const rule of rules) {
    const normalizedRule = normalizeFilePath(rule);

    if (
      filePath === normalizedRule ||
      filePath.startsWith(`${normalizedRule}/`) ||
      (isExactFileRule(normalizedRule) && filePath.startsWith(normalizedRule))
    ) {
      return {
        type: "absolute",
        rule: normalizedRule,
      };
    }
  }

  return null;
}

function matchGlob(filePath, rules) {
  for (const rule of rules) {
    const normalizedRule = normalizeFilePath(rule);

    if (normalizedRule.endsWith("/**")) {
      const prefix = normalizedRule.slice(0, -3);
      if (filePath.startsWith(`${prefix}/`)) {
        return {
          type: "glob",
          rule: normalizedRule,
        };
      }
    }

    if (normalizedRule.endsWith("/") && filePath.startsWith(normalizedRule)) {
      return {
        type: "glob",
        rule: normalizedRule,
      };
    }
  }

  return null;
}

function evaluateFile({
  filePath,
  repoRoot = process.cwd(),
  config,
  taskId = null,
  currentBranch = null,
  exception = null,
  contentHashResolver = null,
}) {
  let normalizedPath;
  try {
    normalizedPath = normalizeFilePath(filePath, repoRoot);
  } catch (error) {
    return {
      filePath: typeof filePath === "string" ? filePath.trim() : String(filePath),
      allowed: false,
      reason: `invalid path: ${error.message}`,
    };
  }

  const forbiddenPaths = config.forbidden_paths || {};
  const absoluteRules = Array.isArray(forbiddenPaths.absolute)
    ? forbiddenPaths.absolute
    : [];
  const globRules = Array.isArray(forbiddenPaths.glob_patterns)
    ? forbiddenPaths.glob_patterns
    : [];
  const absoluteMatch = matchAbsolute(normalizedPath, absoluteRules);
  const globMatch = absoluteMatch ? null : matchGlob(normalizedPath, globRules);
  const match = absoluteMatch || globMatch;

  if (!match) {
    return { filePath: normalizedPath, allowed: true, reason: "not forbidden" };
  }

  if (!taskId || !exception) {
    return {
      filePath: normalizedPath,
      allowed: false,
      match,
      reason: `matches forbidden_paths.${match.type === "absolute" ? "absolute" : "glob_patterns"}`,
    };
  }
  if (exception.taskId !== taskId) {
    return { filePath: normalizedPath, allowed: false, match, reason: "exception taskId mismatch" };
  }
  if (exception.status !== "ACTIVE") {
    return { filePath: normalizedPath, allowed: false, match, reason: "exception is not ACTIVE" };
  }
  if (exception.featureBranch !== currentBranch) {
    return { filePath: normalizedPath, allowed: false, match, reason: "current branch is not authorized" };
  }
  if (!exception.authorizedPaths.includes(normalizedPath)) {
    return { filePath: normalizedPath, allowed: false, match, reason: "path is not exactly authorized" };
  }

  const resolveHash = contentHashResolver || ((candidate) => sha256RepositoryFile(repoRoot, candidate));
  let actualHash;
  try {
    actualHash = resolveHash(normalizedPath);
  } catch (error) {
    return { filePath: normalizedPath, allowed: false, match, reason: `content hash unavailable: ${error.message}` };
  }
  if (actualHash !== exception.authorizedPathSha256[normalizedPath]) {
    return { filePath: normalizedPath, allowed: false, match, reason: "authorized content SHA-256 mismatch" };
  }

  return {
    filePath: normalizedPath,
    allowed: true,
    match,
    reason: `ACTIVE exact-path exception for ${taskId}`,
    exceptionApplied: true,
  };
}

function main() {
  const filesArg = getFilesArg(process.argv);
  const taskId = getTaskIdArg(process.argv);

  if (!filesArg) {
    console.log("ERROR: –files required");
    process.exit(2);
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.log(`ERROR: ${error.message}`);
    process.exit(2);
  }

  // Read for reporting compatibility with the config contract. It is not a whitelist.
  const allowedPaths = Array.isArray(config.allowed_paths) ? config.allowed_paths : [];
  void allowedPaths;

  const files = filesArg.split(",").map((filePath) => filePath.trim()).filter(Boolean);

  let exception = null;
  let currentBranch = null;
  if (taskId) {
    try {
      exception = loadExceptionForTask(taskId);
      currentBranch = getCurrentBranch();
    } catch (error) {
      console.log(`EXCEPTION BLOCKED reason: ${error.message}`);
      console.log("BLOCKED");
      process.exit(1);
    }
  }

  let blocked = false;

  for (const filePath of files) {
    const result = evaluateFile({ filePath, config, taskId, currentBranch, exception });
    if (!result.allowed) {
      blocked = true;
      const rule = result.match ? ` ${result.match.type} rule: ${result.match.rule}` : "";
      console.log(`${result.filePath} BLOCKED${rule} reason: ${result.reason}`);
    } else if (result.exceptionApplied) {
      console.log(`${result.filePath} ALLOWED exception: ${taskId} reason: ${result.reason}`);
    } else {
      console.log(`${result.filePath} ALLOWED`);
    }
  }

  if (blocked) {
    console.log("BLOCKED");
    process.exit(1);
  }

  console.log("PASS");
}

if (require.main === module) {
  main();
}

module.exports = {
  GuardInputError,
  evaluateFile,
  getFilesArg,
  getTaskIdArg,
  matchAbsolute,
  matchGlob,
  normalizeFilePath,
  validateException,
};
