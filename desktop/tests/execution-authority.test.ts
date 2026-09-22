import { describe, expect, it } from "vitest";
import { ExecutionAuthorityGuard, type ExecutionAuthority } from "../src/main/printing/executionAuthority";

const base = Date.parse("2026-01-01T00:00:00.000Z");
const authority: ExecutionAuthority = {
  storeId: "store-a",
  deviceId: "device-a",
  ownerEpoch: 7,
  leaseId: "lease-a",
  batchExpiresAt: "2026-01-01T01:00:00.000Z",
};

describe("ExecutionAuthorityGuard", () => {
  it("admits only the exact current owner authority", () => {
    const guard = new ExecutionAuthorityGuard(authority, 15 * 60_000, () => base);
    expect(guard.canAdmit(authority)).toEqual({ allowed: true, mode: "CONNECTED" });
    for (const changed of [
      { deviceId: "device-b" }, { leaseId: "lease-b" }, { ownerEpoch: 6 }, { storeId: "store-b" },
    ]) expect(guard.canAdmit({ ...authority, ...changed })).toMatchObject({ allowed: false, mode: "FENCED" });
  });

  it("never promotes epoch on timeout and closes admission after Grace", () => {
    let now = base;
    const guard = new ExecutionAuthorityGuard(authority, 10 * 60_000, () => now);
    guard.noteDisconnected();
    now += 10 * 60_000;
    expect(guard.canAdmit(authority)).toEqual({ allowed: true, mode: "PARTITION_GRACE" });
    now += 1;
    expect(guard.canAdmit(authority)).toEqual({
      allowed: false, mode: "ADMISSION_CLOSED", reason: "PARTITION_GRACE_EXPIRED",
    });
    expect(guard.canAdmit({ ...authority, ownerEpoch: 8 })).toMatchObject({ allowed: false, mode: "FENCED" });
  });

  it("fences the old owner after a higher epoch is observed", () => {
    const guard = new ExecutionAuthorityGuard(authority, 15 * 60_000, () => base);
    guard.noteConnected(8);
    expect(guard.canAdmit(authority)).toEqual({ allowed: false, mode: "FENCED", reason: "AUTHORITY_MISMATCH" });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5])("fails closed after invalid observed epoch %s", (observed) => {
    const guard = new ExecutionAuthorityGuard(authority, 15 * 60_000, () => base);
    guard.noteConnected(observed);
    expect(guard.canAdmit(authority)).toEqual({
      allowed: false, mode: "ADMISSION_CLOSED", reason: "INVALID_OBSERVED_EPOCH",
    });
  });

  it("fails closed for expired batches and grace below the frozen minimum", () => {
    expect(() => new ExecutionAuthorityGuard(authority, 9 * 60_000, () => base)).toThrow(/ten minutes/);
    const guard = new ExecutionAuthorityGuard({ ...authority, batchExpiresAt: new Date(base).toISOString() }, 10 * 60_000, () => base);
    expect(guard.canAdmit({ ...authority, batchExpiresAt: new Date(base).toISOString() }))
      .toMatchObject({ allowed: false, reason: "BATCH_EXPIRED" });
    expect(guard.canAdmit({ ...authority, batchExpiresAt: "not-a-date" }))
      .toMatchObject({ allowed: false, reason: "BATCH_EXPIRED" });
  });
});
