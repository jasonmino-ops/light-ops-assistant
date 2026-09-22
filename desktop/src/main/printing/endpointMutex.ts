import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

type EndpointLock = { version: 1; endpointKey: string; ownerToken: string; processId: number };

export type EndpointMutexOptions = {
  root: string;
  processId?: number;
  pollMs?: number;
  staleRecovery?: {
    hasExclusiveRecoveryAuthority(): boolean;
    proveProcessDead(processId: number): Promise<true | false | "UNKNOWN">;
  };
};

function validLock(value: unknown): value is EndpointLock {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const lock = value as Record<string, unknown>;
  return Object.keys(lock).sort().join(",") === "endpointKey,ownerToken,processId,version" &&
    lock.version === 1 && typeof lock.endpointKey === "string" &&
    typeof lock.ownerToken === "string" && Number.isInteger(lock.processId) && (lock.processId as number) > 0;
}

export class EndpointMutex {
  private readonly processId: number;
  private readonly pollMs: number;

  public constructor(private readonly options: EndpointMutexOptions) {
    this.processId = options.processId ?? process.pid;
    this.pollMs = options.pollMs ?? 5;
  }

  public async runExclusive<T>(endpointKey: string, operation: () => Promise<T>): Promise<T> {
    const digest = createHash("sha256").update(endpointKey).digest("hex");
    const lockPath = path.join(this.options.root, `.endpoint-${digest}.lock`);
    const ownerToken = randomUUID();
    for (;;) {
      try {
        const handle = await fs.open(lockPath, "wx");
        try {
          await handle.writeFile(`${JSON.stringify({ version: 1, endpointKey, ownerToken, processId: this.processId })}\n`);
          await handle.sync();
        } finally {
          await handle.close();
        }
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const raw = await fs.readFile(lockPath, "utf8");
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { throw new Error("ENDPOINT_MUTEX_UNVERIFIABLE"); }
        if (!validLock(parsed) || parsed.endpointKey !== endpointKey) throw new Error("ENDPOINT_MUTEX_UNVERIFIABLE");
        if (this.options.staleRecovery) {
          if (this.options.staleRecovery.hasExclusiveRecoveryAuthority() !== true) {
            throw new Error("ENDPOINT_MUTEX_RECOVERY_NOT_AUTHORIZED");
          }
          const proof = await this.options.staleRecovery.proveProcessDead(parsed.processId);
          if (proof === true) {
            if (await fs.readFile(lockPath, "utf8") !== raw) throw new Error("ENDPOINT_MUTEX_CHANGED");
            await fs.unlink(lockPath);
            continue;
          }
          throw new Error("ENDPOINT_MUTEX_OWNER_NOT_PROVEN_DEAD");
        }
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      }
    }

    try {
      return await operation();
    } finally {
      const parsed = JSON.parse(await fs.readFile(lockPath, "utf8")) as unknown;
      if (!validLock(parsed) || parsed.ownerToken !== ownerToken) throw new Error("ENDPOINT_MUTEX_OWNERSHIP_LOST");
      await fs.unlink(lockPath);
    }
  }
}
