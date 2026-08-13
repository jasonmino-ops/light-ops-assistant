import { IpSettingNetworkDiscoveryAdapter } from "../rp331a/ipSettingProtocol.js";
import { NodeUdpDiscoveryTransport } from "../rongta/udpTransport.js";
import { WindowsNetworkDetectionProvider } from "../network/windowsNetworkProvider.js";
import { WindowsUsbPrinterDiscoveryAdapter } from "../windows/usbDiscovery.js";
import { buildProvisioningPlan, printerFingerprint } from "../provisioning/buildProvisioningPlan.js";
import { probeRaw9100, type Raw9100ProbeResult } from "../verification/probeRaw9100.js";
import type { DiscoveredPrinter, NetworkDetectionProvider, WindowsNetworkSnapshot } from "../types.js";
import { productManifest, SAFE_MODE, WRITE_OPERATIONS_ENABLED } from "./product.js";
import type { ReviewLogger } from "./logger.js";

export interface UsbDiscoveryReader {
  discover(): Promise<DiscoveredPrinter[]>;
}

export interface NetworkDiscoveryReader {
  discover(): Promise<DiscoveredPrinter[]>;
}

export interface ReviewServiceDependencies {
  networkProvider: NetworkDetectionProvider;
  usbDiscovery: UsbDiscoveryReader;
  networkDiscovery: NetworkDiscoveryReader;
  probe: (ip: string) => Promise<Raw9100ProbeResult>;
  logger: ReviewLogger;
}

export interface ReviewState {
  network: WindowsNetworkSnapshot | null;
  frontPrinters: DiscoveredPrinter[];
  kitchenPrinters: DiscoveredPrinter[];
}

function fixtureEmptyNetwork(): WindowsNetworkSnapshot {
  return {
    interfaces: [],
    preferredInterface: null,
    capturedAt: new Date().toISOString(),
    source: "FIXTURE",
  };
}

function existingUsbPort(printer: DiscoveredPrinter): string | null {
  const queues = printer.metadata.existingQueues;
  if (!Array.isArray(queues)) return null;
  for (const queue of queues) {
    if (queue && typeof queue === "object") {
      const portName = (queue as Record<string, unknown>).PortName;
      if (typeof portName === "string" && portName.length > 0) return portName;
    }
  }
  return null;
}

export class ReviewService {
  readonly state: ReviewState = { network: null, frontPrinters: [], kitchenPrinters: [] };

  constructor(private readonly dependencies: ReviewServiceDependencies) {}

  status() {
    return {
      app: productManifest(),
      state: this.state,
      logPath: this.dependencies.logger.logPath,
    };
  }

  async detectNetwork(): Promise<WindowsNetworkSnapshot> {
    try {
      this.state.network = await this.dependencies.networkProvider.detect();
      this.dependencies.logger.info("network_detection", {
        interfaceCount: this.state.network.interfaces.length,
        preferredInterface: this.state.network.preferredInterface?.interface ?? null,
        ipv4: this.state.network.preferredInterface?.ipv4 ?? null,
      });
      return this.state.network;
    } catch (error) {
      this.dependencies.logger.error("network_detection_error", error);
      throw error;
    }
  }

  async discoverFront(): Promise<DiscoveredPrinter[]> {
    try {
      this.state.frontPrinters = await this.dependencies.usbDiscovery.discover();
      this.dependencies.logger.info("usb_discovery", {
        count: this.state.frontPrinters.length,
        devices: this.state.frontPrinters.map((printer) => ({
          manufacturer: printer.manufacturer,
          model: printer.model,
          vendorId: printer.metadata.vendorId ?? null,
          productId: printer.metadata.productId ?? null,
          pnpDeviceId: printer.metadata.pnpDeviceId ?? null,
        })),
      });
      return this.state.frontPrinters;
    } catch (error) {
      this.dependencies.logger.error("usb_discovery_error", error);
      throw error;
    }
  }

  async discoverKitchen(): Promise<DiscoveredPrinter[]> {
    try {
      this.state.kitchenPrinters = await this.dependencies.networkDiscovery.discover();
      this.dependencies.logger.info("lan_discovery", {
        count: this.state.kitchenPrinters.length,
        devices: this.state.kitchenPrinters.map((printer) => ({ mac: printer.mac, ip: printer.ip })),
      });
      return this.state.kitchenPrinters;
    } catch (error) {
      this.dependencies.logger.error("lan_discovery_error", error);
      throw error;
    }
  }

  async redetect() {
    const network = await this.detectNetwork();
    const frontPrinters = await this.discoverFront();
    const kitchenPrinters = await this.discoverKitchen();
    return { network, frontPrinters, kitchenPrinters };
  }

  async previewFront(index: number) {
    const printer = this.state.frontPrinters[index];
    if (!printer) throw new Error("FRONT_PRINTER_SELECTION_REQUIRED");
    const fingerprint = printerFingerprint(printer);
    const plan = await buildProvisioningPlan({
      currentWindowsNetwork: this.state.network ?? fixtureEmptyNetwork(),
      selectedPrinter: printer,
      role: "FRONT",
      confirmedPrinterFingerprint: fingerprint,
    });
    const preview = {
      mode: "PREVIEW_ONLY",
      safeMode: SAFE_MODE,
      writeOperationsEnabled: WRITE_OPERATIONS_ENABLED,
      plan,
      queuePreview: {
        queueName: "前台",
        transport: "USB",
        usbPortName: existingUsbPort(printer),
        driverAction: "DETECT_OR_REUSE_ONLY",
      },
      enforcedBlocker: "SAFE_MODE_REVIEW_BUILD",
    };
    this.dependencies.logger.info("front_provisioning_preview", {
      fingerprint,
      queueName: "前台",
      safeMode: SAFE_MODE,
    });
    return preview;
  }

  async previewKitchen(index: number) {
    const printer = this.state.kitchenPrinters[index];
    if (!printer) throw new Error("KITCHEN_PRINTER_SELECTION_REQUIRED");
    if (!this.state.network) await this.detectNetwork();
    const fingerprint = printerFingerprint(printer);
    const plan = await buildProvisioningPlan({
      currentWindowsNetwork: this.state.network!,
      selectedPrinter: printer,
      role: "KITCHEN",
      confirmedPrinterFingerprint: fingerprint,
    });
    const preview = {
      mode: "PREVIEW_ONLY",
      safeMode: SAFE_MODE,
      writeOperationsEnabled: WRITE_OPERATIONS_ENABLED,
      currentNetwork: this.state.network!.preferredInterface,
      plan,
      queuePreview: {
        queueName: "厨房",
        transport: "STANDARD_TCP_IP",
        protocol: "RAW",
        rawPort: 9100,
        targetIp: plan.candidateIp,
      },
      enforcedBlocker: "SAFE_MODE_REVIEW_BUILD",
    };
    this.dependencies.logger.info("kitchen_provisioning_preview", {
      fingerprint,
      currentIp: printer.ip,
      candidateIp: plan.candidateIp,
      queueName: "厨房",
      safeMode: SAFE_MODE,
    });
    return preview;
  }

  async probeKitchen(index: number): Promise<Raw9100ProbeResult> {
    const printer = this.state.kitchenPrinters[index];
    if (!printer?.ip) throw new Error("DISCOVERED_KITCHEN_IP_REQUIRED");
    try {
      const result = await this.dependencies.probe(printer.ip);
      this.dependencies.logger.info("tcp_9100_probe", {
        ip: result.ip,
        status: result.status,
        latencyMs: result.latencyMs,
        sentBytes: result.sentBytes,
      });
      return result;
    } catch (error) {
      this.dependencies.logger.error("tcp_9100_probe_error", error, { ip: printer.ip });
      throw error;
    }
  }
}

export function createDefaultReviewService(logger: ReviewLogger): ReviewService {
  return new ReviewService({
    networkProvider: new WindowsNetworkDetectionProvider(),
    usbDiscovery: new WindowsUsbPrinterDiscoveryAdapter(),
    networkDiscovery: new IpSettingNetworkDiscoveryAdapter(new NodeUdpDiscoveryTransport()),
    probe: (ip) => probeRaw9100(ip),
    logger,
  });
}
