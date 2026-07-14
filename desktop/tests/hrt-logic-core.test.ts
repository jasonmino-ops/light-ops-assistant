import { describe, expect, it } from "vitest";
import { printReceiptCommandFixture } from "@eshop/hrt-contract";
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
    expect(registration.capabilityDescriptors.length).toBeGreaterThan(0);
    expect(core.registry.list()).toHaveLength(3);
    expect(core.registry.list()[0].health).toBe("UNKNOWN");

    const result = await core.execute(printReceiptCommandFixture.payload);

    expect(result.outcome).toBe("SUCCEEDED");
    expect(result.effectBoundary).toBe("CROSSED");
    expect(core.audit.list().map((event) => event.type)).toContain("hrt.command.result");
  });

  it("rejects command execution before provider registration", async () => {
    const core = new HrtLogicCore(new ProviderSimulator());

    await expect(core.execute(printReceiptCommandFixture.payload)).rejects.toThrow("Provider is not READY");
  });

  it("rejects duplicate registration from the same provider instance", () => {
    const core = new HrtLogicCore(new ProviderSimulator());

    core.registerProvider();

    expect(() => core.registerProvider()).toThrow("Duplicate provider registration");
    expect(core.state()).toBe("REJECTED");
  });

  it("rejects incompatible providers and missing required capabilities", () => {
    const incompatible = new HrtLogicCore(new ProviderSimulator({ contractVersion: "0.0.0" }));
    expect(() => incompatible.registerProvider()).toThrow("Provider contract version mismatch");

    const missingCapability = new HrtLogicCore(
      new ProviderSimulator({ capabilities: ["printer.receipt", "scanner.barcode_event"] }),
    );
    expect(() => missingCapability.registerProvider()).toThrow(
      "Provider compatibility rejected: MISSING_REQUIRED_CAPABILITY",
    );
  });

  it("allows restart with a new instance and rejects stale command results", async () => {
    const provider = new ProviderSimulator({ providerInstanceId: "provider-sim-before-restart" });
    const core = new HrtLogicCore(provider);

    core.registerProvider();
    provider.restart("provider-sim-after-restart");
    const registration = core.registerProvider();

    expect(registration.providerInstanceId).toBe("provider-sim-after-restart");
    expect(core.audit.list().map((event) => event.type)).toContain("hrt.provider.restart");

    provider.restart("provider-sim-stale-result");
    await expect(core.execute(printReceiptCommandFixture.payload)).rejects.toThrow("Stale provider instance");
  });
});
