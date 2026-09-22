import { promises as fs } from "node:fs";
import path from "node:path";

export type ExecutionOutcome = "CROSSED" | "FAILED_NOT_CROSSED" | "CROSSING_UNKNOWN";
export type OutboxEntry = {
  batchId: string;
  executionId: string;
  printJobId: string;
  source: "LOCAL_DESKTOP" | "CLOUD_H5" | "CLOUD_THIRD_PARTY" | "CLOUD_REMOTE_REPRINT";
  role: "FRONT" | "KITCHEN";
  ownerEpoch: number;
  outcome: ExecutionOutcome;
  reportable: boolean;
  createdAt: string;
  attempts: number;
};
type OutboxFile = { schemaVersion: 1 | 2; entries: Array<OutboxEntry | Omit<OutboxEntry, "reportable">> };
const OUTCOMES: readonly ExecutionOutcome[] = ["CROSSED", "FAILED_NOT_CROSSED", "CROSSING_UNKNOWN"];

function validEntry(value: unknown): value is OutboxEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).sort().join(",") === "attempts,batchId,createdAt,executionId,outcome,ownerEpoch,printJobId,reportable,role,source" &&
    typeof entry.batchId === "string" && entry.batchId.length > 0 &&
    typeof entry.executionId === "string" && entry.executionId.length > 0 &&
    typeof entry.printJobId === "string" && entry.printJobId.length > 0 &&
    ["LOCAL_DESKTOP", "CLOUD_H5", "CLOUD_THIRD_PARTY", "CLOUD_REMOTE_REPRINT"].includes(String(entry.source)) &&
    (entry.role === "FRONT" || entry.role === "KITCHEN") &&
    Number.isInteger(entry.ownerEpoch) && (entry.ownerEpoch as number) > 0 &&
    typeof entry.outcome === "string" && OUTCOMES.includes(entry.outcome as ExecutionOutcome) &&
    typeof entry.reportable === "boolean" &&
    typeof entry.createdAt === "string" && !Number.isNaN(Date.parse(entry.createdAt)) &&
    Number.isInteger(entry.attempts) && (entry.attempts as number) >= 0;
}

export class ExecutionOutbox {
  private readonly filePath: string;
  private entries: OutboxEntry[] = [];
  private queue: Promise<void> = Promise.resolve();
  private unusable = false;

  public constructor(private readonly root: string, private readonly now: () => Date = () => new Date()) {
    this.filePath = path.join(root, ".execution-outbox.json");
  }

  public async open(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8")) as OutboxFile;
      if (
        (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) ||
        !Array.isArray(parsed.entries) ||
        !(parsed.schemaVersion === 1
          ? parsed.entries.every((entry) => validEntry({ ...(entry as object), reportable: true }))
          : parsed.entries.every(validEntry)) ||
        new Set(parsed.entries.map(({ executionId }) => executionId)).size !== parsed.entries.length
      ) throw new Error("OUTBOX_CORRUPT");
      this.entries = parsed.entries.map((entry) => ({ ...entry, reportable: parsed.schemaVersion === 1 ? true : (entry as OutboxEntry).reportable }));
      const recovered = this.entries.map((entry) => entry.reportable ? entry : { ...entry, reportable: true });
      if (parsed.schemaVersion === 1 || recovered.some((entry, index) => entry !== this.entries[index])) await this.persist(recovered);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  public enqueue(input: Omit<OutboxEntry, "createdAt" | "attempts">): Promise<void> {
    return this.exclusive(async () => {
      const existing = this.entries.find(({ executionId }) => executionId === input.executionId);
      if (existing) {
        if (existing.batchId !== input.batchId || existing.printJobId !== input.printJobId || existing.source !== input.source ||
          existing.role !== input.role || existing.ownerEpoch !== input.ownerEpoch) {
          throw new Error("OUTBOX_IDENTITY_CONFLICT");
        }
        if (existing.outcome === input.outcome && existing.reportable === input.reportable) return;
        if (existing.outcome !== "CROSSING_UNKNOWN" || input.outcome === "CROSSING_UNKNOWN") {
          throw new Error("OUTBOX_OUTCOME_CONFLICT");
        }
        await this.persist(this.entries.map((entry) => entry.executionId === input.executionId
          ? { ...entry, outcome: input.outcome, reportable: input.reportable }
          : entry));
        return;
      }
      await this.persist([...this.entries, { ...input, createdAt: this.now().toISOString(), attempts: 0 }]);
    });
  }

  public list(): OutboxEntry[] {
    if (this.unusable) throw new Error("OUTBOX_UNUSABLE");
    return this.entries.map((entry) => ({ ...entry }));
  }

  public listReportable(): OutboxEntry[] {
    return this.list().filter((entry) => entry.reportable);
  }

  public acknowledge(executionId: string): Promise<void> {
    return this.exclusive(() => this.persist(this.entries.filter((entry) => entry.executionId !== executionId)));
  }

  public recordAttempt(executionId: string): Promise<void> {
    return this.exclusive(() => this.persist(this.entries.map((entry) =>
      entry.executionId === executionId ? { ...entry, attempts: entry.attempts + 1 } : entry)));
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const guarded = () => {
      if (this.unusable) throw new Error("OUTBOX_UNUSABLE");
      return operation();
    };
    const result = this.queue.then(guarded, guarded);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async persist(entries: OutboxEntry[]): Promise<void> {
    const temporary = `${this.filePath}.tmp`;
    let renamed = false;
    const handle = await fs.open(temporary, "w");
    try {
      await handle.writeFile(`${JSON.stringify({ schemaVersion: 2, entries })}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temporary, this.filePath);
      renamed = true;
      const finalHandle = await fs.open(this.filePath, "r+");
      try { await finalHandle.sync(); } finally { await finalHandle.close(); }
      if (process.platform !== "win32") {
        const directory = await fs.open(this.root, "r");
        try { await directory.sync(); } finally { await directory.close(); }
      }
      this.entries = entries;
    } catch (error) {
      if (renamed) this.unusable = true;
      throw error;
    }
  }
}
