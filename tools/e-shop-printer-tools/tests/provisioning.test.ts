import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProvisioningPlan,
  printerFingerprint,
  type DiscoveredPrinter,
  type WindowsNetworkSnapshot,
} from "../src/index.js";

const network: WindowsNetworkSnapshot = {
  interfaces: [{
    interface: "Ethernet",
    interfaceIndex: 4,
    ipv4: "10.20.30.10",
    subnetMask: "255.255.255.0",
    prefixLength: 24,
    gateway: "10.20.30.1",
    networkAddress: "10.20.30.0",
    broadcastAddress: "10.20.30.255",
  }],
  preferredInterface: null,
  capturedAt: "2026-08-14T00:00:00.000Z",
  source: "FIXTURE",
};
network.preferredInterface = network.interfaces[0];

function networkPrinter(ip: string): DiscoveredPrinter {
  return {
    manufacturer: "Rongta",
    model: "RP80",
    mac: "00:11:22:33:44:55",
    ip,
    port: 9100,
    transport: "NETWORK",
    capabilities: ["ETHERNET", "RAW_9100"],
    rawData: null,
    metadata: {},
  };
}

const usbPrinter: DiscoveredPrinter = {
  manufacturer: "Rongta",
  model: "RP80",
  mac: null,
  ip: null,
  port: null,
  transport: "USB",
  capabilities: ["USB"],
  rawData: null,
  metadata: { serialNumber: "SYNTHETIC-001", usbPortName: "USB001" },
};

test("builds a confirmed FRONT USB plan", async () => {
  const plan = await buildProvisioningPlan({
    currentWindowsNetwork: network,
    selectedPrinter: usbPrinter,
    role: "FRONT",
    confirmedPrinterFingerprint: printerFingerprint(usbPrinter),
  });
  assert.equal(plan.queueName, "前台");
  assert.equal(plan.executionAllowed, true);
  assert.equal(plan.rawPort, null);
});

test("keeps a kitchen printer already on the current subnet", async () => {
  const printer = networkPrinter("10.20.30.80");
  const plan = await buildProvisioningPlan({
    currentWindowsNetwork: network,
    selectedPrinter: printer,
    role: "KITCHEN",
    confirmedPrinterFingerprint: printerFingerprint(printer),
  });
  assert.equal(plan.candidateIp, "10.20.30.80");
  assert.equal(plan.networkMutationRequired, false);
  assert.equal(plan.conflictCheck.status, "NOT_REQUIRED");
  assert.equal(plan.executionAllowed, true);
});

test("selects from the subnet edge and uses the conflict hook before allowing execution", async () => {
  const printer = networkPrinter("172.16.8.90");
  const checked: string[] = [];
  const plan = await buildProvisioningPlan({
    currentWindowsNetwork: network,
    selectedPrinter: printer,
    role: "KITCHEN",
    confirmedPrinterFingerprint: printerFingerprint(printer),
    conflictDetector: async (candidate) => {
      checked.push(candidate);
      return candidate === "10.20.30.254";
    },
  });

  assert.equal(plan.candidateIp, "10.20.30.253");
  assert.deepEqual(checked, ["10.20.30.254", "10.20.30.253"]);
  assert.equal(plan.conflictCheck.status, "AVAILABLE");
  assert.equal(plan.networkMutationRequired, true);
  assert.equal(plan.executionAllowed, true);
});

test("blocks a different-subnet plan when conflict detection has not run", async () => {
  const printer = networkPrinter("172.16.8.90");
  const plan = await buildProvisioningPlan({
    currentWindowsNetwork: network,
    selectedPrinter: printer,
    role: "KITCHEN",
    confirmedPrinterFingerprint: printerFingerprint(printer),
  });
  assert.equal(plan.candidateIp, "10.20.30.254");
  assert.equal(plan.conflictCheck.status, "NOT_RUN");
  assert.equal(plan.executionAllowed, false);
  assert.ok(plan.blockers.includes("IP_CONFLICT_CHECK_REQUIRED"));
});

test("blocks unconfirmed identity and rejects role/transport mismatch", async () => {
  const printer = networkPrinter("10.20.30.80");
  const plan = await buildProvisioningPlan({
    currentWindowsNetwork: network,
    selectedPrinter: printer,
    role: "KITCHEN",
  });
  assert.equal(plan.executionAllowed, false);
  assert.ok(plan.blockers.includes("EXPLICIT_DEVICE_CONFIRMATION_REQUIRED"));
  await assert.rejects(() => buildProvisioningPlan({
    currentWindowsNetwork: network,
    selectedPrinter: printer,
    role: "FRONT",
  }), /ROLE_TRANSPORT_MISMATCH/);
});
