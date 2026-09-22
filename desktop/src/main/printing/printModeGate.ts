export type PrintExecutionMode =
  | "V2_ACTIVE"
  | "V2_DRAINING"
  | "V3_ACTIVE"
  | "V3_DRAINING"
  | "BLOCKED_UNKNOWN";

export type HeldPrintIntent<T> = { printJobId: string; value: T };

export class PrintModeGate<T> {
  private held: HeldPrintIntent<T>[] = [];
  private heldSince = new Map<string, number>();

  public constructor(
    private mode: PrintExecutionMode,
    private readonly heldWatchdogMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {
    if (heldWatchdogMs < 30_000 || heldWatchdogMs > 300_000) {
      throw new Error("heldWatchdogMs must be between 30 and 300 seconds");
    }
  }

  public current(): PrintExecutionMode {
    return this.mode;
  }

  public route(intent: HeldPrintIntent<T>): "V2" | "V3" | "HELD" {
    if (this.mode === "V2_ACTIVE") return "V2";
    if (this.mode === "V3_ACTIVE") return "V3";
    if (!this.held.some(({ printJobId }) => printJobId === intent.printJobId)) {
      this.held.push(intent);
      this.heldSince.set(intent.printJobId, this.now());
    }
    return "HELD";
  }

  public overdueHeldPrintJobIds(): string[] {
    const now = this.now();
    return this.held
      .filter(({ printJobId }) => now - (this.heldSince.get(printJobId) ?? now) >= this.heldWatchdogMs)
      .map(({ printJobId }) => printJobId);
  }

  public beginDrain(): boolean {
    if (this.mode === "V2_ACTIVE") this.mode = "V2_DRAINING";
    else if (this.mode === "V3_ACTIVE") this.mode = "V3_DRAINING";
    else return false;
    return true;
  }

  public abortDrain(): boolean {
    if (this.mode === "V2_DRAINING") this.mode = "V2_ACTIVE";
    else if (this.mode === "V3_DRAINING") this.mode = "V3_ACTIVE";
    else return false;
    return true;
  }

  public completeTransfer(target: "V2_ACTIVE" | "V3_ACTIVE", oldExecutorReleased: boolean): HeldPrintIntent<T>[] {
    if (!oldExecutorReleased || (this.mode !== "V2_DRAINING" && this.mode !== "V3_DRAINING")) {
      this.mode = "BLOCKED_UNKNOWN";
      return [];
    }
    if (
      (this.mode === "V2_DRAINING" && target !== "V3_ACTIVE") ||
      (this.mode === "V3_DRAINING" && target !== "V2_ACTIVE")
    ) {
      this.mode = "BLOCKED_UNKNOWN";
      return [];
    }
    this.mode = target;
    const released = this.held;
    this.held = [];
    this.heldSince.clear();
    return released;
  }

  public blockUnknown(): void {
    this.mode = "BLOCKED_UNKNOWN";
  }
}
