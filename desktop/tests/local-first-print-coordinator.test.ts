import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionAuthorityGuard, type ExecutionAuthority } from "../src/main/printing/executionAuthority";
import { createExecutionLedger } from "../src/main/printing/executionLedger";
import { LocalFirstPrintCoordinator, type PrintIntentSource } from "../src/main/printing/localFirstPrintCoordinator";
import { SharedPrintingCore, type EffectBoundaryResult, type PrintingEffectBoundary } from "../src/main/printing/sharedPrintingCore";

const roots: string[] = [];
const now = Date.parse("2026-01-01T00:00:00.000Z");
const authority: ExecutionAuthority = {
  storeId: "store-a", deviceId: "device-a", ownerEpoch: 4, leaseId: "lease-a",
  batchExpiresAt: "2026-01-01T01:00:00.000Z",
};
const identity = {
  printJobId: "job-shared", requestHash: "hash-shared", rendererVersion: "renderer-v1",
  expiresAt: "2026-01-01T01:00:00.000Z",
};

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function composition(boundary: PrintingEffectBoundary<Uint8Array>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-first-print-"));
  roots.push(root);
  const ledger = createExecutionLedger({ userDataPath: root, platform: "win32", now: () => new Date(now) });
  expect((await ledger.open()).ok).toBe(true);
  const guard = new ExecutionAuthorityGuard(authority, 10 * 60_000, () => now);
  return { root, ledger, coordinator: new LocalFirstPrintCoordinator(guard, new SharedPrintingCore(ledger, boundary)) };
}

describe("LocalFirstPrintCoordinator", () => {
  it("uses one Ledger truth for simultaneous Local and every Cloud-compatible source", async () => {
    const boundary: PrintingEffectBoundary<Uint8Array> = {
      cross: vi.fn(async (): Promise<EffectBoundaryResult> => ({ outcome: "CROSSED", allBytesWritten: true, flushAndFinConfirmed: true })),
    };
    const { coordinator } = await composition(boundary);
    const sources: PrintIntentSource[] = ["LOCAL_DESKTOP", "CLOUD_H5", "CLOUD_THIRD_PARTY", "CLOUD_REMOTE_REPRINT"];
    const results = await Promise.all(sources.map((source) => coordinator.execute({
      mode: "V3_ACTIVE", source, authority, identity, endpointKey: "front:9100", payload: new Uint8Array([1]),
    })));
    expect(boundary.cross).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === "CROSSED")).toHaveLength(1);
    expect(results.filter((result) => result.status === "NOT_EXECUTED")).toHaveLength(3);
  });

  it("preserves V2 fallback without invoking V3 and blocks unknown mode", async () => {
    const boundary: PrintingEffectBoundary<Uint8Array> = { cross: vi.fn() };
    const { coordinator } = await composition(boundary);
    const common = { source: "LOCAL_DESKTOP" as const, authority, identity, endpointKey: "front:9100", payload: new Uint8Array() };
    expect(await coordinator.execute({ ...common, mode: "V2_ACTIVE" })).toEqual({ status: "V2_FALLBACK_REQUIRED" });
    expect(await coordinator.execute({ ...common, mode: "BLOCKED_UNKNOWN" })).toEqual({ status: "MODE_BLOCKED" });
    expect(boundary.cross).not.toHaveBeenCalled();
  });

  it("rejects stale ownership before Ledger acceptance or effect", async () => {
    const boundary: PrintingEffectBoundary<Uint8Array> = { cross: vi.fn() };
    const { ledger, coordinator } = await composition(boundary);
    expect(await coordinator.execute({
      mode: "V3_ACTIVE", source: "CLOUD_H5", authority: { ...authority, ownerEpoch: 3 },
      identity, endpointKey: "front:9100", payload: new Uint8Array(),
    })).toMatchObject({ status: "AUTHORITY_REJECTED", mode: "FENCED" });
    expect(await ledger.get(identity.printJobId)).toEqual({ ok: true, value: { found: false } });
    expect(boundary.cross).not.toHaveBeenCalled();
  });

  it("restart preserves UNKNOWN and terminal tombstones against delayed Cloud delivery", async () => {
    for (const outcome of ["UNKNOWN", "CROSSED"] as const) {
      const firstBoundary: PrintingEffectBoundary<Uint8Array> = {
        cross: vi.fn(async (): Promise<EffectBoundaryResult> => outcome === "UNKNOWN"
          ? { outcome: "UNKNOWN", reason: "CRASH_WINDOW" }
          : { outcome: "CROSSED", allBytesWritten: true, flushAndFinConfirmed: true }),
      };
      const { root, ledger, coordinator } = await composition(firstBoundary);
      const job = { ...identity, printJobId: `job-${outcome}`, requestHash: `hash-${outcome}` };
      await coordinator.execute({ mode: "V3_ACTIVE", source: "LOCAL_DESKTOP", authority, identity: job, endpointKey: "front:9100", payload: new Uint8Array() });
      expect((await ledger.close()).ok).toBe(true);

      const reopened = createExecutionLedger({ userDataPath: root, platform: "win32", now: () => new Date(now) });
      expect((await reopened.open()).ok).toBe(true);
      const delayedBoundary: PrintingEffectBoundary<Uint8Array> = { cross: vi.fn() };
      const restarted = new LocalFirstPrintCoordinator(
        new ExecutionAuthorityGuard(authority, 10 * 60_000, () => now),
        new SharedPrintingCore(reopened, delayedBoundary),
      );
      expect(await restarted.execute({ mode: "V3_ACTIVE", source: "CLOUD_H5", authority, identity: job, endpointKey: "front:9100", payload: new Uint8Array() }))
        .toMatchObject({ status: "NOT_EXECUTED", record: { state: outcome === "UNKNOWN" ? "CROSSING_UNKNOWN" : "CROSSED" } });
      expect(delayedBoundary.cross).not.toHaveBeenCalled();
      await reopened.close();
    }
  });
});
