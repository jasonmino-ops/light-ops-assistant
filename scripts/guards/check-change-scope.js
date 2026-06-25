#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const process = require("process");

const CONFIG_PATH = path.join(
  process.cwd(),
  "docs",
  "change-gates",
  "gate-config.json"
);

function normalizeFilePath(filePath) {
  return filePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
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

function main() {
  const filesArg = getFilesArg(process.argv);

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

  const forbiddenPaths = config.forbidden_paths || {};
  const absoluteRules = Array.isArray(forbiddenPaths.absolute)
    ? forbiddenPaths.absolute
    : [];
  const globRules = Array.isArray(forbiddenPaths.glob_patterns)
    ? forbiddenPaths.glob_patterns
    : [];

  // Read for reporting compatibility with the config contract. It is not a whitelist.
  const allowedPaths = Array.isArray(config.allowed_paths) ? config.allowed_paths : [];
  void allowedPaths;

  const files = filesArg
    .split(",")
    .map(normalizeFilePath)
    .filter(Boolean);

  let blocked = false;

  for (const filePath of files) {
    const absoluteMatch = matchAbsolute(filePath, absoluteRules);
    const globMatch = absoluteMatch ? null : matchGlob(filePath, globRules);
    const match = absoluteMatch || globMatch;

    if (match) {
      blocked = true;
      console.log(
        `${filePath} BLOCKED ${match.type} rule: ${match.rule} reason: matches forbidden_paths.${match.type === "absolute" ? "absolute" : "glob_patterns"}`
      );
    } else {
      console.log(`${filePath} ALLOWED`);
    }
  }

  if (blocked) {
    console.log("BLOCKED");
    process.exit(1);
  }

  console.log("PASS");
}

main();
