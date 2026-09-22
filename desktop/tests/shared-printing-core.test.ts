import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutionLedger, type ExecutionLedger } from "../src/main/printing/executionLedger";
import {
  SharedPrintingCore,
  type EffectBoundaryResult,
  type PrintingEffectBoundary,
} from "../src/main/printing/sharedPrintingCore";

const roots: string[] = [];
const identity = {
  printJobId: "job-1",
  requestHash: "hash-1",
  rendererVersion: "renderer-v1",
  expiresAt: "2027-01-01T00:00:00.000Z",
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function ledger(): Promise<ExecutionLedger> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shared-printing-core-"));
  roots.push(root);
  const instance = createExecutionLedger({
    userDataPath: root,
    platform: "win32",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  expect((await instance.open()).ok).toBe(true);
  return instance;
}

function boundary(result: EffectBoundaryResult | Error): PrintingEffectBoundary<Uint8Array> {
  return {
    cross: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe("SharedPrintingCore", () => {
  it("never invokes the effect when the durable barrier fails", async () => {
    const effect = boundary({ outcome: "CROSSED", allBytesWritten: true, flushAndFinConfirmed: true });
    const core = new SharedPrintingCore({
      accept: vi.fn(async () => ({ ok: true as const, value: {
        kind: "CREATED" as const,
        record: { printJobId: "job-1", executionId: "execution-1", state: "NOT_CROSSED" as const, stateVersion: 0, physicalCompletionKnown: false as const },
      } })),
      beginCrossing: vi.fn(async () => ({ ok: false as const, error: { code: "LEDGER_DURABILITY_FAILURE", message: "fsync failed" } })),
      confirmNotCrossed: vi.fn(),
      markCrossed: vi.fn(),
    }, effect);
    expect(await core.execute({ identity, endpointKey: "printer-a:9100", payload: new Uint8Array() }))
      .toMatchObject({ status: "REJECTED", error: { code: "LEDGER_DURABILITY_FAILURE" } });
    expect(effect.cross).not.toHaveBeenCalled();
  });

  it("persists the UNKNOWN barrier before invoking the effect", async () => {
    const instance = await ledger();
    let stateAtEffect: string | undefined;
    const effect: PrintingEffectBoundary<Uint8Array> = {
      cross: vi.fn(async ({ identity: accepted }): Promise<EffectBoundaryResult> => {
        const current = await instance.get(accepted.printJobId);
        if (current.ok && current.value.found) stateAtEffect = current.value.record.state;
        return { outcome: "CROSSED", allBytesWritten: true, flushAndFinConfirmed: true };
      }),
    };
    const result = await new SharedPrintingCore(instance, effect).execute({
      identity,
      endpointKey: "printer-a:9100",
      payload: new Uint8Array([1]),
    });
    expect(stateAtEffect).toBe("CROSSING_UNKNOWN");
    expect(result).toMatchObject({ status: "CROSSED", record: { physicalCompletionKnown: false } });
  });

  it.each([
    ["explicit unknown", boundary({ outcome: "UNKNOWN", reason: "PARTIAL_WRITE" })],
    ["throw", boundary(new Error("timeout"))],
  ])("keeps %s fail-closed and never executes the same job again", async (_name, effect) => {
    const instance = await ledger();
    const core = new SharedPrintingCore(instance, effect);
    expect(await core.execute({ identity, endpointKey: "printer-a:9100", payload: new Uint8Array() }))
      .toMatchObject({ status: "CROSSING_UNKNOWN" });
    expect(await core.execute({ identity, endpointKey: "printer-a:9100", payload: new Uint8Array() }))
      .toMatchObject({ status: "NOT_EXECUTED", record: { state: "CROSSING_UNKNOWN" } });
    expect(effect.cross).toHaveBeenCalledTimes(1);
  });

  it("maps only explicit zero-byte proof to FAILED_NOT_CROSSED without retry", async () => {
    const instance = await ledger();
    const effect = boundary({ outcome: "NOT_CROSSED", zeroBytesSent: true, errorCode: "NO_CONNECT" });
    const core = new SharedPrintingCore(instance, effect);
    expect(await core.execute({ identity, endpointKey: "printer-a:9100", payload: new Uint8Array() }))
      .toMatchObject({ status: "FAILED_NOT_CROSSED", record: { zeroBytesSent: true } });
    expect(await core.execute({ identity, endpointKey: "printer-a:9100", payload: new Uint8Array() }))
      .toMatchObject({ status: "NOT_EXECUTED", record: { state: "FAILED_NOT_CROSSED" } });
    expect(effect.cross).toHaveBeenCalledTimes(1);
  });

  it("rejects identity conflicts before the effect boundary", async () => {
    const instance = await ledger();
    const effect = boundary({ outcome: "CROSSED", allBytesWritten: true, flushAndFinConfirmed: true });
    const core = new SharedPrintingCore(instance, effect);
    await core.execute({ identity, endpointKey: "printer-a:9100", payload: new Uint8Array() });
    expect(await core.execute({
      identity: { ...identity, requestHash: "different" },
      endpointKey: "printer-a:9100",
      payload: new Uint8Array(),
    })).toMatchObject({ status: "REJECTED", error: { code: "LEDGER_IDENTITY_CONFLICT" } });
    expect(effect.cross).toHaveBeenCalledTimes(1);
  });

  it("strictly serializes one endpoint while allowing different endpoints concurrently", async () => {
    const instance = await ledger();
    const entered: string[] = [];
    const releases = new Map<string, () => void>();
    const effect: PrintingEffectBoundary<Uint8Array> = {
      cross: vi.fn(async ({ identity: accepted, endpointKey }): Promise<EffectBoundaryResult> => {
        entered.push(accepted.printJobId);
        await new Promise<void>((resolve) => releases.set(accepted.printJobId, resolve));
        return { outcome: "CROSSED", allBytesWritten: true, flushAndFinConfirmed: true };
      }),
    };
    const core = new SharedPrintingCore(instance, effect);
    const execute = (printJobId: string, endpointKey: string) => core.execute({
      identity: { ...identity, printJobId, requestHash: `hash-${printJobId}` },
      endpointKey,
      payload: new Uint8Array(),
    });

    const first = execute("job-a1", "printer-a:9100");
    const queued = execute("job-a2", "printer-a:9100");
    const parallel = execute("job-b1", "printer-b:9100");
    await vi.waitFor(() => expect(entered).toEqual(["job-a1", "job-b1"]));
    releases.get("job-b1")?.();
    await parallel;
    expect(entered).not.toContain("job-a2");
    releases.get("job-a1")?.();
    await first;
    await vi.waitFor(() => expect(entered).toContain("job-a2"));
    releases.get("job-a2")?.();
    await queued;
  });
});
