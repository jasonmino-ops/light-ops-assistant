import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createExecutionLedger,
  createNodeLedgerFileSystem,
  type ExecutionLedger,
  type LedgerFileHandle,
  type LedgerFileSystem,
  type LedgerGuard,
  type LedgerRecord,
  type LedgerResult,
} from "../src/main/printing/executionLedger";

const roots: string[] = [];
const fixedCreatedAt = "2026-01-01T00:00:00.000Z";
const futureExpiry = "2026-02-01T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "execution-ledger-"));
  roots.push(root);
  return root;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(entryPath)));
    else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}

function clock(value = fixedCreatedAt): () => Date {
  let current = new Date(value);
  return () => new Date(current.getTime());
}

function input(printJobId = "job-1", overrides: Partial<LedgerRecord> = {}) {
  return {
    printJobId,
    requestHash: overrides.requestHash ?? `hash-${printJobId}`,
    rendererVersion: overrides.rendererVersion ?? "renderer-v1",
    expiresAt: overrides.expiresAt ?? futureExpiry,
  };
}

function ledger(
  root: string,
  options: {
    now?: () => Date;
    platform?: NodeJS.Platform;
    fileSystem?: LedgerFileSystem;
    processId?: number;
    staleLockRecovery?: ConstructorParameters<typeof ExecutionLedger>[0]["staleLockRecovery"];
  } = {},
): ExecutionLedger {
  return createExecutionLedger({
    userDataPath: root,
    now: options.now ?? (() => new Date(fixedCreatedAt)),
    platform: options.platform ?? "win32",
    fileSystem: options.fileSystem,
    processId: options.processId,
    staleLockRecovery: options.staleLockRecovery,
  });
}

async function openLedger(
  root: string,
  options: {
    now?: () => Date;
    platform?: NodeJS.Platform;
    fileSystem?: LedgerFileSystem;
    processId?: number;
    staleLockRecovery?: ConstructorParameters<typeof ExecutionLedger>[0]["staleLockRecovery"];
  } = {},
): Promise<ExecutionLedger> {
  const instance = ledger(root, options);
  expect((await instance.open()).ok).toBe(true);
  return instance;
}

function guard(record: LedgerRecord): LedgerGuard {
  return {
    printJobId: record.printJobId,
    expectedExecutionId: record.executionId,
    expectedStateVersion: record.stateVersion,
  };
}

function errorCode<T>(result: LedgerResult<T>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

class FaultInjectingFileSystem implements LedgerFileSystem {
  private readonly base = createNodeLedgerFileSystem();
  public readonly events: string[] = [];
  public failure: "temp-sync" | "rename" | "final-sync" | "directory-sync" | null = null;

  public constructor(private readonly root: string) {}

  public async open(filePath: string, flags: string): Promise<LedgerFileHandle> {
    const handle = await this.base.open(filePath, flags);
    const isTemp = filePath.endsWith(".tmp");
    const isFinal = filePath === path.join(this.root, ".execution-ledger.json");
    const isDirectory = filePath === this.root;
    this.events.push(`open:${flags}:${path.basename(filePath)}`);
    return {
      writeFile: (data) => handle.writeFile(data),
      sync: async () => {
        const event = isTemp ? "temp-sync" : isFinal ? "final-sync" : isDirectory ? "directory-sync" : "lock-sync";
        this.events.push(`sync:${event}`);
        if (this.failure === event) {
          this.failure = null;
          throw new Error(`Injected ${event} failure`);
        }
        await handle.sync();
      },
      close: () => handle.close(),
    };
  }

  public async readFile(filePath: string): Promise<string> {
    return this.base.readFile(filePath);
  }

  public async rename(oldPath: string, newPath: string): Promise<void> {
    this.events.push("rename");
    if (this.failure === "rename") {
      this.failure = null;
      throw new Error("Injected rename failure");
    }
    await this.base.rename(oldPath, newPath);
  }

  public async unlink(filePath: string): Promise<void> {
    return this.base.unlink(filePath);
  }
}

class MappedFileSystem implements LedgerFileSystem {
  private readonly base = createNodeLedgerFileSystem();

  public constructor(private readonly root: string) {}

  private map(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    return path.join(this.root, path.basename(normalized));
  }

  public open(filePath: string, flags: string): Promise<LedgerFileHandle> {
    return this.base.open(this.map(filePath), flags);
  }

  public readFile(filePath: string): Promise<string> {
    return this.base.readFile(this.map(filePath));
  }

  public rename(oldPath: string, newPath: string): Promise<void> {
    return this.base.rename(this.map(oldPath), this.map(newPath));
  }

  public unlink(filePath: string): Promise<void> {
    return this.base.unlink(this.map(filePath));
  }
}

describe("ExecutionLedger lifecycle and identity", () => {
  it("has no runtime import or reference from the Desktop source tree", async () => {
    const sourceRoot = path.resolve(__dirname, "../src");
    const files = await sourceFiles(sourceRoot);
    const protectedSources = files.filter(
      (filePath) => !filePath.endsWith(path.join("printing", "executionLedger.ts")),
    );
    for (const filePath of protectedSources) {
      const source = await readFile(filePath, "utf8");
      expect(source, filePath).not.toContain("executionLedger");
    }
  });

  it("rejects every API before open and after close", async () => {
    const root = await makeRoot();
    const instance = ledger(root);
    const dummy = {
      printJobId: "job-1",
      expectedExecutionId: "00000000-0000-4000-8000-000000000000",
      expectedStateVersion: 0,
    };

    expect(errorCode(await instance.get("job-1"))).toBe("LEDGER_NOT_OPEN");
    expect(errorCode(await instance.accept(input()))).toBe("LEDGER_NOT_OPEN");
    expect(errorCode(await instance.beginCrossing(dummy))).toBe("LEDGER_NOT_OPEN");
    expect(errorCode(await instance.failNotCrossed({ ...dummy, zeroBytesSent: true }))).toBe(
      "LEDGER_NOT_OPEN",
    );
    expect(
      errorCode(await instance.confirmNotCrossed({
        executionPermit: {
          printJobId: dummy.printJobId,
          executionId: dummy.expectedExecutionId,
          stateVersion: dummy.expectedStateVersion,
        },
        zeroBytesSent: true,
      })),
    ).toBe("LEDGER_NOT_OPEN");
    expect(errorCode(await instance.retryFailedNotCrossed(dummy))).toBe("LEDGER_NOT_OPEN");
    expect(
      errorCode(await instance.markCrossed({ ...dummy, allBytesWritten: true, flushAndFinConfirmed: true })),
    ).toBe("LEDGER_NOT_OPEN");
    expect(errorCode(await instance.cancel(dummy))).toBe("LEDGER_NOT_OPEN");
    expect(errorCode(await instance.close())).toBe("LEDGER_NOT_OPEN");

    await instance.open();
    const created = await instance.accept(input());
    expect(created.ok).toBe(true);
    expect((await instance.close()).ok).toBe(true);

    expect(errorCode(await instance.get("job-1"))).toBe("LEDGER_NOT_OPEN");
    expect(errorCode(await instance.accept(input("job-2")))).toBe("LEDGER_NOT_OPEN");
    expect(errorCode(await instance.close())).toBe("LEDGER_NOT_OPEN");
  });

  it("uses all four identity fields and never extends an existing task", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const original = input();
    const created = await instance.accept(original);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const snapshot = created.value.record;

    const existing = await instance.accept({ ...original });
    expect(existing).toMatchObject({ ok: true, value: { kind: "EXISTING" } });

    expect(errorCode(await instance.accept({ ...original, requestHash: "different" }))).toBe(
      "LEDGER_IDENTITY_CONFLICT",
    );
    expect(errorCode(await instance.accept({ ...original, rendererVersion: "renderer-v2" }))).toBe(
      "LEDGER_IDENTITY_CONFLICT",
    );
    expect(errorCode(await instance.accept({ ...original, expiresAt: "2026-03-01T00:00:00.000Z" }))).toBe(
      "LEDGER_IDENTITY_CONFLICT",
    );

    const read = await instance.get(original.printJobId);
    expect(read).toMatchObject({ ok: true, value: { found: true, record: snapshot } });
    expect((read as { ok: true; value: { found: true; record: LedgerRecord } }).value.record.createdAt).toBe(
      snapshot.createdAt,
    );
    expect((read as { ok: true; value: { found: true; record: LedgerRecord } }).value.record.expiresAt).toBe(
      snapshot.expiresAt,
    );
    expect((read as { ok: true; value: { found: true; record: LedgerRecord } }).value.record.retainUntil).toBe(
      snapshot.retainUntil,
    );
  });
});

describe("ExecutionLedger state machine", () => {
  it("tracks logical executions, clears retry evidence, and keeps physical completion false", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const created = await instance.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.record.attemptCount).toBe(1);
    expect(created.value.record.stateVersion).toBe(0);
    expect(created.value.record.physicalCompletionKnown).toBe(false);

    const failed = await instance.failNotCrossed({
      ...guard(created.value.record),
      zeroBytesSent: true,
      lastErrorCode: "E_ZERO_BYTES",
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.value.attemptCount).toBe(1);
    expect(failed.value.stateVersion).toBe(1);

    const retried = await instance.retryFailedNotCrossed(guard(failed.value));
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.value.attemptCount).toBe(2);
    expect(retried.value.stateVersion).toBe(2);
    expect(retried.value.executionId).not.toBe(failed.value.executionId);
    expect(retried.value.zeroBytesSent).toBeUndefined();
    expect(retried.value.lastErrorCode).toBeUndefined();

    const crossed = await instance.beginCrossing(guard(retried.value));
    expect(crossed.ok).toBe(true);
    if (!crossed.ok) return;
    expect(crossed.value.record.attemptCount).toBe(2);
    expect(crossed.value.record.stateVersion).toBe(3);

    const terminal = await instance.markCrossed({
      ...guard(crossed.value.record),
      allBytesWritten: true,
      flushAndFinConfirmed: true,
    });
    expect(terminal.ok).toBe(true);
    if (!terminal.ok) return;
    expect(terminal.value.state).toBe("CROSSED");
    expect(terminal.value.attemptCount).toBe(2);
    expect(terminal.value.stateVersion).toBe(4);
    expect(terminal.value.physicalCompletionKnown).toBe(false);
    expect(errorCode(await instance.retryFailedNotCrossed(guard(terminal.value)))).toBe(
      "LEDGER_ILLEGAL_TRANSITION",
    );
  });

  it("closes the state machine and rejects stale or illegal callbacks without writing", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const created = await instance.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(
      errorCode(
        await instance.markCrossed({
          ...guard(created.value.record),
          allBytesWritten: true,
          flushAndFinConfirmed: true,
        }),
      ),
    ).toBe("LEDGER_ILLEGAL_TRANSITION");

    const failed = await instance.failNotCrossed({
      ...guard(created.value.record),
      zeroBytesSent: true,
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(errorCode(await instance.cancel(guard(failed.value)))).toBe(
      "LEDGER_ILLEGAL_TRANSITION",
    );
    expect(errorCode(await instance.failNotCrossed({ ...guard(created.value.record), zeroBytesSent: true }))).toBe(
      "LEDGER_STALE_GUARD",
    );

    const retried = await instance.retryFailedNotCrossed(guard(failed.value));
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    const crossing = await instance.beginCrossing(guard(retried.value));
    expect(crossing.ok).toBe(true);
    if (!crossing.ok) return;
    const rawBefore = await readFile(path.join(root, ".execution-ledger.json"), "utf8");

    expect(
      errorCode(await instance.failNotCrossed({ ...guard(crossing.value.record), zeroBytesSent: true })),
    ).toBe("LEDGER_ILLEGAL_TRANSITION");
    expect(errorCode(await instance.retryFailedNotCrossed(guard(crossing.value.record)))).toBe(
      "LEDGER_ILLEGAL_TRANSITION",
    );
    expect(errorCode(await instance.cancel(guard(crossing.value.record)))).toBe(
      "LEDGER_ILLEGAL_TRANSITION",
    );
    expect(await readFile(path.join(root, ".execution-ledger.json"), "utf8")).toBe(rawBefore);
  });

  it("requires the current execution permit and explicit zero-byte proof after the barrier", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const created = await instance.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const crossing = await instance.beginCrossing(guard(created.value.record));
    expect(crossing.ok).toBe(true);
    if (!crossing.ok) return;

    const permit = crossing.value.executionPermit;
    expect(
      errorCode(await instance.confirmNotCrossed({
        executionPermit: { ...permit, stateVersion: permit.stateVersion - 1 },
        zeroBytesSent: true,
      })),
    ).toBe("LEDGER_STALE_GUARD");
    expect(
      errorCode(await instance.confirmNotCrossed({
        executionPermit: { ...permit, executionId: "00000000-0000-4000-8000-000000000000" },
        zeroBytesSent: true,
      })),
    ).toBe("LEDGER_STALE_GUARD");

    expect(await instance.get(permit.printJobId)).toMatchObject({
      ok: true,
      value: { found: true, record: { state: "CROSSING_UNKNOWN" } },
    });

    const failed = await instance.confirmNotCrossed({
      executionPermit: permit,
      zeroBytesSent: true,
      lastErrorCode: "BOUNDARY_ZERO_BYTES",
    });
    expect(failed).toMatchObject({
      ok: true,
      value: {
        state: "FAILED_NOT_CROSSED",
        zeroBytesSent: true,
        lastErrorCode: "BOUNDARY_ZERO_BYTES",
        physicalCompletionKnown: false,
      },
    });
  });

  it("rejects missing or false zero-byte claims and keeps every ambiguous outcome UNKNOWN", async () => {
    for (const suffix of ["partial", "ambiguous", "throw", "timeout"]) {
      const root = await makeRoot();
      const instance = await openLedger(root);
      const created = await instance.accept(input(`job-${suffix}`));
      expect(created.ok).toBe(true);
      if (!created.ok) continue;
      const crossing = await instance.beginCrossing(guard(created.value.record));
      expect(crossing.ok).toBe(true);
      if (!crossing.ok) continue;

      const invalidProof = suffix === "partial"
        ? { executionPermit: crossing.value.executionPermit, zeroBytesSent: false }
        : { executionPermit: crossing.value.executionPermit };
      expect(
        errorCode(await instance.confirmNotCrossed(
          invalidProof as unknown as Parameters<ExecutionLedger["confirmNotCrossed"]>[0],
        )),
      ).toBe("LEDGER_INVALID_INPUT");

      expect(await instance.get(created.value.record.printJobId)).toMatchObject({
        ok: true,
        value: { found: true, record: { state: "CROSSING_UNKNOWN" } },
      });
      await instance.close();
      const reopened = await openLedger(root);
      expect(await reopened.get(created.value.record.printJobId)).toMatchObject({
        ok: true,
        value: { found: true, record: { state: "CROSSING_UNKNOWN" } },
      });
    }
  });

  it("does not downgrade CROSSED or reopen any terminal tombstone", async () => {
    for (const terminal of ["CROSSED", "FAILED_NOT_CROSSED", "CANCELLED"] as const) {
      const root = await makeRoot();
      const instance = await openLedger(root);
      const created = await instance.accept(input(`job-${terminal}`));
      expect(created.ok).toBe(true);
      if (!created.ok) continue;

      let terminalRecord: LedgerRecord;
      if (terminal === "CANCELLED") {
        const result = await instance.cancel(guard(created.value.record));
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        terminalRecord = result.value;
      } else if (terminal === "FAILED_NOT_CROSSED") {
        const result = await instance.failNotCrossed({
          ...guard(created.value.record),
          zeroBytesSent: true,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        terminalRecord = result.value;
      } else {
        const crossing = await instance.beginCrossing(guard(created.value.record));
        expect(crossing.ok).toBe(true);
        if (!crossing.ok) continue;
        const result = await instance.markCrossed({
          ...guard(crossing.value.record),
          allBytesWritten: true,
          flushAndFinConfirmed: true,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        terminalRecord = result.value;
      }

      expect(
        errorCode(await instance.confirmNotCrossed({
          executionPermit: {
            printJobId: terminalRecord.printJobId,
            executionId: terminalRecord.executionId,
            stateVersion: terminalRecord.stateVersion,
          },
          zeroBytesSent: true,
        })),
      ).toBe("LEDGER_ILLEGAL_TRANSITION");
      expect(await instance.get(terminalRecord.printJobId)).toMatchObject({
        ok: true,
        value: { found: true, record: { state: terminal } },
      });
    }
  });

  it("serializes competing zero-byte completion actors without opening a duplicate window", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const created = await instance.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const crossing = await instance.beginCrossing(guard(created.value.record));
    expect(crossing.ok).toBe(true);
    if (!crossing.ok) return;
    const proof = { executionPermit: crossing.value.executionPermit, zeroBytesSent: true as const };

    const [first, second] = await Promise.all([
      instance.confirmNotCrossed(proof),
      instance.confirmNotCrossed(proof),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(errorCode(first.ok ? second : first)).toBe("LEDGER_STALE_GUARD");
    expect(await instance.get(created.value.record.printJobId)).toMatchObject({
      ok: true,
      value: { found: true, record: { state: "FAILED_NOT_CROSSED", attemptCount: 1 } },
    });
  });

  it("persists post-barrier zero-byte completion across restart", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const created = await instance.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const crossing = await instance.beginCrossing(guard(created.value.record));
    expect(crossing.ok).toBe(true);
    if (!crossing.ok) return;
    expect((await instance.confirmNotCrossed({
      executionPermit: crossing.value.executionPermit,
      zeroBytesSent: true,
    })).ok).toBe(true);
    expect((await instance.close()).ok).toBe(true);

    const reopened = await openLedger(root);
    expect(await reopened.get(created.value.record.printJobId)).toMatchObject({
      ok: true,
      value: {
        found: true,
        record: { state: "FAILED_NOT_CROSSED", zeroBytesSent: true, physicalCompletionKnown: false },
      },
    });

    expect(
      errorCode(await reopened.confirmNotCrossed({
        executionPermit: crossing.value.executionPermit,
        zeroBytesSent: true,
      })),
    ).toBe("LEDGER_STALE_GUARD");
  });

  it("keeps the old permit stale after an explicit retry creates a new execution", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const created = await instance.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const crossing = await instance.beginCrossing(guard(created.value.record));
    expect(crossing.ok).toBe(true);
    if (!crossing.ok) return;
    const failed = await instance.confirmNotCrossed({
      executionPermit: crossing.value.executionPermit,
      zeroBytesSent: true,
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;

    const retried = await instance.retryFailedNotCrossed(guard(failed.value));
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.value.executionId).not.toBe(crossing.value.executionPermit.executionId);
    expect(retried.value.attemptCount).toBe(2);
    expect(
      errorCode(await instance.confirmNotCrossed({
        executionPermit: crossing.value.executionPermit,
        zeroBytesSent: true,
      })),
    ).toBe("LEDGER_STALE_GUARD");
    expect(await instance.get(retried.value.printJobId)).toMatchObject({
      ok: true,
      value: { found: true, record: { state: "NOT_CROSSED", attemptCount: 2 } },
    });
  });

  it("blocks a second ledger instance while the crossing owner holds the file lock", async () => {
    const root = await makeRoot();
    const owner = await openLedger(root);
    const created = await owner.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const crossing = await owner.beginCrossing(guard(created.value.record));
    expect(crossing.ok).toBe(true);
    if (!crossing.ok) return;

    const competing = ledger(root);
    expect(errorCode(await competing.open())).toBe("LEDGER_BUSY");
    expect((await owner.confirmNotCrossed({
      executionPermit: crossing.value.executionPermit,
      zeroBytesSent: true,
    })).ok).toBe(true);
  });

  it("rejects expired execution while still accepting an expired dedupe record", async () => {
    const root = await makeRoot();
    let current = new Date(fixedCreatedAt);
    const now = () => new Date(current.getTime());
    const instance = await openLedger(root, { now });
    const created = await instance.accept({ ...input(), expiresAt: "2025-12-31T00:00:00.000Z" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(errorCode(await instance.accept({ ...input(), expiresAt: "2026-03-01T00:00:00.000Z" }))).toBe(
      "LEDGER_IDENTITY_CONFLICT",
    );
    expect(errorCode(await instance.beginCrossing(guard(created.value.record)))).toBe("LEDGER_EXPIRED");

    current = new Date("2026-02-01T00:00:00.000Z");
    const valid = await instance.accept(input("job-2"));
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const failed = await instance.failNotCrossed({ ...guard(valid.value.record), zeroBytesSent: true });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    current = new Date("2026-03-01T00:00:00.000Z");
    expect(errorCode(await instance.retryFailedNotCrossed(guard(failed.value)))).toBe(
      "LEDGER_EXPIRED",
    );
  });

  it("keeps CANCELLED terminal and rejects invalid expiresAt without writing", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    expect(errorCode(await instance.accept({ ...input(), expiresAt: "not-a-utc-time" }))).toBe(
      "LEDGER_INVALID_INPUT",
    );
    expect(await instance.get("job-1")).toEqual({ ok: true, value: { found: false } });

    const created = await instance.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const cancelled = await instance.cancel(guard(created.value.record));
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(errorCode(await instance.retryFailedNotCrossed(guard(cancelled.value)))).toBe(
      "LEDGER_ILLEGAL_TRANSITION",
    );
  });

  it("rejects execution when expiresAt equals the current instant", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const created = await instance.accept({ ...input(), expiresAt: "2026-01-01T00:00:00.000Z" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(errorCode(await instance.beginCrossing(guard(created.value.record)))).toBe("LEDGER_EXPIRED");
  });

  it("serializes same-guard beginCrossing and preserves the UNKNOWN decision", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const created = await instance.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [first, second] = await Promise.all([
      instance.beginCrossing(guard(created.value.record)),
      instance.beginCrossing(guard(created.value.record)),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect([first.ok, second.ok].filter((value) => !value)).toHaveLength(1);
    expect(errorCode(first.ok ? second : first)).toBe("LEDGER_STALE_GUARD");
    const permit = first.ok
      ? first.value.executionPermit
      : second.ok
        ? second.value.executionPermit
        : undefined;
    expect(permit).toBeDefined();
    if (!permit) return;
    expect(permit.executionId).toBe(created.value.record.executionId);

    await instance.close();
    const reopened = await openLedger(root);
    const read = await reopened.get(created.value.record.printJobId);
    expect(read).toMatchObject({
      ok: true,
      value: { found: true, record: { state: "CROSSING_UNKNOWN" } },
    });
  });

  it("serializes beginCrossing and cancel so only one transition succeeds", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const created = await instance.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [crossing, cancelled] = await Promise.all([
      instance.beginCrossing(guard(created.value.record)),
      instance.cancel(guard(created.value.record)),
    ]);
    expect([crossing.ok, cancelled.ok].filter(Boolean)).toHaveLength(1);
    expect([crossing.ok, cancelled.ok].filter((value) => !value)).toHaveLength(1);
    const successfulState = crossing.ok
      ? crossing.value.record.state
      : cancelled.ok
        ? cancelled.value.state
        : undefined;
    expect(successfulState).toBeDefined();
    if (!successfulState) return;
    const rejected = crossing.ok ? cancelled : crossing;
    expect(errorCode(rejected)).toBe("LEDGER_STALE_GUARD");

    await instance.close();
    const reopened = await openLedger(root);
    const read = await reopened.get(created.value.record.printJobId);
    expect(read).toMatchObject({
      ok: true,
      value: { found: true, record: { state: successfulState } },
    });
  });

  it("computes both retainUntil branches at accept and never changes them on retry", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const createdBranch = await instance.accept({
      ...input("created-branch"),
      expiresAt: "2026-01-02T00:00:00.000Z",
    });
    expect(createdBranch.ok).toBe(true);
    if (!createdBranch.ok) return;
    expect(createdBranch.value.record.retainUntil).toBe("2026-04-01T00:00:00.000Z");

    const expiryBranch = await instance.accept({
      ...input("expiry-branch"),
      expiresAt: "2026-06-01T00:00:00.000Z",
    });
    expect(expiryBranch.ok).toBe(true);
    if (!expiryBranch.ok) return;
    expect(expiryBranch.value.record.retainUntil).toBe("2026-06-08T00:00:00.000Z");

    const failed = await instance.failNotCrossed({
      ...guard(expiryBranch.value.record),
      zeroBytesSent: true,
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    const retried = await instance.retryFailedNotCrossed(guard(failed.value));
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.value.createdAt).toBe(failed.value.createdAt);
    expect(retried.value.expiresAt).toBe(failed.value.expiresAt);
    expect(retried.value.retainUntil).toBe(failed.value.retainUntil);
  });
});

describe("ExecutionLedger durability and platform contracts", () => {
  async function acceptedRoot(): Promise<{ root: string; record: LedgerRecord }> {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const result = await instance.accept(input());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("accept setup failed");
    await instance.close();
    return { root, record: result.value.record };
  }

  it("keeps UNKNOWN durable when zero-byte completion cannot be persisted", async () => {
    const root = await makeRoot();
    const owner = await openLedger(root);
    const created = await owner.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const crossing = await owner.beginCrossing(guard(created.value.record));
    expect(crossing.ok).toBe(true);
    if (!crossing.ok) return;
    expect((await owner.close()).ok).toBe(true);

    const fileSystem = new FaultInjectingFileSystem(root);
    const resumed = await openLedger(root, { fileSystem });
    fileSystem.failure = "temp-sync";
    expect(errorCode(await resumed.confirmNotCrossed({
      executionPermit: crossing.value.executionPermit,
      zeroBytesSent: true,
    }))).toBe("LEDGER_DURABILITY_FAILURE");
    expect((await resumed.close()).ok).toBe(true);

    const reopened = await openLedger(root);
    expect(await reopened.get(created.value.record.printJobId)).toMatchObject({
      ok: true,
      value: { found: true, record: { state: "CROSSING_UNKNOWN" } },
    });
  });

  it("keeps the old disk fact when failure occurs before rename", async () => {
    const { root, record } = await acceptedRoot();
    const fs = new FaultInjectingFileSystem(root);
    fs.failure = "temp-sync";
    const instance = await openLedger(root, { fileSystem: fs });
    const result = await instance.beginCrossing(guard(record));
    expect(result).toMatchObject({ ok: false, error: { code: "LEDGER_DURABILITY_FAILURE" } });
    expect((await instance.close()).ok).toBe(true);

    const reopened = await openLedger(root);
    const read = await reopened.get(record.printJobId);
    expect(read).toMatchObject({
      ok: true,
      value: { found: true, record: { state: "NOT_CROSSED", attemptCount: 1 } },
    });
  });

  it("keeps the old disk fact when the real rename operation fails", async () => {
    const { root, record } = await acceptedRoot();
    const fs = new FaultInjectingFileSystem(root);
    fs.failure = "rename";
    const instance = await openLedger(root, { fileSystem: fs });
    const result = await instance.beginCrossing(guard(record));
    expect(result).toMatchObject({ ok: false, error: { code: "LEDGER_DURABILITY_FAILURE" } });
    expect(fs.events).toContain("rename");
    expect((await instance.close()).ok).toBe(true);

    const reopened = await openLedger(root);
    expect(await reopened.get(record.printJobId)).toMatchObject({
      ok: true,
      value: { found: true, record: { state: "NOT_CROSSED", attemptCount: 1 } },
    });
    expect((await readdir(root)).some((entry) => entry.endsWith(".tmp"))).toBe(true);
  });

  it("does not infer old disk state after rename and final fsync failure", async () => {
    const { root, record } = await acceptedRoot();
    const fs = new FaultInjectingFileSystem(root);
    fs.failure = "final-sync";
    const instance = await openLedger(root, { fileSystem: fs });
    const result = await instance.beginCrossing(guard(record));
    expect(result).toMatchObject({ ok: false, error: { code: "LEDGER_DURABILITY_FAILURE" } });
    expect((await instance.close()).ok).toBe(true);

    const reopened = await openLedger(root);
    const read = await reopened.get(record.printJobId);
    expect(read).toMatchObject({
      ok: true,
      value: { found: true, record: { state: "CROSSING_UNKNOWN", attemptCount: 1 } },
    });
  });

  it("keeps accept and retry records unchanged when persistence fails", async () => {
    const root = await makeRoot();
    const fs = new FaultInjectingFileSystem(root);
    fs.failure = "temp-sync";
    const instance = await openLedger(root, { fileSystem: fs });
    expect(errorCode(await instance.accept(input()))).toBe("LEDGER_DURABILITY_FAILURE");
    expect((await instance.close()).ok).toBe(true);

    const reopened = await openLedger(root);
    expect(await reopened.get("job-1")).toEqual({ ok: true, value: { found: false } });
    const created = await reopened.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const failed = await reopened.failNotCrossed({ ...guard(created.value.record), zeroBytesSent: true });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    await reopened.close();

    const retryFs = new FaultInjectingFileSystem(root);
    retryFs.failure = "temp-sync";
    const retrying = await openLedger(root, { fileSystem: retryFs });
    expect(errorCode(await retrying.retryFailedNotCrossed(guard(failed.value)))).toBe(
      "LEDGER_DURABILITY_FAILURE",
    );
    expect((await retrying.close()).ok).toBe(true);

    const final = await openLedger(root);
    const read = await final.get("job-1");
    expect(read).toMatchObject({
      ok: true,
      value: { found: true, record: { state: "FAILED_NOT_CROSSED", attemptCount: 1 } },
    });
  });

  it("fails closed when POSIX parent-directory fsync fails", async () => {
    const { root, record } = await acceptedRoot();
    const fs = new FaultInjectingFileSystem(root);
    fs.failure = "directory-sync";
    const instance = await openLedger(root, { fileSystem: fs, platform: "darwin" });
    const result = await instance.beginCrossing(guard(record));
    expect(result).toMatchObject({ ok: false, error: { code: "LEDGER_DURABILITY_FAILURE" } });
    expect(fs.events).toContain("sync:directory-sync");
    expect((await instance.close()).ok).toBe(true);
  });

  it("uses a writable final handle and skips directory fsync on Windows", async () => {
    const root = await makeRoot();
    const fs = new FaultInjectingFileSystem(root);
    const instance = await openLedger(root, { fileSystem: fs, platform: "win32" });
    const accepted = await instance.accept(input());
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    fs.events.length = 0;
    const result = await instance.beginCrossing(guard(accepted.value.record));
    expect(result.ok).toBe(true);
    expect(fs.events).toContain("open:r+:.execution-ledger.json");
    expect(fs.events.some((event) => event.includes("directory"))).toBe(false);
  });

  it("accepts Windows drive paths through the injected filesystem without host disk side effects", async () => {
    const root = await makeRoot();
    const fileSystem = new MappedFileSystem(root);
    for (const userDataPath of [
      "C:\\Users\\operator\\AppData\\Roaming\\Eshop",
      "D:/Eshop/userData",
    ]) {
      const instance = ledger(userDataPath, { platform: "win32", fileSystem });
      expect((await instance.open()).ok).toBe(true);
      expect((await instance.accept(input(userDataPath))).ok).toBe(true);
      expect((await instance.close()).ok).toBe(true);
    }
  });

  it.each([
    ["\\\\server\\share", "UNC path"],
    ["file:/Users/operator/userData", "file URL"],
    ["smb:/server/share", "SMB URL"],
    ["nfs:/server/share", "NFS URL"],
  ])("rejects %s as a Windows Ledger path (%s)", async (userDataPath) => {
    const root = await makeRoot();
    const instance = ledger(userDataPath, {
      platform: "win32",
      fileSystem: new MappedFileSystem(root),
    });
    expect(errorCode(await instance.open())).toBe("LEDGER_INVALID_INPUT");
  });
});

describe("ExecutionLedger concurrency and key safety", () => {
  it("serializes concurrent accepts for the same identity", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const identity = input();
    const [first, second] = await Promise.all([
      instance.accept(identity),
      instance.accept(identity),
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(2);
    expect([first, second].filter((result) => result.ok && result.value.kind === "CREATED")).toHaveLength(1);
    expect([first, second].filter((result) => result.ok && result.value.kind === "EXISTING")).toHaveLength(1);
    if (!first.ok || !second.ok) return;
    expect(first.value.record.executionId).toBe(second.value.record.executionId);
    expect(first.value.record.attemptCount).toBe(1);
    expect(second.value.record.attemptCount).toBe(1);

    const read = await instance.get(identity.printJobId);
    expect(read).toMatchObject({ ok: true, value: { found: true, record: { attemptCount: 1 } } });
  });

  it("serializes concurrent accepts with different identities without overwriting", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const firstIdentity = input("job-identity-race", { requestHash: "first" });
    const secondIdentity = input("job-identity-race", { requestHash: "second" });
    const [first, second] = await Promise.all([
      instance.accept(firstIdentity),
      instance.accept(secondIdentity),
    ]);
    expect([first, second].filter((result) => result.ok && result.value.kind === "CREATED")).toHaveLength(1);
    expect([first, second].filter((result) => !result.ok && result.error.code === "LEDGER_IDENTITY_CONFLICT")).toHaveLength(1);

    const read = await instance.get(firstIdentity.printJobId);
    expect(read).toMatchObject({ ok: true, value: { found: true, record: { requestHash: expect.any(String) } } });
    if (read.ok && read.value.found) {
      expect([firstIdentity.requestHash, secondIdentity.requestHash]).toContain(read.value.record.requestHash);
      expect(read.value.record.attemptCount).toBe(1);
    }
  });

  it("preserves independent records during cross-record concurrent mutations", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const a = await instance.accept(input("job-a"));
    const b = await instance.accept(input("job-b"));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const [crossing, cancelled] = await Promise.all([
      instance.beginCrossing(guard(a.value.record)),
      instance.cancel(guard(b.value.record)),
    ]);
    expect(crossing.ok).toBe(true);
    expect(cancelled.ok).toBe(true);

    await instance.close();
    const reopened = await openLedger(root);
    expect(await reopened.get("job-a")).toMatchObject({ ok: true, value: { found: true, record: { state: "CROSSING_UNKNOWN" } } });
    expect(await reopened.get("job-b")).toMatchObject({ ok: true, value: { found: true, record: { state: "CANCELLED" } } });
  });

  it("continues the queue after rejected mutations while preserving UNUSABLE", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const created = await instance.accept(input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(errorCode(await instance.cancel({ ...guard(created.value.record), expectedStateVersion: 99 }))).toBe(
      "LEDGER_STALE_GUARD",
    );
    expect((await instance.beginCrossing(guard(created.value.record))).ok).toBe(true);

    await instance.close();
    const failureRoot = await makeRoot();
    const fs = new FaultInjectingFileSystem(failureRoot);
    const stable = await openLedger(failureRoot);
    const stableCreated = await stable.accept(input());
    expect(stableCreated.ok).toBe(true);
    if (!stableCreated.ok) return;
    await stable.close();

    fs.failure = "temp-sync";
    const unusable = await openLedger(failureRoot, { fileSystem: fs });
    expect(errorCode(await unusable.beginCrossing(guard(stableCreated.value.record)))).toBe(
      "LEDGER_DURABILITY_FAILURE",
    );
    expect(errorCode(await unusable.get("job-1"))).toBe("LEDGER_UNUSABLE");
    expect(errorCode(await unusable.accept(input("job-2")))).toBe("LEDGER_UNUSABLE");
    expect((await unusable.close()).ok).toBe(true);
  });

  it("treats prototype-chain keys as missing and allows a real own __proto__ record", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    expect(await instance.get("__proto__")).toEqual({ ok: true, value: { found: false } });
    expect(await instance.get("constructor")).toEqual({ ok: true, value: { found: false } });
    expect(await instance.get("prototype")).toEqual({ ok: true, value: { found: false } });

    const created = await instance.accept(input("__proto__"));
    expect(created).toMatchObject({ ok: true, value: { kind: "CREATED" } });
    if (!created.ok) return;
    expect((await instance.get("__proto__"))).toMatchObject({
      ok: true,
      value: { found: true, record: { printJobId: "__proto__" } },
    });

    await instance.close();
    const reopened = await openLedger(root);
    expect(await reopened.get("__proto__")).toMatchObject({
      ok: true,
      value: { found: true, record: { printJobId: "__proto__" } },
    });
    expect(await reopened.get("constructor")).toEqual({ ok: true, value: { found: false } });
  });
});

describe("ExecutionLedger corruption and locks", () => {
  it("fails closed for corrupt files and allows UNUSABLE close without changing the file", async () => {
    const root = await makeRoot();
    const ledgerPath = path.join(root, ".execution-ledger.json");
    const corrupt = "{not-json";
    await writeFile(ledgerPath, corrupt, "utf8");
    const instance = ledger(root);
    expect(errorCode(await instance.open())).toBe("LEDGER_CORRUPT");
    expect(errorCode(await instance.get("job-1"))).toBe("LEDGER_UNUSABLE");
    expect(errorCode(await instance.accept(input()))).toBe("LEDGER_UNUSABLE");
    expect((await instance.close()).ok).toBe(true);
    expect(await readFile(ledgerPath, "utf8")).toBe(corrupt);
  });

  it("rejects unsupported schema and physical completion claims", async () => {
    const root = await makeRoot();
    const ledgerPath = path.join(root, ".execution-ledger.json");
    await writeFile(ledgerPath, JSON.stringify({ ledgerSchemaVersion: 99, records: {} }), "utf8");
    const unsupported = ledger(root);
    expect(errorCode(await unsupported.open())).toBe("LEDGER_SCHEMA_UNSUPPORTED");
    expect((await unsupported.close()).ok).toBe(true);

    await writeFile(
      ledgerPath,
      JSON.stringify({ ledgerSchemaVersion: 1, records: { "job-1": { physicalCompletionKnown: true } } }),
      "utf8",
    );
    const invalid = ledger(root);
    expect(errorCode(await invalid.open())).toBe("LEDGER_CORRUPT");
    expect((await invalid.close()).ok).toBe(true);
  });

  it("fails closed for contradictory state and diagnostic fields", async () => {
    const { root, record } = await (async () => {
      const createdRoot = await makeRoot();
      const instance = await openLedger(createdRoot);
      const created = await instance.accept(input());
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("accept setup failed");
      await instance.close();
      return { root: createdRoot, record: created.value.record };
    })();
    const ledgerPath = path.join(root, ".execution-ledger.json");
    const parsed = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      ledgerSchemaVersion: 1;
      records: Record<string, LedgerRecord>;
    };
    parsed.records[record.printJobId] = {
      ...parsed.records[record.printJobId],
      state: "NOT_CROSSED",
      zeroBytesSent: true,
    };
    await writeFile(ledgerPath, JSON.stringify(parsed), "utf8");

    const instance = ledger(root);
    expect(errorCode(await instance.open())).toBe("LEDGER_CORRUPT");
    expect(errorCode(await instance.get(record.printJobId))).toBe("LEDGER_UNUSABLE");
    expect((await instance.close()).ok).toBe(true);
  });

  it("returns BUSY for a valid second lock and never adopts an unknown lock", async () => {
    const root = await makeRoot();
    const first = await openLedger(root);
    const second = ledger(root);
    expect(errorCode(await second.open())).toBe("LEDGER_BUSY");
    expect((await first.close()).ok).toBe(true);

    const lockPath = path.join(root, ".execution-ledger.lock");
    await writeFile(lockPath, "unknown-lock", "utf8");
    const third = ledger(root);
    expect(errorCode(await third.open())).toBe("LEDGER_UNUSABLE");
    expect(await readFile(lockPath, "utf8")).toBe("unknown-lock");
  });

  it("recovers a dead-process lock only with explicit death and exclusive-recovery proof", async () => {
    const root = await makeRoot();
    const original = await openLedger(root, { processId: 101 });
    const accepted = await original.accept(input());
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const crossing = await original.beginCrossing(guard(accepted.value.record));
    expect(crossing.ok).toBe(true);
    expect((await original.close()).ok).toBe(true);
    const lockPath = path.join(root, ".execution-ledger.lock");
    await writeFile(lockPath, JSON.stringify({
      lockSchemaVersion: 1,
      ownerToken: "00000000-0000-4000-8000-000000000101",
      createdAt: fixedCreatedAt,
      processId: 101,
    }), "utf8");

    for (const proof of [false, "UNKNOWN"] as const) {
      const blocked = ledger(root, {
        processId: 202,
        staleLockRecovery: {
          hasExclusiveRecoveryAuthority: () => true,
          proveProcessDead: async () => proof,
        },
      });
      expect(errorCode(await blocked.open())).toBe("LEDGER_BUSY");
    }
    const noExclusiveProof = ledger(root, {
      processId: 202,
      staleLockRecovery: {
        hasExclusiveRecoveryAuthority: () => false,
        proveProcessDead: async () => true,
      },
    });
    expect(errorCode(await noExclusiveProof.open())).toBe("LEDGER_BUSY");

    const recovered = await openLedger(root, {
      processId: 202,
      staleLockRecovery: {
        hasExclusiveRecoveryAuthority: () => true,
        proveProcessDead: async (processId) => processId === 101,
      },
    });
    expect(await recovered.get("job-1")).toMatchObject({
      ok: true,
      value: { found: true, record: { state: "CROSSING_UNKNOWN" } },
    });
    expect((await recovered.close()).ok).toBe(true);
  });

  it("does not release a lock whose ownership can no longer be confirmed", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const accepted = await instance.accept(input());
    expect(accepted.ok).toBe(true);
    const lockPath = path.join(root, ".execution-ledger.lock");
    await writeFile(
      lockPath,
      JSON.stringify({
        lockSchemaVersion: 1,
        ownerToken: "00000000-0000-4000-8000-000000000000",
        createdAt: fixedCreatedAt,
      }),
      "utf8",
    );
    expect(errorCode(await instance.close())).toBe("LEDGER_UNUSABLE");
    expect(await readFile(lockPath, "utf8")).toContain("00000000-0000-4000-8000-000000000000");
    expect(errorCode(await instance.get("job-1"))).toBe("LEDGER_UNUSABLE");
  });

  it("ignores orphan temp files and never uses them as recovery input", async () => {
    const root = await makeRoot();
    const tempPath = path.join(root, ".execution-ledger.json.orphan.tmp");
    await writeFile(tempPath, JSON.stringify({ ledgerSchemaVersion: 1, records: {} }), "utf8");
    const instance = await openLedger(root);
    expect(await instance.get("missing")).toEqual({ ok: true, value: { found: false } });
    expect(await readdir(root)).toContain(".execution-ledger.json.orphan.tmp");
  });
});

describe("ExecutionLedger retention volume", () => {
  it("keeps 600 mixed records addressable without eviction", async () => {
    const root = await makeRoot();
    const instance = await openLedger(root);
    const records: LedgerRecord[] = [];
    for (let index = 0; index < 600; index += 1) {
      const result = await instance.accept(input(`job-${index}`, { requestHash: `hash-${index}` }));
      expect(result.ok).toBe(true);
      if (result.ok) records.push(result.value.record);
    }

    await instance.failNotCrossed({ ...guard(records[0]), zeroBytesSent: true });
    await instance.cancel(guard(records[1]));
    const unknown = await instance.beginCrossing(guard(records[2]));
    expect(unknown.ok).toBe(true);
    if (unknown.ok) {
      await instance.markCrossed({
        ...guard(unknown.value.record),
        allBytesWritten: true,
        flushAndFinConfirmed: true,
      });
    }

    for (let index = 0; index < records.length; index += 1) {
      const result = await instance.get(`job-${index}`);
      expect(result).toMatchObject({ ok: true, value: { found: true } });
    }
  }, 30_000);
});
