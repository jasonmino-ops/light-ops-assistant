import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const lineageScript = path.join(repositoryRoot, "scripts/check-release-lineage.sh");
const selectiveScript = path.join(repositoryRoot, "scripts/check-selective-release.sh");

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout || ""}${result.stderr || ""}` };
}

function commit(repo, message) {
  git(repo, "add", "--all");
  git(repo, "commit", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function write(repo, filePath, contents) {
  const target = path.join(repo, filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function initRepository(initializer = null) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "es-selective-release-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "governance-test@example.invalid");
  git(repo, "config", "user.name", "Governance Fixture");
  write(repo, "README.md", "base\n");
  if (initializer) initializer(repo);
  const base = commit(repo, "fixture: base");
  fs.appendFileSync(path.join(repo, ".git", "info", "exclude"), "release-record.json\n");
  return { repo, base };
}

function createFixture(kind = "text") {
  const fixture = initRepository((repo) => {
    if (kind === "rename") write(repo, "old.txt", "rename me\n");
    if (kind === "mode") write(repo, "mode.txt", "mode\n");
  });
  const { repo, base } = fixture;

  if (kind === "rename") {
    git(repo, "mv", "old.txt", "new.txt");
  } else if (kind === "mode") {
    fs.chmodSync(path.join(repo, "mode.txt"), 0o755);
  } else if (kind === "schema") {
    write(repo, "prisma/schema.prisma", "datasource db { provider = \"postgresql\" }\n");
  } else if (kind === "migration") {
    write(repo, "prisma/migrations/20260928000000_fixture/migration.sql", "CREATE TABLE fixture(id TEXT);\n");
  } else if (kind === "binary") {
    fs.writeFileSync(path.join(repo, "binary.bin"), Buffer.from([0, 1, 2, 3, 4]));
  } else {
    write(repo, "selected.txt", "selected\n");
  }

  const source = commit(repo, `fixture: source ${kind}`);
  git(repo, "update-ref", "refs/remotes/origin/main", source);
  fixture.source = source;
  fixture.main = source;

  git(repo, "checkout", "-q", "-b", "release", base);
  if (kind === "whitespace") {
    write(repo, "selected.txt", "selected  \n");
    fixture.release = commit(repo, `fixture: release whitespace\n\n(cherry picked from commit ${source})`);
  } else if (kind === "different-path") {
    write(repo, "other.txt", "selected\n");
    fixture.release = commit(repo, `fixture: release different path\n\n(cherry picked from commit ${source})`);
  } else if (kind === "unmatched") {
    write(repo, "selected.txt", "selected\n");
    fixture.release = commit(repo, "fixture: release without source mapping");
  } else {
    git(repo, "cherry-pick", "-x", source);
    fixture.release = git(repo, "rev-parse", "HEAD");
  }
  fixture.recordPath = path.join(repo, "release-record.json");
  fs.writeFileSync(fixture.recordPath, JSON.stringify({
    releaseId: "fixture-release",
    taskIds: ["ES-RELEASE-FIXTURE-01"],
    baseProductionSha: base,
    sourceMainSha: fixture.main,
    includedSourceCommits: [source],
    founderAuthorization: {
      authorizationId: "FOUNDER-FIXTURE-01",
      approvedBy: "Founder",
      status: "APPROVED",
      approvedAt: "2026-09-28T00:00:00Z",
      includedSourceCommits: [source],
    },
    releaseSha: fixture.release,
    deploymentId: "PENDING",
    productionSha: "PENDING",
  }, null, 2));
  return fixture;
}

test("STRICT remains the default development proof", () => {
  const fixture = createFixture();
  const result = run(lineageScript, [fixture.base], fixture.repo);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Lineage Mode:\nSTRICT/);
  assert.match(result.output, /Safe Development Base:\nYES/);
});

test("CONTENT_SUBSET passes a P5-like mapped cherry-pick", () => {
  const fixture = createFixture();
  const result = run(lineageScript, [fixture.release], fixture.repo);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Lineage Mode:\nCONTENT_SUBSET/);
  assert.match(result.output, /Safe Development Base:\nYES/);
  assert.match(result.output, /CONTENT_SUBSET: PASS/);
});

test("CONTENT_SUBSET rejects whitespace-only mutation", () => {
  const fixture = createFixture("whitespace");
  const result = run(lineageScript, [fixture.release], fixture.repo);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /REASON:\nFINGERPRINT_MISMATCH/);
});

test("CONTENT_SUBSET rejects a path mismatch", () => {
  const fixture = createFixture("different-path");
  const result = run(lineageScript, [fixture.release], fixture.repo);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /REASON:\nFINGERPRINT_MISMATCH/);
});

test("selective validator passes the minimum V1 record", () => {
  const fixture = createFixture();
  const result = run(selectiveScript, [
    "--record", fixture.recordPath,
    "--production", fixture.base,
    "--trusted-ref", "origin/main",
    "--release-ref", fixture.release,
  ], fixture.repo);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /AUTHORIZED_SELECTIVE_RELEASE: PASS/);
  assert.match(result.output, /INFORMATIONAL OVERLAP REPORT:/);
});

for (const [kind, expectedReason] of [
  ["binary", "BINARY_FILE"],
  ["rename", "RENAME_OR_COPY"],
  ["mode", "MODE_CHANGE"],
  ["schema", "SCHEMA_OR_MIGRATION"],
  ["migration", "SCHEMA_OR_MIGRATION"],
  ["unmatched", "SOURCE_MAPPING_MISMATCH"],
]) {
  test(`selective validator rejects ${kind}`, () => {
    const fixture = createFixture(kind);
    const result = run(selectiveScript, [
      "--record", fixture.recordPath,
      "--production", fixture.base,
      "--trusted-ref", "origin/main",
      "--release-ref", fixture.release,
    ], fixture.repo);
    assert.notEqual(result.status, 0);
    assert.match(result.output, new RegExp(`REASON: ${expectedReason}`));
  });
}

test("selective validator rejects a source commit outside trusted main", () => {
  const fixture = initRepository();
  const { repo, base } = fixture;
  git(repo, "checkout", "-q", "-b", "side");
  write(repo, "side.txt", "side\n");
  const sideSource = commit(repo, "fixture: non-ancestor source");
  git(repo, "checkout", "-q", "main");
  write(repo, "main.txt", "main\n");
  const main = commit(repo, "fixture: trusted main");
  git(repo, "update-ref", "refs/remotes/origin/main", main);
  git(repo, "checkout", "-q", "-b", "release", base);
  write(repo, "side.txt", "side\n");
  const release = commit(repo, `fixture: release non-ancestor\n\n(cherry picked from commit ${sideSource})`);
  const recordPath = path.join(repo, "release-record.json");
  fs.writeFileSync(recordPath, JSON.stringify({
    releaseId: "fixture-release-non-ancestor",
    taskIds: ["ES-RELEASE-FIXTURE-01"],
    baseProductionSha: base,
    sourceMainSha: main,
    includedSourceCommits: [sideSource],
    founderAuthorization: {
      authorizationId: "FOUNDER-FIXTURE-02",
      approvedBy: "Founder",
      status: "APPROVED",
      approvedAt: "2026-09-28T00:00:00Z",
      includedSourceCommits: [sideSource],
    },
    releaseSha: release,
    deploymentId: "PENDING",
    productionSha: "PENDING",
  }, null, 2));
  const result = run(selectiveScript, ["--record", recordPath, "--production", base, "--release-ref", release], repo);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /REASON: SOURCE_NON_ANCESTOR/);
});

test("selective validator rejects a merge source commit", () => {
  const fixture = initRepository();
  const { repo, base } = fixture;
  git(repo, "checkout", "-q", "-b", "side");
  write(repo, "side.txt", "side\n");
  const side = commit(repo, "fixture: merge side");
  git(repo, "checkout", "-q", "main");
  write(repo, "main.txt", "main\n");
  commit(repo, "fixture: merge main");
  git(repo, "merge", "--no-ff", "-q", "side", "-m", "fixture: merge source");
  const mergeSource = git(repo, "rev-parse", "HEAD");
  git(repo, "update-ref", "refs/remotes/origin/main", mergeSource);
  git(repo, "checkout", "-q", "-b", "release", base);
  write(repo, "side.txt", "side\n");
  const release = commit(repo, `fixture: release merge source\n\n(cherry picked from commit ${mergeSource})`);
  const recordPath = path.join(repo, "release-record.json");
  fs.writeFileSync(recordPath, JSON.stringify({
    releaseId: "fixture-release-merge",
    taskIds: ["ES-RELEASE-FIXTURE-01"],
    baseProductionSha: base,
    sourceMainSha: mergeSource,
    includedSourceCommits: [mergeSource],
    founderAuthorization: {
      authorizationId: "FOUNDER-FIXTURE-03",
      approvedBy: "Founder",
      status: "APPROVED",
      approvedAt: "2026-09-28T00:00:00Z",
      includedSourceCommits: [mergeSource],
    },
    releaseSha: release,
    deploymentId: "PENDING",
    productionSha: "PENDING",
  }, null, 2));
  const result = run(selectiveScript, ["--record", recordPath, "--production", base, "--release-ref", release], repo);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /REASON: MERGE_COMMIT/);
  assert.notEqual(side, mergeSource);
});

test("normal release requires merge tree equality", () => {
  const fixture = createFixture();
  const { repo, base } = fixture;
  git(repo, "checkout", "-q", "main");
  write(repo, "normal.txt", "normal\n");
  const approvedMain = commit(repo, "fixture: approved normal release");
  git(repo, "checkout", "-q", "release");
  git(repo, "merge", "--no-ff", "-q", "main", "-m", "fixture: normal release merge");
  const resultCommit = git(repo, "rev-parse", "HEAD");
  const result = run(selectiveScript, [
    "--mode", "normal",
    "--release-base", fixture.release,
    "--approved-main", approvedMain,
    "--result", resultCommit,
  ], repo);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /NORMAL_RELEASE_TREE_EQUALITY: PASS/);
  assert.equal(base.length, 40);
});
