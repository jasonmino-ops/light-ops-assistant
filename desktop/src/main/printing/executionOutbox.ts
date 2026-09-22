import { promises as fs } from "node:fs";
import path from "node:path";

export type ExecutionOutcome = "CROSSED" | "FAILED_NOT_CROSSED" | "CROSSING_UNKNOWN";
export type OutboxEntry = {
  executionId: string;
  printJobId: string;
  ownerEpoch: number;
  outcome: ExecutionOutcome;
  createdAt: string;
  attempts: number;
};
type OutboxFile = { schemaVersion: 1; entries: OutboxEntry[] };
const OUTCOMES: readonly ExecutionOutcome[] = ["CROSSED", "FAILED_NOT_CROSSED", "CROSSING_UNKNOWN"];

function validEntry(value: unknown): value is OutboxEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).sort().join(",") === "attempts,createdAt,executionId,outcome,ownerEpoch,printJobId" &&
    typeof entry.executionId === "string" && entry.executionId.length > 0 &&
    typeof entry.printJobId === "string" && entry.printJobId.length > 0 &&
    Number.isInteger(entry.ownerEpoch) && (entry.ownerEpoch as number) > 0 &&
    typeof entry.outcome === "string" && OUTCOMES.includes(entry.outcome as ExecutionOutcome) &&
    typeof entry.createdAt === "string" && !Number.isNaN(Date.parse(entry.createdAt)) &&
    Number.isInteger(entry.attempts) && (entry.attempts as number) >= 0;
}

export class ExecutionOutbox {
  private readonly filePath: string;
  private entries: OutboxEntry[] = [];
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly root: string, private readonly now: () => Date = () => new Date()) {
    this.filePath = path.join(root, ".execution-outbox.json");
  }

  public async open(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8")) as OutboxFile;
      if (
        parsed.schemaVersion !== 1 ||
        !Array.isArray(parsed.entries) ||
        !parsed.entries.every(validEntry) ||
        new Set(parsed.entries.map(({ executionId }) => executionId)).size !== parsed.entries.length
      ) throw new Error("OUTBOX_CORRUPT");
      this.entries = parsed.entries.map((entry) => ({ ...entry }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  public enqueue(input: Omit<OutboxEntry, "createdAt" | "attempts">): Promise<void> {
    return this.exclusive(async () => {
      const existing = this.entries.find(({ executionId }) => executionId === input.executionId);
      if (existing) {
        if (existing.printJobId !== input.printJobId || existing.ownerEpoch !== input.ownerEpoch) {
          throw new Error("OUTBOX_IDENTITY_CONFLICT");
        }
        if (existing.outcome === input.outcome) return;
        if (existing.outcome !== "CROSSING_UNKNOWN" || input.outcome === "CROSSING_UNKNOWN") {
          throw new Error("OUTBOX_OUTCOME_CONFLICT");
        }
        await this.persist(this.entries.map((entry) => entry.executionId === input.executionId
          ? { ...entry, outcome: input.outcome }
          : entry));
        return;
      }
      await this.persist([...this.entries, { ...input, createdAt: this.now().toISOString(), attempts: 0 }]);
    });
  }

  public list(): OutboxEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  public acknowledge(executionId: string): Promise<void> {
    return this.exclusive(() => this.persist(this.entries.filter((entry) => entry.executionId !== executionId)));
  }

  public recordAttempt(executionId: string): Promise<void> {
    return this.exclusive(() => this.persist(this.entries.map((entry) =>
      entry.executionId === executionId ? { ...entry, attempts: entry.attempts + 1 } : entry)));
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async persist(entries: OutboxEntry[]): Promise<void> {
    const temporary = `${this.filePath}.tmp`;
    const handle = await fs.open(temporary, "w");
    try {
      await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, entries })}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, this.filePath);
    const finalHandle = await fs.open(this.filePath, "r+");
    try { await finalHandle.sync(); } finally { await finalHandle.close(); }
    if (process.platform !== "win32") {
      const directory = await fs.open(this.root, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
    this.entries = entries;
  }
}
