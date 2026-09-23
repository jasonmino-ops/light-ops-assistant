import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EndpointMutex } from "../src/main/printing/endpointMutex";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function root() { const value = await mkdtemp(path.join(os.tmpdir(), "endpoint-mutex-")); roots.push(value); return value; }

describe("EndpointMutex", () => {
  it("serializes the same endpoint across instances and permits different endpoints", async () => {
    const directory = await root();
    const first = new EndpointMutex({ root: directory, pollMs: 1 });
    const second = new EndpointMutex({ root: directory, pollMs: 1 });
    const entered: string[] = [];
    let release!: () => void;
    const running = first.runExclusive("a:9100", async () => {
      entered.push("a1");
      await new Promise<void>((resolve) => { release = resolve; });
    });
    await vi.waitFor(() => expect(entered).toEqual(["a1"]));
    const queued = second.runExclusive("a:9100", async () => { entered.push("a2"); });
    await second.runExclusive("b:9100", async () => { entered.push("b1"); });
    expect(entered).toEqual(["a1", "b1"]);
    release();
    await running;
    await queued;
    expect(entered).toEqual(["a1", "b1", "a2"]);
  });

  it("recovers a crash lock only with dead-process and exclusive recovery proof", async () => {
    const directory = await root();
    const endpointKey = "a:9100";
    const digest = createHash("sha256").update(endpointKey).digest("hex");
    await writeFile(path.join(directory, `.endpoint-${digest}.lock`), JSON.stringify({
      version: 1, endpointKey, ownerToken: "dead", processId: 101,
    }));
    const mutex = new EndpointMutex({
      root: directory,
      processId: 202,
      staleRecovery: {
        hasExclusiveRecoveryAuthority: () => true,
        proveProcessDead: async (pid) => pid === 101,
      },
    });
    await expect(mutex.runExclusive(endpointKey, async () => "ok")).resolves.toBe("ok");
  });

  it.each([false, "UNKNOWN" as const])("fails closed when process-death proof is %s", async (proof) => {
    const directory = await root();
    const endpointKey = "a:9100";
    const digest = createHash("sha256").update(endpointKey).digest("hex");
    await writeFile(path.join(directory, `.endpoint-${digest}.lock`), JSON.stringify({
      version: 1, endpointKey, ownerToken: "possibly-live", processId: 101,
    }));
    const mutex = new EndpointMutex({
      root: directory,
      processId: 202,
      staleRecovery: {
        hasExclusiveRecoveryAuthority: () => true,
        proveProcessDead: async () => proof,
      },
    });
    await expect(mutex.runExclusive(endpointKey, async () => "unsafe"))
      .rejects.toThrow("ENDPOINT_MUTEX_OWNER_NOT_PROVEN_DEAD");
  });

  it("fails closed when stale-lock recovery lacks exclusive authority", async () => {
    const directory = await root();
    const endpointKey = "a:9100";
    const digest = createHash("sha256").update(endpointKey).digest("hex");
    await writeFile(path.join(directory, `.endpoint-${digest}.lock`), JSON.stringify({
      version: 1, endpointKey, ownerToken: "dead", processId: 101,
    }));
    const mutex = new EndpointMutex({
      root: directory,
      processId: 202,
      staleRecovery: {
        hasExclusiveRecoveryAuthority: () => false,
        proveProcessDead: async () => true,
      },
    });
    await expect(mutex.runExclusive(endpointKey, async () => "unsafe"))
      .rejects.toThrow("ENDPOINT_MUTEX_RECOVERY_NOT_AUTHORIZED");
  });
});
