import { randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

export type LedgerState =
  | "NOT_CROSSED"
  | "CROSSING_UNKNOWN"
  | "CROSSED"
  | "FAILED_NOT_CROSSED"
  | "CANCELLED";

export type LedgerErrorCode =
  | "LEDGER_IDENTITY_CONFLICT"
  | "LEDGER_ILLEGAL_TRANSITION"
  | "LEDGER_STALE_GUARD"
  | "LEDGER_EXPIRED"
  | "LEDGER_BUSY"
  | "LEDGER_NOT_OPEN"
  | "LEDGER_UNUSABLE"
  | "LEDGER_CORRUPT"
  | "LEDGER_SCHEMA_UNSUPPORTED"
  | "LEDGER_DURABILITY_FAILURE"
  | "LEDGER_INVALID_INPUT";

export type LedgerError = {
  code: LedgerErrorCode;
  message: string;
};

export type LedgerResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: LedgerError };

export type LedgerIdentity = {
  printJobId: string;
  requestHash: string;
  rendererVersion: string;
  expiresAt: string;
};

export type AcceptInput = LedgerIdentity;

export type LedgerGuard = {
  printJobId: string;
  expectedExecutionId: string;
  expectedStateVersion: number;
};

export type LedgerRecord = LedgerIdentity & {
  executionId: string;
  state: LedgerState;
  stateVersion: number;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  retainUntil: string;
  physicalCompletionKnown: false;
  zeroBytesSent?: true;
  lastErrorCode?: string;
};

export type LedgerFile = {
  ledgerSchemaVersion: 1;
  records: Record<string, LedgerRecord>;
};

export type ExecutionPermit = {
  printJobId: string;
  executionId: string;
  stateVersion: number;
};

export type ZeroByteCrossingProof = {
  executionPermit: ExecutionPermit;
  zeroBytesSent: true;
  lastErrorCode?: string;
};

export type LedgerFileHandle = Pick<FileHandle, "writeFile" | "sync" | "close">;

export type LedgerFileSystem = {
  open(filePath: string, flags: string): Promise<LedgerFileHandle>;
  readFile(filePath: string): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
};

export type ExecutionLedgerOptions = {
  userDataPath: string;
  now?: () => Date;
  platform?: NodeJS.Platform;
  fileSystem?: LedgerFileSystem;
  processId?: number;
  staleLockRecovery?: {
    hasExclusiveRecoveryAuthority(): boolean;
    proveProcessDead(processId: number): Promise<true | false | "UNKNOWN">;
  };
};

const LEDGER_SCHEMA_VERSION = 1 as const;
const LEDGER_FILE_NAME = ".execution-ledger.json";
const LOCK_FILE_NAME = ".execution-ledger.lock";
const UTC_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES: readonly LedgerState[] = [
  "NOT_CROSSED",
  "CROSSING_UNKNOWN",
  "CROSSED",
  "FAILED_NOT_CROSSED",
  "CANCELLED",
];

type LockFile = {
  lockSchemaVersion: 1;
  ownerToken: string;
  createdAt: string;
  processId?: number;
};

const defaultFileSystem: LedgerFileSystem = {
  open: (filePath, flags) => nodeFs.open(filePath, flags),
  readFile: (filePath) => nodeFs.readFile(filePath, "utf8"),
  rename: (oldPath, newPath) => nodeFs.rename(oldPath, newPath),
  unlink: (filePath) => nodeFs.unlink(filePath),
};

export function createNodeLedgerFileSystem(): LedgerFileSystem {
  return defaultFileSystem;
}

function success<T>(value: T): LedgerResult<T> {
  return { ok: true, value };
}

function failure<T>(code: LedgerErrorCode, message: string): LedgerResult<T> {
  return { ok: false, error: { code, message } };
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function isUtcIso(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UTC_ISO_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function expectedRetainUntil(expiresAt: string, createdAt: string): string {
  const expiresRetention = Date.parse(expiresAt) + 7 * 24 * 60 * 60 * 1000;
  const createdRetention = Date.parse(createdAt) + 90 * 24 * 60 * 60 * 1000;
  return new Date(Math.max(expiresRetention, createdRetention)).toISOString();
}

function isExpired(expiresAt: string, now: Date): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}

function identityEquals(left: LedgerIdentity, right: LedgerIdentity): boolean {
  return (
    left.printJobId === right.printJobId &&
    left.requestHash === right.requestHash &&
    left.rendererVersion === right.rendererVersion &&
    left.expiresAt === right.expiresAt
  );
}

function emptyLedger(): LedgerFile {
  return {
    ledgerSchemaVersion: LEDGER_SCHEMA_VERSION,
    records: Object.create(null) as Record<string, LedgerRecord>,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertNoUnknownKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function validateIdentity(value: unknown): value is LedgerIdentity {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.printJobId === "string" &&
    value.printJobId.length > 0 &&
    typeof value.requestHash === "string" &&
    value.requestHash.length > 0 &&
    typeof value.rendererVersion === "string" &&
    value.rendererVersion.length > 0 &&
    isUtcIso(value.expiresAt)
  );
}

function validateRecord(value: unknown): value is LedgerRecord {
  if (!isPlainObject(value)) return false;
  if (
    !assertNoUnknownKeys(value, [
      "printJobId",
      "requestHash",
      "rendererVersion",
      "expiresAt",
      "executionId",
      "state",
      "stateVersion",
      "attemptCount",
      "createdAt",
      "updatedAt",
      "retainUntil",
      "physicalCompletionKnown",
      "zeroBytesSent",
      "lastErrorCode",
    ])
  ) {
    return false;
  }

  if (!validateIdentity(value)) return false;
  const record = value as unknown as LedgerRecord;

  if (
    typeof record.executionId !== "string" ||
    !UUID_PATTERN.test(record.executionId) ||
    !STATES.includes(record.state) ||
    !Number.isInteger(record.stateVersion) ||
    record.stateVersion < 0 ||
    !Number.isInteger(record.attemptCount) ||
    record.attemptCount < 1 ||
    !isUtcIso(record.createdAt) ||
    !isUtcIso(record.updatedAt) ||
    !isUtcIso(record.retainUntil) ||
    record.physicalCompletionKnown !== false ||
    (record.zeroBytesSent !== undefined && record.zeroBytesSent !== true) ||
    (record.lastErrorCode !== undefined &&
      (typeof record.lastErrorCode !== "string" || record.lastErrorCode.length === 0))
  ) {
    return false;
  }

  if (record.retainUntil !== expectedRetainUntil(record.expiresAt, record.createdAt)) {
    return false;
  }

  if (record.state === "FAILED_NOT_CROSSED") {
    if (record.zeroBytesSent !== true) return false;
  } else if (record.zeroBytesSent !== undefined || record.lastErrorCode !== undefined) {
    return false;
  }

  return true;
}

function validateLedgerFile(value: unknown): value is LedgerFile {
  if (!isPlainObject(value)) return false;
  if (
    !assertNoUnknownKeys(value, ["ledgerSchemaVersion", "records"]) ||
    value.ledgerSchemaVersion !== LEDGER_SCHEMA_VERSION ||
    !isPlainObject(value.records)
  ) {
    return false;
  }

  return Object.entries(value.records).every(
    ([printJobId, record]) => validateRecord(record) && record.printJobId === printJobId,
  );
}

function hasOwnRecord(records: Record<string, LedgerRecord>, printJobId: string): boolean {
  return Object.prototype.hasOwnProperty.call(records, printJobId);
}

function validateLockFile(value: unknown): value is LockFile {
  return (
    isPlainObject(value) &&
    assertNoUnknownKeys(value, ["lockSchemaVersion", "ownerToken", "createdAt", "processId"]) &&
    value.lockSchemaVersion === 1 &&
    typeof value.ownerToken === "string" &&
    UUID_PATTERN.test(value.ownerToken) &&
    isUtcIso(value.createdAt) &&
    (value.processId === undefined ||
      (typeof value.processId === "number" && Number.isInteger(value.processId) && value.processId > 0))
  );
}

function isForbiddenStoragePath(userDataPath: string, platform: NodeJS.Platform): boolean {
  const isWindowsDrivePath = /^[a-z]:[\\/]/i.test(userDataPath);
  const hasUriScheme = /^[a-z][a-z0-9+.-]*:/i.test(userDataPath) && !isWindowsDrivePath;
  const isAbsolute = path.isAbsolute(userDataPath) ||
    (platform === "win32" && path.win32.isAbsolute(userDataPath));

  return (
    !isAbsolute ||
    userDataPath.startsWith("//") ||
    userDataPath.startsWith("\\\\") ||
    hasUriScheme ||
    /(?:^|[\\/])(onedrive|dropbox|google drive|icloud drive|smb|nfs)(?:[\\/]|$)/i.test(
      userDataPath,
    )
  );
}

function copyRecord(record: LedgerRecord): LedgerRecord {
  return { ...record };
}

function copyFile(file: LedgerFile): LedgerFile {
  const records = Object.create(null) as Record<string, LedgerRecord>;
  for (const [key, record] of Object.entries(file.records)) {
    records[key] = copyRecord(record);
  }
  return {
    ledgerSchemaVersion: LEDGER_SCHEMA_VERSION,
    records,
  };
}

export class ExecutionLedger {
  private readonly userDataPath: string;
  private readonly ledgerPath: string;
  private readonly lockPath: string;
  private readonly now: () => Date;
  private readonly platform: NodeJS.Platform;
  private readonly fileSystem: LedgerFileSystem;
  private readonly processId: number;
  private readonly staleLockRecovery?: ExecutionLedgerOptions["staleLockRecovery"];
  private file: LedgerFile = emptyLedger();
  private ownerToken: string | null = null;
  private opened = false;
  private unusable = false;
  private queue: Promise<void> = Promise.resolve();

  public constructor(options: ExecutionLedgerOptions) {
    this.userDataPath = options.userDataPath;
    this.ledgerPath = path.join(options.userDataPath, LEDGER_FILE_NAME);
    this.lockPath = path.join(options.userDataPath, LOCK_FILE_NAME);
    this.now = options.now ?? (() => new Date());
    this.platform = options.platform ?? process.platform;
    this.fileSystem = options.fileSystem ?? defaultFileSystem;
    this.processId = options.processId ?? process.pid;
    this.staleLockRecovery = options.staleLockRecovery;
  }

  public open(): Promise<LedgerResult<void>> {
    return this.runExclusive(() => this.openInternal());
  }

  private async openInternal(recoveryAttempted = false): Promise<LedgerResult<void>> {
    if (this.opened) {
      return this.unusable
        ? failure("LEDGER_UNUSABLE", "Ledger instance is unusable.")
        : failure("LEDGER_BUSY", "Ledger instance is already open.");
    }

    if (isForbiddenStoragePath(this.userDataPath, this.platform)) {
      return failure(
        "LEDGER_INVALID_INPUT",
        "Ledger and lock paths must be on the local Electron userData filesystem.",
      );
    }

    const ownerToken = randomUUID();
    let lockHandle: LedgerFileHandle | undefined;
    try {
      lockHandle = await this.fileSystem.open(this.lockPath, "wx");
      const lock: LockFile = {
        lockSchemaVersion: 1,
        ownerToken,
        createdAt: this.now().toISOString(),
        processId: this.processId,
      };
      await lockHandle.writeFile(`${JSON.stringify(lock)}\n`);
      await lockHandle.sync();
      await lockHandle.close();
      lockHandle = undefined;
    } catch (error) {
      if (lockHandle) await this.closeQuietly(lockHandle);
      if (isErrorCode(error, "EEXIST")) {
        return this.inspectExistingLock(recoveryAttempted);
      }
      return failure("LEDGER_UNUSABLE", "Unable to establish a verifiable Ledger lock.");
    }

    this.ownerToken = ownerToken;
    this.opened = true;
    this.unusable = false;
    this.file = emptyLedger();

    try {
      const raw = await this.fileSystem.readFile(this.ledgerPath);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.unusable = true;
        return failure("LEDGER_CORRUPT", "Ledger JSON is corrupt.");
      }

      if (!isPlainObject(parsed) || parsed.ledgerSchemaVersion !== LEDGER_SCHEMA_VERSION) {
        this.unusable = true;
        return failure("LEDGER_SCHEMA_UNSUPPORTED", "Ledger schema is unsupported.");
      }
      if (!validateLedgerFile(parsed)) {
        this.unusable = true;
        return failure("LEDGER_CORRUPT", "Ledger fields are invalid.");
      }
      this.file = copyFile(parsed);
      return success(undefined);
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) return success(undefined);
      this.unusable = true;
      return failure("LEDGER_UNUSABLE", "Ledger could not be read and verified.");
    }
  }

  public close(): Promise<LedgerResult<void>> {
    return this.runExclusive(() => this.closeInternal());
  }

  private async closeInternal(): Promise<LedgerResult<void>> {
    if (!this.opened) {
      return failure("LEDGER_NOT_OPEN", "Ledger is not open.");
    }

    if (!this.ownerToken) {
      this.unusable = true;
      return failure("LEDGER_UNUSABLE", "Current lock ownership cannot be confirmed.");
    }

    let raw: string;
    try {
      raw = await this.fileSystem.readFile(this.lockPath);
    } catch {
      this.unusable = true;
      return failure("LEDGER_UNUSABLE", "Current lock ownership cannot be confirmed.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.unusable = true;
      return failure("LEDGER_UNUSABLE", "Current lock ownership cannot be confirmed.");
    }

    if (!validateLockFile(parsed) || parsed.ownerToken !== this.ownerToken) {
      this.unusable = true;
      return failure("LEDGER_UNUSABLE", "Current lock ownership cannot be confirmed.");
    }

    try {
      await this.fileSystem.unlink(this.lockPath);
    } catch {
      this.unusable = true;
      return failure("LEDGER_UNUSABLE", "Current lock could not be released safely.");
    }

    this.opened = false;
    this.ownerToken = null;
    return success(undefined);
  }

  public accept(
    input: AcceptInput,
  ): Promise<LedgerResult<{ kind: "CREATED" | "EXISTING"; record: LedgerRecord }>> {
    return this.runExclusive(() => this.acceptInternal(input));
  }

  private async acceptInternal(
    input: AcceptInput,
  ): Promise<LedgerResult<{ kind: "CREATED" | "EXISTING"; record: LedgerRecord }>> {
    const ready = this.ensureReady();
    if (!ready.ok) return ready;
    if (!validateIdentity(input)) {
      return failure("LEDGER_INVALID_INPUT", "Accept identity is invalid.");
    }

    const existing = hasOwnRecord(this.file.records, input.printJobId)
      ? this.file.records[input.printJobId]
      : undefined;
    if (existing) {
      if (!identityEquals(existing, input)) {
        return failure("LEDGER_IDENTITY_CONFLICT", "Existing identity does not match accept input.");
      }
      return success({ kind: "EXISTING", record: copyRecord(existing) });
    }

    const createdAt = this.now().toISOString();
    const record: LedgerRecord = {
      ...input,
      executionId: randomUUID(),
      state: "NOT_CROSSED",
      stateVersion: 0,
      attemptCount: 1,
      createdAt,
      updatedAt: createdAt,
      retainUntil: expectedRetainUntil(input.expiresAt, createdAt),
      physicalCompletionKnown: false,
    };
    const next = copyFile(this.file);
    next.records[record.printJobId] = record;
    const persisted = await this.persist(next);
    if (!persisted.ok) return persisted;
    return success({ kind: "CREATED", record: copyRecord(record) });
  }

  public get(
    printJobId: string,
  ): Promise<LedgerResult<{ found: true; record: LedgerRecord } | { found: false }>> {
    return this.runExclusive(() => this.getInternal(printJobId));
  }

  private async getInternal(
    printJobId: string,
  ): Promise<LedgerResult<{ found: true; record: LedgerRecord } | { found: false }>> {
    const ready = this.ensureReady();
    if (!ready.ok) return ready;
    if (typeof printJobId !== "string" || printJobId.length === 0) {
      return failure("LEDGER_INVALID_INPUT", "printJobId is required.");
    }
    const record = hasOwnRecord(this.file.records, printJobId)
      ? this.file.records[printJobId]
      : undefined;
    return record
      ? success({ found: true, record: copyRecord(record) })
      : success({ found: false });
  }

  public beginCrossing(
    guard: LedgerGuard,
  ): Promise<LedgerResult<{ record: LedgerRecord; executionPermit: ExecutionPermit }>> {
    return this.runExclusive(() => this.beginCrossingInternal(guard));
  }

  private async beginCrossingInternal(
    guard: LedgerGuard,
  ): Promise<LedgerResult<{ record: LedgerRecord; executionPermit: ExecutionPermit }>> {
    const ready = this.ensureReady();
    if (!ready.ok) return ready;
    const guarded = this.guardRecord(guard);
    if (!guarded.ok) return guarded;
    const record = guarded.value;
    if (record.state !== "NOT_CROSSED") {
      return failure("LEDGER_ILLEGAL_TRANSITION", "beginCrossing is not legal from this state.");
    }
    if (isExpired(record.expiresAt, this.now())) {
      return failure("LEDGER_EXPIRED", "Expired print jobs cannot begin crossing.");
    }

    const nextRecord: LedgerRecord = {
      ...record,
      state: "CROSSING_UNKNOWN",
      stateVersion: record.stateVersion + 1,
      updatedAt: this.now().toISOString(),
    };
    const next = copyFile(this.file);
    next.records[record.printJobId] = nextRecord;
    const persisted = await this.persist(next);
    if (!persisted.ok) return persisted;
    return success({
      record: copyRecord(nextRecord),
      executionPermit: {
        printJobId: nextRecord.printJobId,
        executionId: nextRecord.executionId,
        stateVersion: nextRecord.stateVersion,
      },
    });
  }

  public failNotCrossed(
    guard: LedgerGuard & { zeroBytesSent: true; lastErrorCode?: string },
  ): Promise<LedgerResult<LedgerRecord>> {
    return this.runExclusive(() => this.failNotCrossedInternal(guard));
  }

  private async failNotCrossedInternal(
    guard: LedgerGuard & { zeroBytesSent: true; lastErrorCode?: string },
  ): Promise<LedgerResult<LedgerRecord>> {
    const ready = this.ensureReady();
    if (!ready.ok) return ready;
    if (guard.zeroBytesSent !== true) {
      return failure("LEDGER_INVALID_INPUT", "Zero-byte proof is required.");
    }
    if (
      guard.lastErrorCode !== undefined &&
      (typeof guard.lastErrorCode !== "string" || guard.lastErrorCode.length === 0)
    ) {
      return failure("LEDGER_INVALID_INPUT", "lastErrorCode must be a non-empty string.");
    }
    const guarded = this.guardRecord(guard);
    if (!guarded.ok) return guarded;
    const record = guarded.value;
    if (record.state !== "NOT_CROSSED") {
      return failure("LEDGER_ILLEGAL_TRANSITION", "failNotCrossed is not legal from this state.");
    }

    const nextRecord: LedgerRecord = {
      ...record,
      state: "FAILED_NOT_CROSSED",
      stateVersion: record.stateVersion + 1,
      updatedAt: this.now().toISOString(),
      zeroBytesSent: true,
      ...(guard.lastErrorCode === undefined ? {} : { lastErrorCode: guard.lastErrorCode }),
    };
    const next = copyFile(this.file);
    next.records[record.printJobId] = nextRecord;
    const persisted = await this.persist(next);
    if (!persisted.ok) return persisted;
    return success(copyRecord(nextRecord));
  }

  public confirmNotCrossed(
    proof: ZeroByteCrossingProof,
  ): Promise<LedgerResult<LedgerRecord>> {
    return this.runExclusive(() => this.confirmNotCrossedInternal(proof));
  }

  private async confirmNotCrossedInternal(
    proof: ZeroByteCrossingProof,
  ): Promise<LedgerResult<LedgerRecord>> {
    const ready = this.ensureReady();
    if (!ready.ok) return ready;
    if (!proof || proof.zeroBytesSent !== true || !proof.executionPermit) {
      return failure("LEDGER_INVALID_INPUT", "Current execution permit and zero-byte proof are required.");
    }
    if (
      proof.lastErrorCode !== undefined &&
      (typeof proof.lastErrorCode !== "string" || proof.lastErrorCode.length === 0)
    ) {
      return failure("LEDGER_INVALID_INPUT", "lastErrorCode must be a non-empty string.");
    }

    const guarded = this.guardRecord({
      printJobId: proof.executionPermit.printJobId,
      expectedExecutionId: proof.executionPermit.executionId,
      expectedStateVersion: proof.executionPermit.stateVersion,
    });
    if (!guarded.ok) return guarded;
    const record = guarded.value;
    if (record.state !== "CROSSING_UNKNOWN") {
      return failure(
        "LEDGER_ILLEGAL_TRANSITION",
        "confirmNotCrossed is only legal for the current crossing attempt.",
      );
    }

    const nextRecord: LedgerRecord = {
      ...record,
      state: "FAILED_NOT_CROSSED",
      stateVersion: record.stateVersion + 1,
      updatedAt: this.now().toISOString(),
      zeroBytesSent: true,
      ...(proof.lastErrorCode === undefined ? {} : { lastErrorCode: proof.lastErrorCode }),
    };
    const next = copyFile(this.file);
    next.records[record.printJobId] = nextRecord;
    const persisted = await this.persist(next);
    if (!persisted.ok) return persisted;
    return success(copyRecord(nextRecord));
  }

  public retryFailedNotCrossed(
    guard: LedgerGuard,
  ): Promise<LedgerResult<LedgerRecord>> {
    return this.runExclusive(() => this.retryFailedNotCrossedInternal(guard));
  }

  private async retryFailedNotCrossedInternal(
    guard: LedgerGuard,
  ): Promise<LedgerResult<LedgerRecord>> {
    const ready = this.ensureReady();
    if (!ready.ok) return ready;
    const guarded = this.guardRecord(guard);
    if (!guarded.ok) return guarded;
    const record = guarded.value;
    if (record.state !== "FAILED_NOT_CROSSED") {
      return failure(
        "LEDGER_ILLEGAL_TRANSITION",
        "retryFailedNotCrossed is not legal from this state.",
      );
    }
    if (isExpired(record.expiresAt, this.now())) {
      return failure("LEDGER_EXPIRED", "Expired print jobs cannot retry.");
    }

    const nextRecord: LedgerRecord = {
      printJobId: record.printJobId,
      requestHash: record.requestHash,
      rendererVersion: record.rendererVersion,
      expiresAt: record.expiresAt,
      executionId: randomUUID(),
      state: "NOT_CROSSED",
      stateVersion: record.stateVersion + 1,
      attemptCount: record.attemptCount + 1,
      createdAt: record.createdAt,
      updatedAt: this.now().toISOString(),
      retainUntil: record.retainUntil,
      physicalCompletionKnown: false,
    };
    const next = copyFile(this.file);
    next.records[record.printJobId] = nextRecord;
    const persisted = await this.persist(next);
    if (!persisted.ok) return persisted;
    return success(copyRecord(nextRecord));
  }

  public markCrossed(
    guard: LedgerGuard & { allBytesWritten: true; flushAndFinConfirmed: true },
  ): Promise<LedgerResult<LedgerRecord>> {
    return this.runExclusive(() => this.markCrossedInternal(guard));
  }

  private async markCrossedInternal(
    guard: LedgerGuard & { allBytesWritten: true; flushAndFinConfirmed: true },
  ): Promise<LedgerResult<LedgerRecord>> {
    const ready = this.ensureReady();
    if (!ready.ok) return ready;
    if (guard.allBytesWritten !== true || guard.flushAndFinConfirmed !== true) {
      return failure("LEDGER_INVALID_INPUT", "Crossing proof is incomplete.");
    }
    const guarded = this.guardRecord(guard);
    if (!guarded.ok) return guarded;
    const record = guarded.value;
    if (record.state !== "CROSSING_UNKNOWN") {
      return failure("LEDGER_ILLEGAL_TRANSITION", "markCrossed is only legal from UNKNOWN.");
    }

    const nextRecord: LedgerRecord = {
      ...record,
      state: "CROSSED",
      stateVersion: record.stateVersion + 1,
      updatedAt: this.now().toISOString(),
      physicalCompletionKnown: false,
    };
    const next = copyFile(this.file);
    next.records[record.printJobId] = nextRecord;
    const persisted = await this.persist(next);
    if (!persisted.ok) return persisted;
    return success(copyRecord(nextRecord));
  }

  public cancel(guard: LedgerGuard): Promise<LedgerResult<LedgerRecord>> {
    return this.runExclusive(() => this.cancelInternal(guard));
  }

  private async cancelInternal(guard: LedgerGuard): Promise<LedgerResult<LedgerRecord>> {
    const ready = this.ensureReady();
    if (!ready.ok) return ready;
    const guarded = this.guardRecord(guard);
    if (!guarded.ok) return guarded;
    const record = guarded.value;
    if (record.state !== "NOT_CROSSED") {
      return failure("LEDGER_ILLEGAL_TRANSITION", "cancel is only legal from NOT_CROSSED.");
    }

    const nextRecord: LedgerRecord = {
      ...record,
      state: "CANCELLED",
      stateVersion: record.stateVersion + 1,
      updatedAt: this.now().toISOString(),
    };
    const next = copyFile(this.file);
    next.records[record.printJobId] = nextRecord;
    const persisted = await this.persist(next);
    if (!persisted.ok) return persisted;
    return success(copyRecord(nextRecord));
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private ensureReady(): LedgerResult<void> {
    if (!this.opened) return failure("LEDGER_NOT_OPEN", "Ledger is not open.");
    if (this.unusable) return failure("LEDGER_UNUSABLE", "Ledger instance is unusable.");
    return success(undefined);
  }

  private guardRecord(guard: LedgerGuard): LedgerResult<LedgerRecord> {
    if (
      !isPlainObject(guard) ||
      typeof guard.printJobId !== "string" ||
      guard.printJobId.length === 0 ||
      typeof guard.expectedExecutionId !== "string" ||
      !UUID_PATTERN.test(guard.expectedExecutionId) ||
      !Number.isInteger(guard.expectedStateVersion) ||
      guard.expectedStateVersion < 0
    ) {
      return failure("LEDGER_INVALID_INPUT", "Ledger guard is invalid.");
    }
    const record = hasOwnRecord(this.file.records, guard.printJobId)
      ? this.file.records[guard.printJobId]
      : undefined;
    if (!record) return failure("LEDGER_INVALID_INPUT", "Ledger record does not exist.");
    if (
      record.executionId !== guard.expectedExecutionId ||
      record.stateVersion !== guard.expectedStateVersion
    ) {
      return failure("LEDGER_STALE_GUARD", "Ledger guard is stale.");
    }
    return success(record);
  }

  private async persist(next: LedgerFile): Promise<LedgerResult<void>> {
    const tempPath = `${this.ledgerPath}.${randomUUID()}.tmp`;
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    let tempHandle: LedgerFileHandle | undefined;
    let finalHandle: LedgerFileHandle | undefined;
    let directoryHandle: LedgerFileHandle | undefined;

    try {
      tempHandle = await this.fileSystem.open(tempPath, "wx");
      await tempHandle.writeFile(serialized);
      await tempHandle.sync();
      await tempHandle.close();
      tempHandle = undefined;

      await this.fileSystem.rename(tempPath, this.ledgerPath);

      finalHandle = await this.fileSystem.open(this.ledgerPath, "r+");
      await finalHandle.sync();
      await finalHandle.close();
      finalHandle = undefined;

      if (this.platform !== "win32") {
        directoryHandle = await this.fileSystem.open(this.userDataPath, "r");
        await directoryHandle.sync();
        await directoryHandle.close();
        directoryHandle = undefined;
      }

      this.file = copyFile(next);
      return success(undefined);
    } catch {
      await this.closeQuietly(tempHandle);
      await this.closeQuietly(finalHandle);
      await this.closeQuietly(directoryHandle);
      this.unusable = true;
      return failure(
        "LEDGER_DURABILITY_FAILURE",
        "A required Ledger durability step failed; disk state is authoritative after reopen.",
      );
    }
  }

  private async inspectExistingLock(recoveryAttempted: boolean): Promise<LedgerResult<void>> {
    try {
      const raw = await this.fileSystem.readFile(this.lockPath);
      const parsed = JSON.parse(raw) as unknown;
      if (validateLockFile(parsed)) {
        if (
          !recoveryAttempted &&
          parsed.processId !== undefined &&
          this.staleLockRecovery?.hasExclusiveRecoveryAuthority() === true
        ) {
          const proof = await this.staleLockRecovery.proveProcessDead(parsed.processId);
          if (proof === true) {
            const currentRaw = await this.fileSystem.readFile(this.lockPath);
            if (currentRaw !== raw) {
              return failure("LEDGER_BUSY", "Lock ownership changed during recovery.");
            }
            await this.fileSystem.unlink(this.lockPath);
            return this.openInternal(true);
          }
        }
        return failure("LEDGER_BUSY", "Another Ledger instance owns the lock.");
      }
      return failure("LEDGER_UNUSABLE", "Existing lock ownership cannot be verified.");
    } catch {
      return failure("LEDGER_UNUSABLE", "Existing lock ownership cannot be verified.");
    }
  }

  private async closeQuietly(handle: LedgerFileHandle | undefined): Promise<void> {
    if (!handle) return;
    try {
      await handle.close();
    } catch {
      // The original durability or ownership error is the authoritative result.
    }
  }
}

export function createExecutionLedger(options: ExecutionLedgerOptions): ExecutionLedger {
  return new ExecutionLedger(options);
}
