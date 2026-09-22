import { describe, expect, it } from "vitest";
import { PrintModeGate } from "../src/main/printing/printModeGate";

describe("PrintModeGate", () => {
  it("routes only the active version and holds during every non-active mode", () => {
    expect(new PrintModeGate("V2_ACTIVE").route({ printJobId: "a", value: 1 })).toBe("V2");
    expect(new PrintModeGate("V3_ACTIVE").route({ printJobId: "a", value: 1 })).toBe("V3");
    for (const mode of ["V2_DRAINING", "V3_DRAINING", "BLOCKED_UNKNOWN"] as const) {
      expect(new PrintModeGate(mode).route({ printJobId: "a", value: 1 })).toBe("HELD");
    }
  });

  it("creates no overlap window and materializes HELD only after confirmed release", () => {
    const gate = new PrintModeGate<number>("V2_ACTIVE");
    expect(gate.beginDrain()).toBe(true);
    expect(gate.route({ printJobId: "a", value: 1 })).toBe("HELD");
    expect(gate.route({ printJobId: "a", value: 2 })).toBe("HELD");
    expect(gate.completeTransfer("V3_ACTIVE", true)).toEqual([{ printJobId: "a", value: 1 }]);
    expect(gate.current()).toBe("V3_ACTIVE");
  });

  it("fails closed on unproven release or invalid target and never auto-recovers", () => {
    for (const [target, released] of [["V3_ACTIVE", false], ["V2_ACTIVE", true]] as const) {
      const gate = new PrintModeGate("V2_ACTIVE");
      gate.beginDrain();
      expect(gate.completeTransfer(target, released)).toEqual([]);
      expect(gate.current()).toBe("BLOCKED_UNKNOWN");
      expect(gate.abortDrain()).toBe(false);
      expect(gate.beginDrain()).toBe(false);
    }
  });

  it("can safely abort a drain before authority release", () => {
    const gate = new PrintModeGate("V3_ACTIVE");
    expect(gate.beginDrain()).toBe(true);
    expect(gate.abortDrain()).toBe(true);
    expect(gate.current()).toBe("V3_ACTIVE");
  });
});
