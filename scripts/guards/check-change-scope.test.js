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
const launchFeatureBranch = "codex/es-print-desktop-launch-route-compat-v01";
const schemaPath = "prisma/schema.prisma";
const migrationPath = "prisma/migrations/20260905070000_es_tray_production_relay_v01/migration.sql";
const cashierPath = "app/cashier/page.tsx";
const launchPath = "app/cashier/launch/page.tsx";
const dynamicIdPath = "app/api/cashier/orders/[id]/route.ts";
const dynamicJobIdPath = "app/api/es-tray-02/network-agent/print-jobs/[jobId]/result/route.ts";
const dynamicOrderNoPath = "app/api/orders/[orderNo]/checkout/route.ts";
const siblingDynamicJobIdPath = "app/api/cashier/orders/[jobId]/route.ts";
const schemaHash = "a".repeat(64);
const migrationHash = "b".repeat(64);
const cashierHash = "c".repeat(64);
const launchHash = "d".repeat(64);
const dynamicIdHash = "e".repeat(64);
const dynamicJobIdHash = "f".repeat(64);
const dynamicOrderNoHash = "0".repeat(64);

const config = {
  forbidden_paths: {
    absolute: [
      schemaPath,
      cashierPath,
      launchPath,
      dynamicIdPath,
      dynamicJobIdPath,
      dynamicOrderNoPath,
      siblingDynamicJobIdPath,
    ],
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

function launchAuthorization(overrides = {}) {
  return {
    authorizationId: "A12.2-DESKTOP-POS-LAUNCH-PAGE",
    featureBranch: launchFeatureBranch,
    lineageMode: "PRE_COMMIT_CONTENT_SHA256",
    baseOriginMainSha: "5".repeat(40),
    status: "ACTIVE",
    authorizedPaths: [launchPath],
    authorizedPathSha256: { [launchPath]: launchHash },
    createdAt: "2026-09-05T16:09:48Z",
    approvedAt: "2026-09-05T16:09:48Z",
    approvedBy: "Founder",
    closeAfter: "FEATURE_MERGE",
    reason: "authorize the exact reviewed Desktop POS launch-page redirect draft",
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

function exceptionWithLaunch(overrides = {}) {
  return exception({
    additionalAuthorizations: [cashierAuthorization(), launchAuthorization(overrides)],
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
        [launchPath]: launchHash,
        [dynamicIdPath]: dynamicIdHash,
        [dynamicJobIdPath]: dynamicJobIdHash,
        [dynamicOrderNoPath]: dynamicOrderNoHash,
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
  const fixtureLaunch = Buffer.from("approved launch redirect\n");
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
  fs.mkdirSync(path.join(fixtureRoot, path.dirname(launchPath)), { recursive: true });

  runGit(fixtureRoot, ["init", "-q"]);
  runGit(fixtureRoot, ["config", "user.name", "Dev Gate Test"]);
  runGit(fixtureRoot, ["config", "user.email", "dev-gate@example.invalid"]);
  fs.writeFileSync(fixtureConfigPath, JSON.stringify(config));
  fs.writeFileSync(path.join(fixtureRoot, cashierPath), "base cashier entry\n");
  fs.writeFileSync(path.join(fixtureRoot, launchPath), "base launch redirect\n");
  runGit(fixtureRoot, ["add", "docs/change-gates/gate-config.json", cashierPath, launchPath]);
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
    additionalAuthorizations: [
      {
        ...cashierAuthorization({ baseOriginMainSha: baseSha }),
        authorizedPathSha256: {
          [cashierPath]: crypto.createHash("sha256").update(fixtureCashier).digest("hex"),
        },
      },
      {
        ...launchAuthorization({ baseOriginMainSha: baseSha }),
        authorizedPathSha256: {
          [launchPath]: crypto.createHash("sha256").update(fixtureLaunch).digest("hex"),
        },
      },
    ],
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
  runGit(fixtureRoot, ["checkout", "-q", "-b", launchFeatureBranch, baseSha]);
  runGit(fixtureRoot, ["merge", "-q", "--no-edit", "governance-exception"]);
  runGit(fixtureRoot, ["checkout", "-q", featureBranch]);

  return {
    fixtureRoot,
    fixtureConfigPath,
    fixtureExceptionPath,
    fixtureCashier,
    fixtureLaunch,
    record,
  };
}

function runGuardCli(fixtureRoot, files, requestedTaskId = taskId) {
  return childProcess.spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, "check-change-scope.js"),
      "--task-id",
      requestedTaskId,
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

test("primary authorization accepts exact Next.js [id] and [orderNo] route paths", () => {
  const record = exception({
    authorizedPaths: [dynamicIdPath, dynamicOrderNoPath],
    authorizedPathSha256: {
      [dynamicIdPath]: dynamicIdHash,
      [dynamicOrderNoPath]: dynamicOrderNoHash,
    },
  });

  assert.equal(evaluate(dynamicIdPath, { exception: record }).allowed, true);
  assert.equal(evaluate(dynamicOrderNoPath, { exception: record }).allowed, true);
});

test("additional authorization accepts an exact Next.js [jobId] route path", () => {
  const networkFeatureBranch = "codex/network-agent-dynamic-route-test";
  const record = exception({
    additionalAuthorizations: [cashierAuthorization({
      authorizationId: "A13.1-NETWORK-JOB-RESULT-ROUTE",
      featureBranch: networkFeatureBranch,
      authorizedPaths: [dynamicJobIdPath],
      authorizedPathSha256: { [dynamicJobIdPath]: dynamicJobIdHash },
    })],
  });
  const result = evaluate(dynamicJobIdPath, {
    exception: record,
    currentBranch: networkFeatureBranch,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.exceptionApplied, true);
});

test("authorization for [id] does not match the sibling [jobId] route", () => {
  const record = exception({
    authorizedPaths: [dynamicIdPath],
    authorizedPathSha256: { [dynamicIdPath]: dynamicIdHash },
  });

  const result = evaluate(siblingDynamicJobIdPath, { exception: record });

  assert.equal(result.allowed, false);
  assert.match(result.reason, /not exactly authorized/);
});

test("exception paths containing *, ?, {, or } remain rejected", () => {
  for (const candidate of [
    "app/api/orders/*/route.ts",
    "app/api/orders/?/route.ts",
    "app/api/orders/{id}/route.ts",
    "app/api/orders/id}/route.ts",
  ]) {
    assert.throws(
      () => exception({
        authorizedPaths: [candidate],
        authorizedPathSha256: { [candidate]: dynamicIdHash },
      }),
      (error) => error instanceof GuardInputError
    );
  }
});

test("exception paths containing traversal or absolute syntax remain rejected", () => {
  for (const candidate of [
    "app/api/orders/../cashier/route.ts",
    path.join(repoRoot, "app", "api", "orders", "[id]", "route.ts"),
  ]) {
    assert.throws(
      () => exception({
        authorizedPaths: [candidate],
        authorizedPathSha256: { [candidate]: dynamicIdHash },
      }),
      (error) => error instanceof GuardInputError
    );
  }
});

test("percent-encoded authorization path syntax remains rejected", () => {
  const encodedTraversalPath = "app/api/orders/%2e%2e/cashier/route.ts";
  assert.throws(
    () => exception({
      authorizedPaths: [encodedTraversalPath],
      authorizedPathSha256: { [encodedTraversalPath]: dynamicIdHash },
    }),
    (error) => error instanceof GuardInputError
  );
});

test("dynamic route content must retain its exact authorized SHA-256", () => {
  const record = exception({
    authorizedPaths: [dynamicIdPath],
    authorizedPathSha256: { [dynamicIdPath]: dynamicIdHash },
  });
  const result = evaluate(dynamicIdPath, {
    exception: record,
    contentHashResolver: () => "1".repeat(64),
  });

  assert.equal(result.allowed, false);
  assert.match(result.reason, /SHA-256 mismatch/);
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

test("default deny blocks app/cashier/launch/page.tsx without an exception", () => {
  assert.equal(evaluateFile({ filePath: launchPath, repoRoot, config }).allowed, false);
});

test("an ACTIVE launch authorization allows only the exact approved launch-page draft", () => {
  const result = evaluate(launchPath, {
    exception: exceptionWithLaunch(),
    currentBranch: launchFeatureBranch,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.exceptionApplied, true);
  assert.match(result.reason, /A12\.2-DESKTOP-POS-LAUNCH-PAGE/);
});

test("the launch authorization blocks sibling launch files", () => {
  const result = evaluate("app/cashier/launch/other.tsx", {
    exception: exceptionWithLaunch(),
    currentBranch: launchFeatureBranch,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /outside the exact task-scoped authorization/);
});

test("the launch authorization does not inherit the separate cashier-page grant", () => {
  const result = evaluate(cashierPath, {
    exception: exceptionWithLaunch(),
    currentBranch: launchFeatureBranch,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /not exactly authorized/);
});

test("the launch authorization does not permit another forbidden namespace", () => {
  const result = evaluate("app/api/print/route.ts", {
    exception: exceptionWithLaunch(),
    currentBranch: launchFeatureBranch,
  });
  assert.equal(result.allowed, false);
});

test("the launch authorization blocks the wrong branch", () => {
  const result = evaluate(launchPath, {
    exception: exceptionWithLaunch(),
    currentBranch: "codex/unrelated",
  });
  assert.equal(result.allowed, false);
});

test("the launch authorization blocks the wrong task", () => {
  const result = evaluate(launchPath, {
    exception: exceptionWithLaunch(),
    currentBranch: launchFeatureBranch,
    taskId: "ES-PRINT-DUAL-CHANNEL-02",
  });
  assert.equal(result.allowed, false);
});

test("tampered launch-page content fails the approved hash check", () => {
  const result = evaluate(launchPath, {
    exception: exceptionWithLaunch(),
    currentBranch: launchFeatureBranch,
    contentHashResolver: () => "e".repeat(64),
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /SHA-256 mismatch/);
});

test("a CLOSED launch authorization cannot allow the exact path", () => {
  const record = exceptionWithLaunch({
    status: "CLOSED",
    closedAt: "2026-09-06T16:09:48Z",
    featureMergeCommitSha: "6".repeat(40),
  });
  assert.equal(evaluate(launchPath, {
    exception: record,
    currentBranch: launchFeatureBranch,
  }).allowed, false);
});

test("a malformed launch authorization fails closed", () => {
  assert.throws(
    () => exception({
      additionalAuthorizations: [
        cashierAuthorization(),
        launchAuthorization({ lineageMode: "SKIP_LINEAGE" }),
      ],
    }),
    (error) => error instanceof GuardInputError
  );
});

test("the launch authorization rejects wildcard expansion", () => {
  assert.throws(
    () => exceptionWithLaunch({
      authorizedPaths: ["app/cashier/launch/**"],
      authorizedPathSha256: { "app/cashier/launch/**": launchHash },
    }),
    (error) => error instanceof GuardInputError
  );
});

test("adding the launch authorization leaves existing cashier and Prisma grants unchanged", () => {
  const record = exceptionWithLaunch();
  assert.equal(evaluate(cashierPath, {
    exception: record,
    currentBranch: desktopFeatureBranch,
  }).allowed, true);
  assert.equal(evaluate(schemaPath, {
    exception: record,
    currentBranch: featureBranch,
  }).allowed, true);
  assert.equal(evaluate(migrationPath, {
    exception: record,
    currentBranch: featureBranch,
  }).allowed, true);
});

test("the committed ES-PRINT exception record satisfies the strict contract", () => {
  const recordPath = path.resolve(
    __dirname,
    "../../docs/change-gates/exceptions/ES-PRINT-DUAL-CHANNEL-01.json"
  );
  const record = validateException(JSON.parse(fs.readFileSync(recordPath, "utf8")), path.resolve(__dirname, "../.."));
  assert.equal(record.taskId, taskId);
  assert.deepEqual(record.authorizedPaths, [schemaPath, migrationPath]);
  assert.equal(record.additionalAuthorizations.length, 2);
  assert.equal(record.additionalAuthorizations[0].authorizationId, "A11.2-DESKTOP-POS-CASHIER-PAGE");
  assert.equal(record.additionalAuthorizations[1].authorizationId, "A12.2-DESKTOP-POS-LAUNCH-PAGE");
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

test("the trusted CLI accepts the approved launch-page draft only on its exact branch", () => {
  const { fixtureRoot, fixtureLaunch } = createTrustedCliFixture();
  try {
    runGit(fixtureRoot, ["checkout", "-q", launchFeatureBranch]);
    fs.writeFileSync(path.join(fixtureRoot, launchPath), fixtureLaunch);
    const result = runGuardCli(fixtureRoot, [launchPath]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /A12\.2-DESKTOP-POS-LAUNCH-PAGE/);
    assert.match(result.stdout, /PASS/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("the trusted CLI blocks launch tampering, launch siblings, and the separately authorized cashier page", () => {
  const { fixtureRoot } = createTrustedCliFixture();
  try {
    runGit(fixtureRoot, ["checkout", "-q", launchFeatureBranch]);
    fs.writeFileSync(path.join(fixtureRoot, launchPath), "tampered launch redirect\n");
    fs.writeFileSync(path.join(fixtureRoot, "app/cashier/launch/other.tsx"), "scope creep\n");
    const tampered = runGuardCli(fixtureRoot, [launchPath]);
    const sibling = runGuardCli(fixtureRoot, ["app/cashier/launch/other.tsx"]);
    const cashier = runGuardCli(fixtureRoot, [cashierPath]);
    assert.equal(tampered.status, 1, tampered.stdout + tampered.stderr);
    assert.match(tampered.stdout, /authorized content SHA-256 mismatch/);
    assert.equal(sibling.status, 1, sibling.stdout + sibling.stderr);
    assert.match(sibling.stdout, /outside the exact task-scoped authorization/);
    assert.equal(cashier.status, 1, cashier.stdout + cashier.stderr);
    assert.match(cashier.stdout, /path is not exactly authorized/);
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

const standaloneTaskId = "ES-GUARD-PRECOMMIT-TEST-01";
const standaloneBranch = "codex/guard-precommit-test";
const ordinaryPath = "lib/guard-fixture.ts";
const otherOrdinaryPath = "scripts/guard-fixture.ts";
const ordinaryHash = "6".repeat(64);

function standaloneException(overrides = {}) {
  const { authorizedCommits, additionalAuthorizations, ...record } = exception();
  return validateException({
    ...record,
    taskId: standaloneTaskId,
    featureBranch: standaloneBranch,
    lineageMode: "PRE_COMMIT_CONTENT_SHA256",
    authorizedPaths: [ordinaryPath],
    authorizedPathSha256: { [ordinaryPath]: ordinaryHash },
    ...overrides,
  }, repoRoot);
}

test("standalone pre-commit authorization needs no feature commit or additional grant", () => {
  const record = standaloneException();
  assert.equal(record.lineageMode, "PRE_COMMIT_CONTENT_SHA256");
  assert.equal(Object.hasOwn(record, "authorizedCommits"), false);
  assert.deepEqual(record.additionalAuthorizations, []);
});

test("primary lineage mode is explicit or legacy-defaulted, never ambiguous", () => {
  assert.doesNotThrow(() => exception());
  assert.doesNotThrow(() => exception({ lineageMode: "AUTHORIZED_COMMITS" }));
  for (const lineageMode of [null, "", "SKIP_LINEAGE", "pre_commit_content_sha256"]) {
    assert.throws(() => exception({ lineageMode }), GuardInputError);
  }
  for (const authorizedCommits of [undefined, null, [], ["short"], ["A".repeat(40)]]) {
    for (const lineageMode of [undefined, "AUTHORIZED_COMMITS"]) {
      assert.throws(() => exception({ lineageMode, authorizedCommits }), GuardInputError);
    }
  }
  for (const authorizedCommits of [undefined, null, [], ["2".repeat(40)]]) {
    assert.throws(() => standaloneException({ authorizedCommits }), /must not contain authorizedCommits/);
  }
});

test("standalone authorization retains Founder, dates, closure, exact path and hash rules", () => {
  for (const overrides of [
    { approvedBy: "Reviewer" }, { trustedRef: "HEAD" }, { taskId: "invalid/task" },
    { featureBranch: "" }, { baseOriginMainSha: "short" }, { reason: "" },
    { authorizationType: "SELF_APPROVED" }, { closeAfter: "NEVER" },
    { createdAt: "invalid" }, { approvedAt: "2026-09-04T08:35:16Z" },
    { status: "APPROVED" }, { status: "CLOSED" }, { closedAt: "2026-09-06T08:35:16Z" },
    { authorizedPaths: [] }, { authorizedPaths: [ordinaryPath, ordinaryPath] },
    { authorizedPathSha256: {} },
    { authorizedPathSha256: { [ordinaryPath]: ordinaryHash, [otherOrdinaryPath]: ordinaryHash } },
    { authorizedPathSha256: { [ordinaryPath]: "A".repeat(64) } },
  ]) {
    assert.throws(() => standaloneException(overrides), GuardInputError, JSON.stringify(overrides));
  }
  for (const candidate of [
    "lib/*.ts", "lib/?.ts", "lib/{file}.ts", "lib/../file.ts", "./lib/file.ts",
    "/lib/file.ts", "lib//file.ts", "lib/./file.ts", "lib/%2e%2e/file.ts",
  ]) {
    assert.throws(() => standaloneException({
      authorizedPaths: [candidate], authorizedPathSha256: { [candidate]: ordinaryHash },
    }), GuardInputError, candidate);
  }
});

for (const mode of ["primary legacy", "primary pre-commit", "additional pre-commit"]) {
  test(`${mode}: every listed non-forbidden file remains task, branch, status and hash bound`, () => {
    const makeRecord = (overrides = {}) => {
      const grant = {
        authorizedPaths: [ordinaryPath], authorizedPathSha256: { [ordinaryPath]: ordinaryHash },
        ...overrides,
      };
      if (mode === "primary pre-commit") return standaloneException(grant);
      if (mode === "primary legacy") return exception(grant);
      return exception({ additionalAuthorizations: [cashierAuthorization(grant)] });
    };
    const record = makeRecord();
    const branch = mode === "primary pre-commit" ? standaloneBranch
      : mode === "primary legacy" ? featureBranch : desktopFeatureBranch;
    const options = {
      exception: record, taskId: record.taskId, currentBranch: branch,
      contentHashResolver: () => ordinaryHash,
    };
    const accepted = evaluate(ordinaryPath, options);
    assert.equal(accepted.allowed, true);
    assert.equal(accepted.exceptionApplied, true);
    for (const [changed, reason] of [
      [{ contentHashResolver: () => "7".repeat(64) }, /SHA-256 mismatch/],
      [{ contentHashResolver: () => { throw new Error("EACCES"); } }, /hash unavailable/],
      [{ taskId: "ES-GUARD-WRONG-TASK" }, /taskId mismatch/],
      [{ currentBranch: "codex/unrelated" }, /branch is not authorized/],
      [{ exception: makeRecord({
        status: "CLOSED", closedAt: "2026-09-06T13:56:29Z", featureMergeCommitSha: "8".repeat(40),
      }) }, /not ACTIVE/],
    ]) {
      const result = evaluate(ordinaryPath, { ...options, ...changed });
      assert.equal(result.allowed, false);
      assert.match(result.reason, reason);
    }
    const sibling = evaluate("lib/unlisted-fixture.ts", options);
    assert.equal(sibling.allowed, false);
    assert.match(sibling.reason, /outside the exact task-scoped authorization/);
    assert.equal(evaluate("docs/unrelated.md", options).allowed, true);
  });
}

test("non-forbidden paths cannot inherit another branch's primary or additional grant", () => {
  for (const primary of [exception(), standaloneException()]) {
    const record = validateException({
      ...primary,
      authorizedPaths: [ordinaryPath], authorizedPathSha256: { [ordinaryPath]: ordinaryHash },
      additionalAuthorizations: [cashierAuthorization({
        authorizedPaths: [otherOrdinaryPath], authorizedPathSha256: { [otherOrdinaryPath]: ordinaryHash },
      })],
    }, repoRoot);
    for (const [candidate, branch] of [[ordinaryPath, desktopFeatureBranch], [otherOrdinaryPath, primary.featureBranch]]) {
      const result = evaluate(candidate, {
        exception: record, taskId: record.taskId, currentBranch: branch, contentHashResolver: () => ordinaryHash,
      });
      assert.equal(result.allowed, false);
      assert.match(result.reason, /not exactly authorized/);
    }
  }
});

test("without task opt-in ordinary default behavior is unchanged and protected files stay blocked", () => {
  const record = standaloneException();
  assert.equal(evaluate(ordinaryPath, {
    exception: record, taskId: null, contentHashResolver: () => { throw new Error("must not hash"); },
  }).allowed, true);
  assert.equal(evaluate(schemaPath, { exception: record, taskId: null }).allowed, false);
});

// All Git writes below are disposable test fixtures, never commits in this project.
function createStandaloneCliFixture({ outsideMainBase = false, closed = false } = {}) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guard-standalone-precommit-"));
  const fixtureConfigPath = path.join(fixtureRoot, "docs/change-gates/gate-config.json");
  const fixtureExceptionPath = path.join(fixtureRoot, `docs/change-gates/exceptions/${standaloneTaskId}.json`);
  const approvedBytes = Buffer.from("uncommitted exact draft\n");
  fs.mkdirSync(path.dirname(fixtureExceptionPath), { recursive: true });
  runGit(fixtureRoot, ["init", "-q"]);
  runGit(fixtureRoot, ["config", "user.name", "Dev Gate Test"]);
  runGit(fixtureRoot, ["config", "user.email", "dev-gate@example.invalid"]);
  fs.writeFileSync(fixtureConfigPath, JSON.stringify(config));
  runGit(fixtureRoot, ["add", "docs/change-gates/gate-config.json"]);
  runGit(fixtureRoot, ["commit", "-q", "-m", "test: establish governance fixture"]);
  const initialSha = runGit(fixtureRoot, ["rev-parse", "HEAD"]);
  runGit(fixtureRoot, ["commit", "-q", "--allow-empty", "-m", "test: establish approved base"]);
  const baseSha = runGit(fixtureRoot, ["rev-parse", "HEAD"]);
  const record = standaloneException({
    baseOriginMainSha: outsideMainBase
      ? runGit(fixtureRoot, ["commit-tree", "HEAD^{tree}", "-m", "test: unrelated root"])
      : baseSha,
    authorizedPaths: [ordinaryPath, dynamicIdPath],
    authorizedPathSha256: Object.fromEntries([ordinaryPath, dynamicIdPath].map((candidate) => [
      candidate, crypto.createHash("sha256").update(approvedBytes).digest("hex"),
    ])),
    ...(closed ? {
      status: "CLOSED", closedAt: "2026-09-06T13:56:29Z", featureMergeCommitSha: baseSha,
    } : {}),
  });
  fs.writeFileSync(fixtureExceptionPath, JSON.stringify(record));
  runGit(fixtureRoot, ["add", `docs/change-gates/exceptions/${standaloneTaskId}.json`]);
  runGit(fixtureRoot, ["commit", "-q", "-m", "test: publish standalone governance grant"]);
  runGit(fixtureRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  runGit(fixtureRoot, ["checkout", "-q", "-b", standaloneBranch]);
  for (const candidate of record.authorizedPaths) {
    fs.mkdirSync(path.dirname(path.join(fixtureRoot, candidate)), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, candidate), approvedBytes);
  }
  return { fixtureRoot, fixtureConfigPath, fixtureExceptionPath, approvedBytes, initialSha, record };
}

test("standalone CLI accepts protected and ordinary exact drafts without any feature commit", () => {
  const { fixtureRoot, record } = createStandaloneCliFixture();
  try {
    assert.equal(runGit(fixtureRoot, ["log", "--all", "--format=%H", "--", ...record.authorizedPaths]), "");
    assert.equal(runGit(fixtureRoot, ["diff", "--cached", "--name-only"]), "");
    const result = runGuardCli(fixtureRoot, record.authorizedPaths, standaloneTaskId);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("standalone CLI rejects wrong bytes, missing files, symlinks and directories outside forbidden paths", () => {
  const { fixtureRoot, approvedBytes } = createStandaloneCliFixture();
  try {
    const target = path.join(fixtureRoot, ordinaryPath);
    for (const [prepare, expected] of [
      [() => fs.writeFileSync(target, "changed bytes\n"), /SHA-256 mismatch/],
      [() => fs.unlinkSync(target), /content hash unavailable/],
      [() => fs.symlinkSync(path.join(fixtureRoot, dynamicIdPath), target), /not a regular file/],
      [() => { fs.unlinkSync(target); fs.mkdirSync(target); }, /not a regular file/],
    ]) {
      prepare();
      const result = runGuardCli(fixtureRoot, [ordinaryPath], standaloneTaskId);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, expected);
    }
    assert.deepEqual(fs.readFileSync(path.join(fixtureRoot, dynamicIdPath)), approvedBytes);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("standalone CLI rejects wrong task or branch and tampered trusted governance inputs", () => {
  const fixture = createStandaloneCliFixture();
  const { fixtureRoot, fixtureConfigPath, fixtureExceptionPath, record } = fixture;
  try {
    const originalConfig = fs.readFileSync(fixtureConfigPath);
    const originalException = fs.readFileSync(fixtureExceptionPath);
    const wrongTask = runGuardCli(fixtureRoot, [ordinaryPath], "ES-GUARD-WRONG-TASK");
    assert.equal(wrongTask.status, 1);
    assert.match(wrongTask.stdout, /no trusted origin\/main exception/);
    runGit(fixtureRoot, ["checkout", "-q", "-b", "codex/wrong-branch"]);
    const wrongBranch = runGuardCli(fixtureRoot, [ordinaryPath], standaloneTaskId);
    assert.equal(wrongBranch.status, 1);
    assert.match(wrongBranch.stdout, /current branch is not uniquely authorized/);
    runGit(fixtureRoot, ["checkout", "-q", standaloneBranch]);
    for (const [file, content, expected] of [
      [fixtureExceptionPath, JSON.stringify({ ...record, approvedBy: "Self" }), /working-tree exception differs/],
      [fixtureConfigPath, JSON.stringify({ forbidden_paths: {} }), /working-tree gate config differs/],
    ]) {
      fs.writeFileSync(file, content);
      const result = runGuardCli(fixtureRoot, [ordinaryPath], standaloneTaskId);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, expected);
      fs.writeFileSync(fixtureConfigPath, originalConfig);
      fs.writeFileSync(fixtureExceptionPath, originalException);
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("standalone CLI retains approved-base ancestry checks against both main and HEAD", () => {
  for (const outsideMainBase of [true, false]) {
    const { fixtureRoot, fixtureExceptionPath, initialSha, record } = createStandaloneCliFixture({ outsideMainBase });
    try {
      if (!outsideMainBase) {
        runGit(fixtureRoot, ["checkout", "-q", "-B", standaloneBranch, initialSha]);
        fs.mkdirSync(path.dirname(fixtureExceptionPath), { recursive: true });
        fs.writeFileSync(fixtureExceptionPath, JSON.stringify(record));
      }
      const result = runGuardCli(fixtureRoot, [ordinaryPath], standaloneTaskId);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, outsideMainBase
        ? /base is not an ancestor of trusted origin\/main/
        : /pre-commit authorization base is not an ancestor of current HEAD/);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});

test("standalone CLI rejects a trusted CLOSED grant", () => {
  const { fixtureRoot } = createStandaloneCliFixture({ closed: true });
  try {
    const result = runGuardCli(fixtureRoot, [ordinaryPath], standaloneTaskId);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /exception is not ACTIVE/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("legacy CLI still rejects a feature HEAD missing its authorized commit", () => {
  const { fixtureRoot, fixtureExceptionPath, record } = createTrustedCliFixture();
  try {
    runGit(fixtureRoot, ["checkout", "-q", "-B", featureBranch, record.baseOriginMainSha]);
    fs.mkdirSync(path.dirname(fixtureExceptionPath), { recursive: true });
    fs.writeFileSync(fixtureExceptionPath, JSON.stringify(record));
    const result = runGuardCli(fixtureRoot, [schemaPath]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /authorized commit .* is not an ancestor of current HEAD/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("legacy CLI still binds trusted approved hashes to actual authorized commit bytes", () => {
  const { fixtureRoot, fixtureExceptionPath, record } = createTrustedCliFixture();
  try {
    runGit(fixtureRoot, ["checkout", "-q", "governance-exception"]);
    const changedRecord = JSON.stringify({
      ...record, authorizedPathSha256: { ...record.authorizedPathSha256, [schemaPath]: "9".repeat(64) },
    });
    fs.writeFileSync(fixtureExceptionPath, changedRecord);
    runGit(fixtureRoot, ["add", `docs/change-gates/exceptions/${taskId}.json`]);
    runGit(fixtureRoot, ["commit", "-q", "-m", "test: publish mismatched legacy approval"]);
    runGit(fixtureRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    runGit(fixtureRoot, ["checkout", "-q", featureBranch]);
    fs.writeFileSync(fixtureExceptionPath, changedRecord);
    const result = runGuardCli(fixtureRoot, [schemaPath]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /authorized commit content hash mismatch/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
