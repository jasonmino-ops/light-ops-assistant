export type PrintExecutionMode =
  | "V2_ACTIVE"
  | "V2_DRAINING"
  | "V3_ACTIVE"
  | "V3_DRAINING"
  | "BLOCKED_UNKNOWN";

export type HeldPrintIntent<T> = { printJobId: string; value: T };

export class PrintModeGate<T> {
  private held: HeldPrintIntent<T>[] = [];

  public constructor(private mode: PrintExecutionMode) {}

  public current(): PrintExecutionMode {
    return this.mode;
  }

  public route(intent: HeldPrintIntent<T>): "V2" | "V3" | "HELD" {
    if (this.mode === "V2_ACTIVE") return "V2";
    if (this.mode === "V3_ACTIVE") return "V3";
    if (!this.held.some(({ printJobId }) => printJobId === intent.printJobId)) this.held.push(intent);
    return "HELD";
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
    return released;
  }

  public blockUnknown(): void {
    this.mode = "BLOCKED_UNKNOWN";
  }
}
