import { promises as fs } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionOutbox } from "../src/main/printing/executionOutbox";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function outbox(root?: string) {
  const directory = root ?? await mkdtemp(path.join(os.tmpdir(), "execution-outbox-"));
  if (!root) roots.push(directory);
  const instance = new ExecutionOutbox(directory, () => new Date("2026-01-01T00:00:00.000Z"));
  await instance.open();
  return { directory, instance };
}

describe("ExecutionOutbox", () => {
  const provenance = { batchId: "batch-a", source: "LOCAL_DESKTOP" as const, role: "FRONT" as const };
  it("persists minimal idempotent outcomes across restart", async () => {
    const { directory, instance } = await outbox();
    const entry = { ...provenance, executionId: "execution-a", printJobId: "job-a", ownerEpoch: 3, outcome: "CROSSED" as const, reportable: true };
    await instance.enqueue(entry);
    await instance.enqueue(entry);
    const reopened = (await outbox(directory)).instance;
    expect(reopened.list()).toEqual([{ ...entry, factVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", attempts: 0 }]);
    expect(JSON.stringify(reopened.list())).not.toMatch(/payload|customer|item|esc|bytes/i);
  });

  it("rejects execution identity conflicts", async () => {
    const { instance } = await outbox();
    await instance.enqueue({ ...provenance, executionId: "execution-a", printJobId: "job-a", ownerEpoch: 3, outcome: "CROSSED", reportable: true });
    await expect(instance.enqueue({ ...provenance, executionId: "execution-a", printJobId: "job-a", ownerEpoch: 4, outcome: "CROSSED", reportable: true }))
      .rejects.toThrow("OUTBOX_IDENTITY_CONFLICT");
  });

  it("conservatively reserves UNKNOWN and only then permits a terminal report", async () => {
    const { instance } = await outbox();
    const base = { ...provenance, executionId: "execution-a", printJobId: "job-a", ownerEpoch: 3 };
    await instance.enqueue({ ...base, outcome: "CROSSING_UNKNOWN", reportable: false });
    expect(instance.listReportable()).toEqual([]);
    await instance.enqueue({ ...base, outcome: "CROSSED", reportable: true });
    expect(instance.list()[0]?.outcome).toBe("CROSSED");
    await expect(instance.enqueue({ ...base, outcome: "FAILED_NOT_CROSSED", reportable: true }))
      .rejects.toThrow("OUTBOX_OUTCOME_CONFLICT");
  });

  it("continues attempts and acknowledgement without execution authority", async () => {
    const { instance } = await outbox();
    await instance.enqueue({ ...provenance, executionId: "execution-a", printJobId: "job-a", ownerEpoch: 3, outcome: "CROSSING_UNKNOWN", reportable: true });
    await instance.recordAttempt("execution-a");
    expect(instance.list()[0]?.attempts).toBe(1);
    await instance.acknowledge("execution-a", 1);
    expect(instance.list()).toEqual([]);
  });

  it("fails closed for malformed or duplicate durable entries", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "execution-outbox-corrupt-"));
    roots.push(directory);
    await writeFile(path.join(directory, ".execution-outbox.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [{ executionId: "same" }, { executionId: "same" }],
    }));
    await expect(new ExecutionOutbox(directory).open()).rejects.toThrow("OUTBOX_CORRUPT");
  });

  it("poisons the instance after post-rename durability uncertainty and reloads from disk on restart", async () => {
    const { directory, instance } = await outbox();
    const originalOpen = fs.open.bind(fs);
    let opens = 0;
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      opens += 1;
      if (opens === 2) throw new Error("final fsync unavailable");
      return originalOpen(...args);
    });
    const entry = { ...provenance, executionId: "execution-a", printJobId: "job-a", ownerEpoch: 3, outcome: "CROSSING_UNKNOWN" as const, reportable: false };
    await expect(instance.enqueue(entry)).rejects.toThrow("final fsync unavailable");
    await expect(instance.enqueue({ ...entry, executionId: "execution-b", printJobId: "job-b" }))
      .rejects.toThrow("OUTBOX_UNUSABLE");
    expect(() => instance.list()).toThrow("OUTBOX_UNUSABLE");
    open.mockRestore();
    const restarted = (await outbox(directory)).instance;
    expect(restarted.list()).toMatchObject([{ ...entry, reportable: true }]);
  });

  it("makes an interrupted in-flight UNKNOWN reportable only after restart", async () => {
    const { directory, instance } = await outbox();
    await instance.enqueue({ ...provenance, executionId: "execution-a", printJobId: "job-a", ownerEpoch: 3, outcome: "CROSSING_UNKNOWN", reportable: false });
    expect(instance.listReportable()).toEqual([]);
    const restarted = (await outbox(directory)).instance;
    expect(restarted.listReportable()).toMatchObject([{ executionId: "execution-a", outcome: "CROSSING_UNKNOWN", reportable: true }]);
  });

  it("does not let a stale UNKNOWN ACK delete a concurrently persisted terminal fact", async () => {
    const { instance } = await outbox();
    const base = { ...provenance, executionId: "execution-a", printJobId: "job-a", ownerEpoch: 3 };
    await instance.enqueue({ ...base, outcome: "CROSSING_UNKNOWN", reportable: true });
    const stale = instance.listReportable()[0]!;
    await instance.enqueue({ ...base, outcome: "CROSSED", reportable: true });
    expect(await instance.acknowledge(stale.executionId, stale.factVersion)).toBe(false);
    expect(instance.listReportable()).toMatchObject([{ outcome: "CROSSED", factVersion: 2 }]);
  });
});
