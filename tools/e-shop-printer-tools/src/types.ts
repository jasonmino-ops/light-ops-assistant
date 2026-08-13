export type PrinterRole = "FRONT" | "KITCHEN";

export type PrinterTransport = "USB" | "NETWORK";

export type PrinterCapability =
  | "USB"
  | "ETHERNET"
  | "WIFI"
  | "RAW_9100"
  | "DHCP"
  | "CUTTER"
  | "ESC_POS";

export interface DiscoveredPrinter {
  manufacturer: string | null;
  model: string | null;
  mac: string | null;
  ip: string | null;
  port: number | null;
  transport: PrinterTransport;
  capabilities: PrinterCapability[];
  rawData: string | null;
  metadata: Record<string, unknown>;
}

export interface NetworkInterfaceInfo {
  interface: string;
  interfaceIndex: number | null;
  ipv4: string;
  subnetMask: string;
  prefixLength: number;
  gateway: string | null;
  networkAddress: string;
  broadcastAddress: string;
}

export interface WindowsNetworkSnapshot {
  interfaces: NetworkInterfaceInfo[];
  preferredInterface: NetworkInterfaceInfo | null;
  capturedAt: string;
  source: "WINDOWS_POWERSHELL" | "FIXTURE";
}

export interface NetworkDetectionProvider {
  detect(): Promise<WindowsNetworkSnapshot>;
}

export interface DiscoveryTarget {
  interface: string;
  localAddress: string;
  broadcastAddress: string;
  sourcePort: number;
  destinationPort: number;
}
