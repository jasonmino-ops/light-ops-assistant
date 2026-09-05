#!/usr/bin/env node

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  GuardInputError,
  evaluateFile,
  normalizeFilePath,
  validateException,
} = require("./check-change-scope");

const repoRoot = path.resolve(path.sep, "guard-test-repository");
const taskId = "ES-PRINT-DUAL-CHANNEL-01";
const featureBranch = "codex/es-print-dual-channel-relay-v01";
const desktopFeatureBranch = "codex/es-print-desktop-pos-relay-entry-v01";
const schemaPath = "prisma/schema.prisma";
const migrationPath = "prisma/migrations/20260905070000_es_tray_production_relay_v01/migration.sql";
const cashierPath = "app/cashier/page.tsx";
const schemaHash = "a".repeat(64);
const migrationHash = "b".repeat(64);
const cashierHash = "c".repeat(64);

const config = {
  forbidden_paths: {
    absolute: [schemaPath, cashierPath],
    glob_patterns: ["prisma/migrations/", "app/api/print/**"],
  },
  allowed_paths: ["scripts/guards", "docs/change-gates"],
};

function cashierAuthorization(overrides = {}) {
  return {
    authorizationId: "A11.2-DESKTOP-POS-CASHIER-PAGE",
    featureBranch: desktopFeatureBranch,
    lineageMode: "PRE_COMMIT_CONTENT_SHA256",
    baseOriginMainSha: "4".repeat(40),
    status: "ACTIVE",
    authorizedPaths: [cashierPath],
    authorizedPathSha256: { [cashierPath]: cashierHash },
    createdAt: "2026-09-05T13:56:29Z",
    approvedAt: "2026-09-05T13:56:29Z",
    approvedBy: "Founder",
    closeAfter: "FEATURE_MERGE",
    reason: "authorize the exact reviewed Desktop POS cashier entry draft",
    ...overrides,
  };
}

function exception(overrides = {}) {
  return validateException(
    {
      version: 1,
      taskId,
      featureBranch,
      baseOriginMainSha: "1".repeat(40),
      authorizedCommits: ["2".repeat(40), "3".repeat(40)],
      authorizationType: "FOUNDER_APPROVED_TASK_SCOPED_EXCEPTION",
      trustedRef: "origin/main",
      status: "ACTIVE",
      authorizedPaths: [schemaPath, migrationPath],
      authorizedPathSha256: {
        [schemaPath]: schemaHash,
        [migrationPath]: migrationHash,
      },
      createdAt: "2026-09-05T08:35:16Z",
      approvedAt: "2026-09-05T08:35:16Z",
      approvedBy: "Founder",
      closeAfter: "FEATURE_MERGE",
      reason: "test fixture",
      ...overrides,
    },
    repoRoot
  );
}

function exceptionWithCashier(overrides = {}) {
  return exception({
    additionalAuthorizations: [cashierAuthorization(overrides)],
  });
}

function evaluate(filePath, options = {}) {
  const record = options.exception === undefined ? exception() : options.exception;
  return evaluateFile({
    filePath,
    repoRoot,
    config,
    taskId: options.taskId === undefined ? taskId : options.taskId,
    currentBranch: options.currentBranch === undefined ? featureBranch : options.currentBranch,
    exception: record,
    contentHashResolver:
      options.contentHashResolver ||
      ((candidate) => ({
        [schemaPath]: schemaHash,
        [migrationPath]: migrationHash,
        [cashierPath]: cashierHash,
      })[candidate]),
  });
}

function runGit(fixtureRoot, args) {
  const result = childProcess.spawnSync("git", args, { cwd: fixtureRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}

function createTrustedCliFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dev-gate-01b-"));
  const fixtureSchema = Buffer.from("approved schema\n");
  const fixtureMigration = Buffer.from("approved migration\n");
  const fixtureCashier = Buffer.from("approved cashier entry\n");
  const fixtureConfigPath = path.join(fixtureRoot, "docs", "change-gates", "gate-config.json");
  const fixtureExceptionPath = path.join(
    fixtureRoot,
    "docs",
    "change-gates",
    "exceptions",
    `${taskId}.json`
  );
  fs.mkdirSync(path.dirname(fixtureExceptionPath), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, path.dirname(migrationPath)), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, path.dirname(cashierPath)), { recursive: true });

  runGit(fixtureRoot, ["init", "-q"]);
  runGit(fixtureRoot, ["config", "user.name", "Dev Gate Test"]);
  runGit(fixtureRoot, ["config", "user.email", "dev-gate@example.invalid"]);
  fs.writeFileSync(fixtureConfigPath, JSON.stringify(config));
  fs.writeFileSync(path.join(fixtureRoot, cashierPath), "base cashier entry\n");
  runGit(fixtureRoot, ["add", "docs/change-gates/gate-config.json", cashierPath]);
  runGit(fixtureRoot, ["commit", "-q", "-m", "test: establish base"]);
  const baseSha = runGit(fixtureRoot, ["rev-parse", "HEAD"]);

  runGit(fixtureRoot, ["checkout", "-q", "-b", featureBranch]);
  fs.writeFileSync(path.join(fixtureRoot, schemaPath), fixtureSchema);
  fs.writeFileSync(path.join(fixtureRoot, migrationPath), fixtureMigration);
  runGit(fixtureRoot, ["add", schemaPath, migrationPath]);
  runGit(fixtureRoot, ["commit", "-q", "-m", "feat: add approved files"]);
  const featureCommit = runGit(fixtureRoot, ["rev-parse", "HEAD"]);

  runGit(fixtureRoot, ["checkout", "-q", "-b", "governance-exception", baseSha]);
  const record = {
    version: 1,
    taskId,
    featureBranch,
    baseOriginMainSha: baseSha,
    authorizedCommits: [featureCommit],
    authorizationType: "FOUNDER_APPROVED_TASK_SCOPED_EXCEPTION",
    trustedRef: "origin/main",
    status: "ACTIVE",
    authorizedPaths: [schemaPath, migrationPath],
    authorizedPathSha256: {
      [schemaPath]: crypto.createHash("sha256").update(fixtureSchema).digest("hex"),
      [migrationPath]: crypto.createHash("sha256").update(fixtureMigration).digest("hex"),
    },
    createdAt: "2026-09-05T08:35:16Z",
    approvedAt: "2026-09-05T08:35:16Z",
    approvedBy: "Founder",
    closeAfter: "FEATURE_MERGE",
    reason: "integration test fixture",
    additionalAuthorizations: [{
      ...cashierAuthorization({ baseOriginMainSha: baseSha }),
      authorizedPathSha256: {
        [cashierPath]: crypto.createHash("sha256").update(fixtureCashier).digest("hex"),
      },
    }],
  };
  fs.writeFileSync(fixtureExceptionPath, JSON.stringify(record));
  runGit(fixtureRoot, ["add", `docs/change-gates/exceptions/${taskId}.json`]);
  runGit(fixtureRoot, ["commit", "-q", "-m", "chore: authorize exact files"]);
  const governanceCommit = runGit(fixtureRoot, ["rev-parse", "HEAD"]);
  runGit(fixtureRoot, ["update-ref", "refs/remotes/origin/main", governanceCommit]);
  runGit(fixtureRoot, ["checkout", "-q", featureBranch]);
  runGit(fixtureRoot, ["merge", "-q", "--no-edit", "governance-exception"]);

  runGit(fixtureRoot, ["checkout", "-q", "-b", desktopFeatureBranch, baseSha]);
  runGit(fixtureRoot, ["merge", "-q", "--no-edit", "governance-exception"]);
  runGit(fixtureRoot, ["checkout", "-q", featureBranch]);

  return { fixtureRoot, fixtureConfigPath, fixtureExceptionPath, fixtureCashier, record };
}

function runGuardCli(fixtureRoot, files) {
  return childProcess.spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, "check-change-scope.js"),
      "--task-id",
      taskId,
      "--files",
      files.join(","),
    ],
    { cwd: fixtureRoot, encoding: "utf8" }
  );
}

test("default deny blocks prisma/schema.prisma without an exception", () => {
  assert.equal(evaluateFile({ filePath: schemaPath, repoRoot, config }).allowed, false);
});

test("default deny blocks a migration without an exception", () => {
  assert.equal(evaluateFile({ filePath: migrationPath, repoRoot, config }).allowed, false);
});

test("an ACTIVE matching exception allows the exact schema path", () => {
  const result = evaluate(schemaPath);
  assert.equal(result.allowed, true);
  assert.equal(result.exceptionApplied, true);
});

test("an ACTIVE matching exception allows the exact migration path", () => {
  const result = evaluate(migrationPath);
  assert.equal(result.allowed, true);
  assert.equal(result.exceptionApplied, true);
});

test("an ACTIVE exception still blocks every other migration", () => {
  assert.equal(evaluate("prisma/migrations/20990101000000_other/migration.sql").allowed, false);
});

test("a wrong task ID blocks the exception", () => {
  assert.equal(evaluate(schemaPath, { taskId: "ES-PRINT-DUAL-CHANNEL-02" }).allowed, false);
});

test("a wrong current branch blocks the exception", () => {
  assert.equal(evaluate(schemaPath, { currentBranch: "codex/unrelated" }).allowed, false);
});

test("a CLOSED exception blocks the exact authorized path", () => {
  const closed = exception({
    status: "CLOSED",
    closedAt: "2026-09-06T08:35:16Z",
    featureMergeCommitSha: "4".repeat(40),
  });
  assert.equal(evaluate(schemaPath, { exception: closed }).allowed, false);
});

test("a malformed exception fails closed during validation", () => {
  assert.throws(
    () => exception({ approvedBy: "unknown" }),
    (error) => error instanceof GuardInputError
  );
});

test("an ordinary non-forbidden file keeps the existing ALLOWED behavior", () => {
  assert.equal(evaluateFile({ filePath: "app/example/page.tsx", repoRoot, config }).allowed, true);
});

test("path traversal input is blocked before rule matching", () => {
  const result = evaluateFile({
    filePath: "prisma/migrations/../schema.prisma",
    repoRoot,
    config,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /traversal/);
});

test("repository absolute and relative paths normalize to the same exact path", () => {
  const absoluteSchemaPath = path.join(repoRoot, "prisma", "schema.prisma");
  assert.equal(normalizeFilePath(absoluteSchemaPath, repoRoot), schemaPath);
  assert.equal(normalizeFilePath(`./${schemaPath}`, repoRoot), schemaPath);
  assert.equal(evaluate(absoluteSchemaPath).allowed, true);
});

test("an absolute path outside the repository is blocked", () => {
  const result = evaluateFile({ filePath: path.resolve(path.sep, "outside", "schema.prisma"), repoRoot, config });
  assert.equal(result.allowed, false);
});

test("wildcard exception paths are rejected", () => {
  assert.throws(
    () =>
      exception({
        authorizedPaths: [schemaPath, "prisma/migrations/**"],
        authorizedPathSha256: {
          [schemaPath]: schemaHash,
          "prisma/migrations/**": migrationHash,
        },
      }),
    (error) => error instanceof GuardInputError
  );
});

test("approved path content must retain its authorized SHA-256", () => {
  const result = evaluate(schemaPath, { contentHashResolver: () => "c".repeat(64) });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /SHA-256 mismatch/);
});

test("an exception cannot authorize another forbidden namespace", () => {
  assert.equal(evaluate("app/api/print/route.ts").allowed, false);
});

test("default deny blocks app/cashier/page.tsx without an exception", () => {
  assert.equal(evaluateFile({ filePath: cashierPath, repoRoot, config }).allowed, false);
});

test("an ACTIVE additional authorization allows only the exact cashier page draft", () => {
  const result = evaluate(cashierPath, {
    exception: exceptionWithCashier(),
    currentBranch: desktopFeatureBranch,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.exceptionApplied, true);
  assert.match(result.reason, /A11\.2-DESKTOP-POS-CASHIER-PAGE/);
});

test("the cashier authorization does not permit another forbidden path", () => {
  const result = evaluate("app/api/print/route.ts", {
    exception: exceptionWithCashier(),
    currentBranch: desktopFeatureBranch,
  });
  assert.equal(result.allowed, false);
});

test("the cashier authorization blocks sibling files outside its exact path", () => {
  const result = evaluate("app/cashier/other.tsx", {
    exception: exceptionWithCashier(),
    currentBranch: desktopFeatureBranch,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /outside the exact task-scoped authorization/);
});

test("the cashier authorization blocks the wrong branch", () => {
  const result = evaluate(cashierPath, {
    exception: exceptionWithCashier(),
    currentBranch: "codex/unrelated",
  });
  assert.equal(result.allowed, false);
});

test("the cashier authorization blocks the wrong task", () => {
  const result = evaluate(cashierPath, {
    exception: exceptionWithCashier(),
    currentBranch: desktopFeatureBranch,
    taskId: "ES-PRINT-DUAL-CHANNEL-02",
  });
  assert.equal(result.allowed, false);
});

test("a malformed additional authorization fails closed", () => {
  assert.throws(
    () => exception({ additionalAuthorizations: [{ ...cashierAuthorization(), lineageMode: "SKIP_LINEAGE" }] }),
    (error) => error instanceof GuardInputError
  );
});

test("tampered cashier content fails the approved hash check", () => {
  const result = evaluate(cashierPath, {
    exception: exceptionWithCashier(),
    currentBranch: desktopFeatureBranch,
    contentHashResolver: () => "d".repeat(64),
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /SHA-256 mismatch/);
});

test("a CLOSED cashier authorization cannot allow the exact path", () => {
  const record = exceptionWithCashier({
    status: "CLOSED",
    closedAt: "2026-09-06T13:56:29Z",
    featureMergeCommitSha: "5".repeat(40),
  });
  assert.equal(evaluate(cashierPath, {
    exception: record,
    currentBranch: desktopFeatureBranch,
  }).allowed, false);
});

test("the existing primary Prisma authorization is unchanged by the additional grant", () => {
  const record = exceptionWithCashier();
  const schemaResult = evaluate(schemaPath, { exception: record, currentBranch: featureBranch });
  const migrationResult = evaluate(migrationPath, { exception: record, currentBranch: featureBranch });
  assert.equal(schemaResult.allowed, true);
  assert.equal(migrationResult.allowed, true);
});

test("additional authorization wildcard paths are rejected", () => {
  assert.throws(
    () => exceptionWithCashier({
      authorizedPaths: ["app/cashier/**"],
      authorizedPathSha256: { "app/cashier/**": cashierHash },
    }),
    (error) => error instanceof GuardInputError
  );
});

test("two authorizations cannot target the same feature branch", () => {
  assert.throws(
    () => exceptionWithCashier({ featureBranch }),
    (error) => error instanceof GuardInputError
  );
});

test("the committed ES-PRINT exception record satisfies the strict contract", () => {
  const recordPath = path.resolve(
    __dirname,
    "../../docs/change-gates/exceptions/ES-PRINT-DUAL-CHANNEL-01.json"
  );
  const record = validateException(JSON.parse(fs.readFileSync(recordPath, "utf8")), path.resolve(__dirname, "../.."));
  assert.equal(record.taskId, taskId);
  assert.deepEqual(record.authorizedPaths, [schemaPath, migrationPath]);
});

test("the trusted CLI accepts the approved pre-commit cashier draft on its exact branch", () => {
  const { fixtureRoot, fixtureCashier } = createTrustedCliFixture();
  try {
    runGit(fixtureRoot, ["checkout", "-q", desktopFeatureBranch]);
    fs.writeFileSync(path.join(fixtureRoot, cashierPath), fixtureCashier);
    const result = runGuardCli(fixtureRoot, [cashierPath]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /A11\.2-DESKTOP-POS-CASHIER-PAGE/);
    assert.match(result.stdout, /PASS/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("the trusted CLI blocks tampered cashier content and sibling cashier files", () => {
  const { fixtureRoot } = createTrustedCliFixture();
  try {
    runGit(fixtureRoot, ["checkout", "-q", desktopFeatureBranch]);
    fs.writeFileSync(path.join(fixtureRoot, cashierPath), "tampered cashier entry\n");
    fs.writeFileSync(path.join(fixtureRoot, "app/cashier/other.tsx"), "scope creep\n");
    const tampered = runGuardCli(fixtureRoot, [cashierPath]);
    const sibling = runGuardCli(fixtureRoot, ["app/cashier/other.tsx"]);
    assert.equal(tampered.status, 1, tampered.stdout + tampered.stderr);
    assert.match(tampered.stdout, /authorized content SHA-256 mismatch/);
    assert.equal(sibling.status, 1, sibling.stdout + sibling.stderr);
    assert.match(sibling.stdout, /outside the exact task-scoped authorization/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("the CLI applies the exception only on the actual authorized git branch", () => {
  const { fixtureRoot } = createTrustedCliFixture();
  try {
    const result = runGuardCli(fixtureRoot, [schemaPath, migrationPath]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /ALLOWED exception: ES-PRINT-DUAL-CHANNEL-01/);
    assert.match(result.stdout, /PASS/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("a feature cannot self-authorize by tampering with its working-tree exception", () => {
  const { fixtureRoot, fixtureExceptionPath, record } = createTrustedCliFixture();
  try {
    const unauthorizedMigration = "prisma/migrations/20990101000000_other/migration.sql";
    fs.mkdirSync(path.dirname(path.join(fixtureRoot, unauthorizedMigration)), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, unauthorizedMigration), "unauthorized migration\n");
    fs.writeFileSync(
      fixtureExceptionPath,
      JSON.stringify({
        ...record,
        authorizedPaths: [...record.authorizedPaths, unauthorizedMigration],
        authorizedPathSha256: {
          ...record.authorizedPathSha256,
          [unauthorizedMigration]: crypto
            .createHash("sha256")
            .update("unauthorized migration\n")
            .digest("hex"),
        },
      })
    );

    const result = runGuardCli(fixtureRoot, [unauthorizedMigration]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /working-tree exception differs from trusted origin\/main/);
    assert.match(result.stdout, /BLOCKED/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("a feature cannot bypass exact hashes by weakening its working-tree gate config", () => {
  const { fixtureRoot, fixtureConfigPath } = createTrustedCliFixture();
  try {
    fs.writeFileSync(fixtureConfigPath, JSON.stringify({ forbidden_paths: {} }));
    fs.writeFileSync(path.join(fixtureRoot, migrationPath), "tampered migration\n");

    const result = runGuardCli(fixtureRoot, [migrationPath]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /working-tree gate config differs from trusted origin\/main/);
    assert.match(result.stdout, /BLOCKED/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
