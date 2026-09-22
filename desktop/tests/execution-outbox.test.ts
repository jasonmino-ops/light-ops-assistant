import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  it("persists minimal idempotent outcomes across restart", async () => {
    const { directory, instance } = await outbox();
    const entry = { executionId: "execution-a", printJobId: "job-a", ownerEpoch: 3, outcome: "CROSSED" as const };
    await instance.enqueue(entry);
    await instance.enqueue(entry);
    const reopened = (await outbox(directory)).instance;
    expect(reopened.list()).toEqual([{ ...entry, createdAt: "2026-01-01T00:00:00.000Z", attempts: 0 }]);
    expect(JSON.stringify(reopened.list())).not.toMatch(/payload|customer|item|esc|bytes/i);
  });

  it("rejects execution identity conflicts", async () => {
    const { instance } = await outbox();
    await instance.enqueue({ executionId: "execution-a", printJobId: "job-a", ownerEpoch: 3, outcome: "CROSSED" });
    await expect(instance.enqueue({ executionId: "execution-a", printJobId: "job-a", ownerEpoch: 4, outcome: "CROSSED" }))
      .rejects.toThrow("OUTBOX_IDENTITY_CONFLICT");
  });

  it("continues attempts and acknowledgement without execution authority", async () => {
    const { instance } = await outbox();
    await instance.enqueue({ executionId: "execution-a", printJobId: "job-a", ownerEpoch: 3, outcome: "CROSSING_UNKNOWN" });
    await instance.recordAttempt("execution-a");
    expect(instance.list()[0]?.attempts).toBe(1);
    await instance.acknowledge("execution-a");
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
});
