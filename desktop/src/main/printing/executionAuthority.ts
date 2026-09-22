export type AuthorityMode = "CONNECTED" | "PARTITION_GRACE" | "ADMISSION_CLOSED" | "FENCED";

export type ExecutionAuthority = {
  storeId: string;
  deviceId: string;
  ownerEpoch: number;
  leaseId: string;
  batchExpiresAt: string;
};

export type AuthorityDecision =
  | { allowed: true; mode: "CONNECTED" | "PARTITION_GRACE" }
  | { allowed: false; mode: "ADMISSION_CLOSED" | "FENCED"; reason: string };

export class ExecutionAuthorityGuard {
  private disconnectedAtMs: number | null = null;
  private highestObservedEpoch: number;
  private invalidEpochObserved = false;

  public constructor(
    private readonly authority: ExecutionAuthority,
    private readonly partitionGraceMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(authority.ownerEpoch) || authority.ownerEpoch < 1) {
      throw new Error("ownerEpoch must be a positive integer");
    }
    if (partitionGraceMs < 10 * 60 * 1000) {
      throw new Error("partitionGraceMs must be at least ten minutes");
    }
    this.highestObservedEpoch = authority.ownerEpoch;
  }

  public noteConnected(observedOwnerEpoch: number): void {
    if (!Number.isInteger(observedOwnerEpoch) || observedOwnerEpoch < 1) {
      this.invalidEpochObserved = true;
      return;
    }
    this.highestObservedEpoch = Math.max(this.highestObservedEpoch, observedOwnerEpoch);
    this.disconnectedAtMs = null;
  }

  public noteDisconnected(): void {
    this.disconnectedAtMs ??= this.now();
  }

  public canAdmit(candidate: ExecutionAuthority): AuthorityDecision {
    if (this.invalidEpochObserved) {
      return { allowed: false, mode: "ADMISSION_CLOSED", reason: "INVALID_OBSERVED_EPOCH" };
    }
    if (
      candidate.storeId !== this.authority.storeId ||
      candidate.deviceId !== this.authority.deviceId ||
      candidate.leaseId !== this.authority.leaseId ||
      candidate.ownerEpoch !== this.authority.ownerEpoch ||
      this.highestObservedEpoch > candidate.ownerEpoch
    ) {
      return { allowed: false, mode: "FENCED", reason: "AUTHORITY_MISMATCH" };
    }
    const now = this.now();
    const batchExpiresAt = Date.parse(candidate.batchExpiresAt);
    if (!Number.isFinite(batchExpiresAt) || batchExpiresAt <= now) {
      return { allowed: false, mode: "ADMISSION_CLOSED", reason: "BATCH_EXPIRED" };
    }
    if (this.disconnectedAtMs === null) return { allowed: true, mode: "CONNECTED" };
    if (now - this.disconnectedAtMs <= this.partitionGraceMs) {
      return { allowed: true, mode: "PARTITION_GRACE" };
    }
    return { allowed: false, mode: "ADMISSION_CLOSED", reason: "PARTITION_GRACE_EXPIRED" };
  }
}
