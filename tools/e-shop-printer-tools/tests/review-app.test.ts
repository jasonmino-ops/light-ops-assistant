import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dispatchReviewRoute, isLocalSessionAuthorized, REVIEW_API_ROUTES } from "../src/app/httpServer.js";
import { JsonLineReviewLogger } from "../src/app/logger.js";
import { productManifest } from "../src/app/product.js";
import { ReviewService } from "../src/app/reviewService.js";
import type { DiscoveredPrinter, WindowsNetworkSnapshot } from "../src/types.js";

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

const frontPrinter: DiscoveredPrinter = {
  manufacturer: "Fixture Manufacturer",
  model: "Fixture USB Printer",
  mac: null,
  ip: null,
  port: null,
  transport: "USB",
  capabilities: ["USB"],
  rawData: null,
  metadata: {
    pnpDeviceId: "USB\\VID_1234&PID_ABCD\\SYNTHETIC",
    vendorId: "1234",
    productId: "ABCD",
    existingQueues: [{ PortName: "USB001" }],
  },
};

const kitchenPrinter: DiscoveredPrinter = {
  manufacturer: null,
  model: null,
  mac: "A8:01:57:30:27:A4",
  ip: "10.20.30.80",
  port: 9100,
  transport: "NETWORK",
  capabilities: ["ETHERNET", "RAW_9100"],
  rawData: null,
  metadata: { subnetMask: "255.255.255.0", gateway: "10.20.30.1", dhcpEnabled: false },
};

function fixtureService(logPath: string): { service: ReviewService; logger: JsonLineReviewLogger } {
  const logger = new JsonLineReviewLogger(logPath);
  return {
    logger,
    service: new ReviewService({
      networkProvider: { async detect() { return network; } },
      usbDiscovery: { async discover() { return [frontPrinter]; } },
      networkDiscovery: { async discover() { return [kitchenPrinter]; } },
      probe: async (ip) => ({ ip, port: 9100, status: "SUCCESS", latencyMs: 3, errorCode: null, sentBytes: 0 }),
      logger,
    }),
  };
}

test("P0.5 manifest and local API expose no write operation", () => {
  const manifest = productManifest();
  assert.equal(manifest.productName, "E-Shop Printer Tools");
  assert.equal(manifest.version, "P0.5");
  assert.equal(manifest.safeMode, true);
  assert.equal(manifest.writeOperationsEnabled, false);
  assert.equal(manifest.fieldVerification, "NOT_FIELD_VERIFIED");
  assert.equal(REVIEW_API_ROUTES.some((route) => /save|apply|execute|install|print|queue/i.test(route)), false);
});

test("WinForms launcher shows required review metadata and contains no printer/Windows mutation command", () => {
  const sourceBytes = readFileSync(new URL("../src/app/winformsLauncher.ps1", import.meta.url));
  assert.deepEqual([...sourceBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const script = sourceBytes.toString("utf8");
  assert.equal(script.codePointAt(0), 0xfeff);
  const emittedTempFileBytes = Buffer.from(script, "utf8");
  assert.deepEqual([...emittedTempFileBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  for (const label of [
    "E-Shop Printer Tools",
    "安全审核模式",
    "Build Commit",
    "Current Windows Network",
    "检测 USB 打印机",
    "扫描网络打印机",
    "TCP 9100",
    "仅预览",
  ]) {
    assert.match(script, new RegExp(label));
  }
  assert.doesNotMatch(script, /Add-Printer|Set-Printer|Remove-Printer|MP4200SAVE|pnputil|reg\.exe|netsh/i);
});

test("authenticated local API dispatcher supports read, discovery, probe, and preview only", async () => {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "eshop-p05-test-"));
  try {
    const { service, logger } = fixtureService(path.join(tempDirectory, "review.log"));
    assert.equal(isLocalSessionAuthorized("fixture-session-token", undefined), false);
    assert.equal(isLocalSessionAuthorized("fixture-session-token", "wrong-token"), false);
    assert.equal(isLocalSessionAuthorized("fixture-session-token", "fixture-session-token"), true);

    const call = async (route: string, body: Record<string, unknown> = {}) => {
      const result = await dispatchReviewRoute(route, service, body);
      assert.equal(result.statusCode, 200);
      return result.payload as Record<string, any>;
    };
    const status = await call("GET /api/status");
    assert.equal(status.app.safeMode, true);
    await call("POST /api/network/detect");
    await call("POST /api/front/discover");
    await call("POST /api/kitchen/discover");
    const frontPreview = await call("POST /api/front/preview", { index: 0 });
    const kitchenPreview = await call("POST /api/kitchen/preview", { index: 0 });
    const probe = await call("POST /api/kitchen/probe", { index: 0 });
    assert.equal(frontPreview.mode, "PREVIEW_ONLY");
    assert.equal(frontPreview.writeOperationsEnabled, false);
    assert.equal(frontPreview.queuePreview.queueName, "前台");
    assert.equal(kitchenPreview.mode, "PREVIEW_ONLY");
    assert.equal(kitchenPreview.queuePreview.queueName, "厨房");
    assert.equal(probe.sentBytes, 0);
    assert.equal((await dispatchReviewRoute("POST /api/execute", service)).statusCode, 404);

    const log = readFileSync(path.join(tempDirectory, "review.log"), "utf8");
    assert.match(log, /network_detection/);
    assert.match(log, /usb_discovery/);
    assert.match(log, /lan_discovery/);
    assert.match(log, /tcp_9100_probe/);
    assert.match(log, /provisioning_preview/);
    assert.doesNotMatch(log, /fixture-session-token/);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
