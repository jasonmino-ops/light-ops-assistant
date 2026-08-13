import { isSameSubnet, parseIpv4 } from "../network/ipv4.js";
import type { DiscoveredPrinter, DiscoveryTarget } from "../types.js";
import type { UdpDiscoveryDatagram, UdpDiscoveryTransport } from "./udpTransport.js";

const MAC_PATTERN = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

const FIELD_ALIASES: Record<string, "manufacturer" | "model" | "mac" | "ip" | "port"> = {
  manufacturer: "manufacturer",
  maker: "manufacturer",
  brand: "manufacturer",
  model: "model",
  modelname: "model",
  devicemodel: "model",
  mac: "mac",
  macaddress: "mac",
  ip: "ip",
  ipaddress: "ip",
  port: "port",
  rawport: "port",
};

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, "");
}

export function normalizeMac(value: string): string | null {
  const compact = value.replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(compact)) return null;
  return compact.match(/.{2}/g)?.join(":") ?? null;
}

function validIpv4OrNull(value: string | undefined): string | null {
  if (!value) return null;
  try {
    parseIpv4(value);
    return value;
  } catch {
    return null;
  }
}

function validPortOrNull(value: string | undefined): number | null {
  if (!value || !/^\d{1,5}$/.test(value)) return null;
  const port = Number(value);
  return port >= 1 && port <= 65_535 ? port : null;
}

function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(data).replace(/\0+$/g, "").trim();
}

function toHex(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseRongtaUdpDatagram(datagram: UdpDiscoveryDatagram): DiscoveredPrinter | null {
  const text = decodeUtf8(datagram.data);
  const values: Partial<Record<"manufacturer" | "model" | "mac" | "ip" | "port", string>> = {};

  for (const segment of text.split(/[\r\n;,\t]+/)) {
    const match = segment.match(/^\s*([^:=]+)\s*[:=]\s*(.*?)\s*$/);
    if (!match) continue;
    const field = FIELD_ALIASES[normalizeKey(match[1])];
    if (field && match[2]) values[field] = match[2];
  }

  const mac = normalizeMac(values.mac ?? text.match(MAC_PATTERN)?.[0] ?? "");
  const ip = validIpv4OrNull(values.ip ?? text.match(IPV4_PATTERN)?.[0]);
  const model = values.model?.trim() || null;
  const manufacturer = values.manufacturer?.trim() || null;
  const port = validPortOrNull(values.port);

  if (!mac && !ip && !model && !manufacturer) return null;

  return {
    manufacturer,
    model,
    mac,
    ip,
    port,
    transport: "NETWORK",
    capabilities: ["ETHERNET", ...(port === 9100 ? ["RAW_9100" as const] : [])],
    rawData: text.length > 0 ? text : null,
    metadata: {
      rawHex: toHex(datagram.data),
      remoteAddress: datagram.remoteAddress,
      remotePort: datagram.remotePort,
      receivedOnInterface: datagram.receivedOnInterface,
      parser: "KEY_VALUE_HEURISTIC",
      fieldVerification: "NOT_FIELD_VERIFIED",
    },
  };
}

function discoveryIdentity(printer: DiscoveredPrinter): string {
  if (printer.mac) return `mac:${printer.mac}`;
  if (printer.ip) return `ip:${printer.ip}`;
  return `raw:${String(printer.metadata.rawHex)}`;
}

export function deduplicateDiscoveredPrinters(printers: DiscoveredPrinter[]): DiscoveredPrinter[] {
  const byIdentity = new Map<string, DiscoveredPrinter>();
  for (const printer of printers) {
    const identity = discoveryIdentity(printer);
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, printer);
      continue;
    }

    byIdentity.set(identity, {
      ...existing,
      manufacturer: existing.manufacturer ?? printer.manufacturer,
      model: existing.model ?? printer.model,
      ip: existing.ip ?? printer.ip,
      port: existing.port ?? printer.port,
      metadata: {
        ...existing.metadata,
        duplicateCount: Number(existing.metadata.duplicateCount ?? 1) + 1,
      },
    });
  }
  return [...byIdentity.values()];
}

export interface RongtaNetworkDiscoveryOptions {
  requestPayload: Uint8Array;
  targets: DiscoveryTarget[];
  timeoutMs?: number;
}

export class RongtaNetworkDiscoveryAdapter {
  constructor(private readonly transport: UdpDiscoveryTransport) {}

  async discover(options: RongtaNetworkDiscoveryOptions): Promise<DiscoveredPrinter[]> {
    const datagrams = await this.transport.search({
      requestPayload: options.requestPayload,
      targets: options.targets,
      timeoutMs: options.timeoutMs ?? 1_500,
    });
    const parsed = datagrams
      .map(parseRongtaUdpDatagram)
      .filter((printer): printer is DiscoveredPrinter => printer !== null);
    return deduplicateDiscoveredPrinters(parsed);
  }
}

export function filterPrintersForInterface(
  printers: DiscoveredPrinter[],
  localIpv4: string,
  subnetMask: string,
): DiscoveredPrinter[] {
  return printers.filter((printer) => printer.ip && isSameSubnet(localIpv4, printer.ip, subnetMask));
}
