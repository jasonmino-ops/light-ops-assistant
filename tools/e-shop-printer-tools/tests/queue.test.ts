import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProvisioningPlan,
  PowerShellWindowsPrinterQueueAdapter,
  printerFingerprint,
  type DiscoveredPrinter,
  type WindowsNetworkSnapshot,
} from "../src/index.js";

const snapshot: WindowsNetworkSnapshot = {
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
snapshot.preferredInterface = snapshot.interfaces[0];

const adapter = new PowerShellWindowsPrinterQueueAdapter();

test("generates idempotent FRONT queue create/repair commands", async () => {
  const printer: DiscoveredPrinter = {
    manufacturer: "Rongta", model: "RP80", mac: null, ip: null, port: null, transport: "USB", capabilities: ["USB"], rawData: null,
    metadata: { serialNumber: "SYNTHETIC-001", usbPortName: "USB001" },
  };
  const plan = await buildProvisioningPlan({
    currentWindowsNetwork: snapshot,
    selectedPrinter: printer,
    role: "FRONT",
    confirmedPrinterFingerprint: printerFingerprint(printer),
  });
  const input = { plan, driverName: "Rongta Printer Driver", usbPortName: "USB001" };
  const commands = adapter.buildCommands(input);
  assert.equal(commands.queueName, "前台");
  assert.equal(commands.transport, "USB");
  assert.match(commands.applyScript, /if \(-not \$queue\) \{ Add-Printer/);
  assert.match(commands.applyScript, /elseif .* Set-Printer/);
  assert.equal(adapter.validateState(input, {
    queueName: "前台", driverName: "Rongta Printer Driver", portName: "USB001",
  }).ready, true);
});

test("generates idempotent KITCHEN Standard TCP/IP RAW 9100 commands", async () => {
  const printer: DiscoveredPrinter = {
    manufacturer: "Rongta", model: "RP80", mac: "00:11:22:33:44:55", ip: "172.16.8.90", port: null,
    transport: "NETWORK", capabilities: ["ETHERNET"], rawData: null, metadata: {},
  };
  const plan = await buildProvisioningPlan({
    currentWindowsNetwork: snapshot,
    selectedPrinter: printer,
    role: "KITCHEN",
    confirmedPrinterFingerprint: printerFingerprint(printer),
    conflictDetector: async () => false,
  });
  const input = { plan, driverName: "Rongta Printer Driver" };
  const commands = adapter.buildCommands(input);
  assert.equal(commands.queueName, "厨房");
  assert.equal(commands.transport, "STANDARD_TCP_IP");
  assert.equal(commands.protocol, "RAW");
  assert.equal(commands.rawPort, 9100);
  assert.match(commands.applyScript, /Add-PrinterPort .* -PortNumber 9100/);
  assert.match(commands.applyScript, /PRINTER_PORT_CONFLICT/);
  assert.equal(adapter.validateState(input, {
    queueName: "厨房",
    driverName: "Rongta Printer Driver",
    portName: `E-SHOP-RAW-${plan.candidateIp}`,
    printerHostAddress: plan.candidateIp!,
    portNumber: 9100,
  }).ready, true);
});

test("refuses command generation until identity and conflict gates pass", async () => {
  const printer: DiscoveredPrinter = {
    manufacturer: "Rongta", model: "RP80", mac: "00:11:22:33:44:55", ip: "172.16.8.90", port: null,
    transport: "NETWORK", capabilities: ["ETHERNET"], rawData: null, metadata: {},
  };
  const blockedPlan = await buildProvisioningPlan({
    currentWindowsNetwork: snapshot,
    selectedPrinter: printer,
    role: "KITCHEN",
  });
  assert.throws(() => adapter.buildCommands({ plan: blockedPlan, driverName: "Rongta Printer Driver" }), /PROVISIONING_PLAN_BLOCKED/);
});
