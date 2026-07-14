import { describe, expect, it } from "vitest";
import { printReceiptCommandFixture } from "../../packages/hrt-contract/src";
import { ProviderSimulator } from "../../packages/hrt-provider-simulator/src";
import { HrtLogicCore } from "../src/main/hrt";

describe("HrtLogicCore", () => {
  it("registers a provider, refreshes device health, and executes a command", async () => {
    const provider = new ProviderSimulator({
      providerInstanceId: "provider-sim-vitest",
      startedAt: "2026-07-14T16:00:00.000Z",
    });
    const core = new HrtLogicCore(provider);

    const registration = core.registerProvider();

    expect(core.state()).toBe("READY");
    expect(registration.providerInstanceId).toBe("provider-sim-vitest");
    expect(core.registry.list()).toHaveLength(3);

    const result = await core.execute(printReceiptCommandFixture.payload);

    expect(result.outcome).toBe("SUCCEEDED");
    expect(result.effectBoundary).toBe("CROSSED");
    expect(core.audit.list().map((event) => event.type)).toContain("hrt.command.result");
  });

  it("rejects command execution before provider registration", async () => {
    const core = new HrtLogicCore(new ProviderSimulator());

    await expect(core.execute(printReceiptCommandFixture.payload)).rejects.toThrow("Provider is not READY");
  });
});

