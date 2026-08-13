import { parseIpv4, subnetMaskToPrefixLength } from "../network/ipv4.js";
import { normalizeMac } from "../rongta/networkDiscovery.js";
import type { DiscoveredPrinter, DiscoveryTarget } from "../types.js";
import type { UdpDiscoveryDatagram, UdpDiscoveryTransport } from "../rongta/udpTransport.js";

export const MP4200_DISCOVERY_SOURCE_PORT = 4040;
export const MP4200_DISCOVERY_DESTINATION_PORT = 1460;
export const MP4200_DISCOVERY_BROADCAST_ADDRESS = "255.255.255.255";

const FIND_HEADER = Uint8Array.from(new TextEncoder().encode("MP4200FIND"));
const FOUND_HEADER = Uint8Array.from(new TextEncoder().encode("MP4200FOUND"));
const SAVE_HEADER = Uint8Array.from(new TextEncoder().encode("MP4200SAVE"));
const NETWORK_DATA_LENGTH = 15;

export const MP4200_FIND_PACKET = Uint8Array.from(FIND_HEADER);

function bytesToHex(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function findSequence(data: Uint8Array, needle: Uint8Array): number {
  outer: for (let offset = 0; offset <= data.byteLength - needle.byteLength; offset += 1) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (data[offset + index] !== needle[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

function ipv4FromBytes(data: Uint8Array, offset: number): string {
  return Array.from(data.slice(offset, offset + 4)).join(".");
}

function macFromBytes(data: Uint8Array, offset: number): string {
  return Array.from(data.slice(offset, offset + 6), (byte) => byte.toString(16).padStart(2, "0"))
    .join(":")
    .toUpperCase();
}

function writeIpv4(target: Uint8Array, offset: number, value: string): void {
  target.set(parseIpv4(value), offset);
}

function parseMacBytes(value: string): Uint8Array {
  const normalized = normalizeMac(value);
  if (!normalized) throw new Error(`INVALID_MAC: ${value}`);
  return Uint8Array.from(normalized.split(":"), (octet) => Number.parseInt(octet, 16));
}

export interface Mp4200FoundPacket {
  mac: string;
  ip: string;
  subnetMask: string;
  gateway: string;
  port: number;
  dhcpEnabled: boolean;
  headerOffset: number;
  dataLength: 15;
  rawHex: string;
}

/**
 * Parses the binary MP4200FOUND layout recovered from IPSettingTool.exe.
 * It intentionally does not invent model, manufacturer, or firmware fields.
 */
export function parseMp4200FoundPacket(data: Uint8Array): Mp4200FoundPacket | null {
  const headerOffset = findSequence(data, FOUND_HEADER);
  if (headerOffset < 0) return null;
  if (data.byteLength - headerOffset < 34) throw new Error("MALFORMED_MP4200FOUND: packet shorter than 34 bytes");

  const macOffset = headerOffset + FOUND_HEADER.byteLength;
  const lengthOffset = macOffset + 6;
  const dataLength = data[lengthOffset] | (data[lengthOffset + 1] << 8);
  if (dataLength !== NETWORK_DATA_LENGTH) {
    throw new Error(`MALFORMED_MP4200FOUND: unexpected data length ${dataLength}`);
  }
  if (data.byteLength - (lengthOffset + 2) < dataLength) {
    throw new Error("MALFORMED_MP4200FOUND: truncated network data");
  }

  const ipOffset = lengthOffset + 2;
  const ip = ipv4FromBytes(data, ipOffset);
  const subnetMask = ipv4FromBytes(data, ipOffset + 4);
  const gateway = ipv4FromBytes(data, ipOffset + 8);
  parseIpv4(ip);
  subnetMaskToPrefixLength(subnetMask);
  parseIpv4(gateway);

  // The original tool reads FOUND port bytes in little-endian order.
  const port = data[ipOffset + 12] | (data[ipOffset + 13] << 8);
  if (port < 1 || port > 65_535) throw new Error(`MALFORMED_MP4200FOUND: invalid port ${port}`);
  const dhcpFlag = data[ipOffset + 14];
  if (dhcpFlag !== 0 && dhcpFlag !== 1) {
    throw new Error(`MALFORMED_MP4200FOUND: invalid DHCP flag ${dhcpFlag}`);
  }

  return {
    mac: macFromBytes(data, macOffset),
    ip,
    subnetMask,
    gateway,
    port,
    dhcpEnabled: dhcpFlag === 1,
    headerOffset,
    dataLength: NETWORK_DATA_LENGTH,
    rawHex: bytesToHex(data),
  };
}

export interface BuildMp4200SavePacketInput {
  mac: string;
  confirmedMac: string;
  ip: string;
  subnetMask: string;
  gateway: string;
  port: number;
  dhcpEnabled: boolean;
}

/** Builds but never transmits the statically recovered MP4200SAVE payload. */
export function buildMp4200SavePacket(input: BuildMp4200SavePacketInput): Uint8Array {
  const mac = normalizeMac(input.mac);
  const confirmedMac = normalizeMac(input.confirmedMac);
  if (!mac || !confirmedMac) throw new Error("VALID_MAC_REQUIRED");
  if (mac !== confirmedMac) throw new Error("EXPLICIT_DEVICE_CONFIRMATION_REQUIRED");
  parseIpv4(input.ip);
  subnetMaskToPrefixLength(input.subnetMask);
  parseIpv4(input.gateway);
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new Error("INVALID_PRINTER_PORT");
  }

  const packet = new Uint8Array(33);
  packet.set(SAVE_HEADER, 0);
  packet.set(parseMacBytes(mac), SAVE_HEADER.byteLength);
  const lengthOffset = SAVE_HEADER.byteLength + 6;
  packet[lengthOffset] = NETWORK_DATA_LENGTH;
  packet[lengthOffset + 1] = 0;
  const ipOffset = lengthOffset + 2;
  writeIpv4(packet, ipOffset, input.ip);
  writeIpv4(packet, ipOffset + 4, input.subnetMask);
  writeIpv4(packet, ipOffset + 8, input.gateway);
  // The original tool writes SAVE port bytes in network/big-endian order.
  packet[ipOffset + 12] = (input.port >>> 8) & 0xff;
  packet[ipOffset + 13] = input.port & 0xff;
  packet[ipOffset + 14] = input.dhcpEnabled ? 1 : 0;
  return packet;
}

export function createIpSettingDiscoveryTarget(
  localAddress = "0.0.0.0",
  interfaceName = "WINDOWS_DEFAULT_ROUTE",
): DiscoveryTarget {
  return {
    interface: interfaceName,
    localAddress,
    broadcastAddress: MP4200_DISCOVERY_BROADCAST_ADDRESS,
    sourcePort: MP4200_DISCOVERY_SOURCE_PORT,
    destinationPort: MP4200_DISCOVERY_DESTINATION_PORT,
  };
}

function toDiscoveredPrinter(packet: Mp4200FoundPacket, datagram: UdpDiscoveryDatagram): DiscoveredPrinter {
  return {
    manufacturer: null,
    model: null,
    mac: packet.mac,
    ip: packet.ip,
    port: packet.port,
    transport: "NETWORK",
    capabilities: ["ETHERNET", ...(packet.port === 9100 ? ["RAW_9100" as const] : []), "DHCP"],
    rawData: null,
    metadata: {
      protocol: "MP4200",
      response: "MP4200FOUND",
      subnetMask: packet.subnetMask,
      gateway: packet.gateway,
      dhcpEnabled: packet.dhcpEnabled,
      dataLength: packet.dataLength,
      headerOffset: packet.headerOffset,
      rawHex: packet.rawHex,
      remoteAddress: datagram.remoteAddress,
      remotePort: datagram.remotePort,
      receivedOnInterface: datagram.receivedOnInterface,
      fieldVerification: "NOT_FIELD_VERIFIED",
    },
  };
}

export interface IpSettingDiscoveryOptions {
  target?: DiscoveryTarget;
  timeoutMs?: number;
}

export class IpSettingNetworkDiscoveryAdapter {
  constructor(private readonly transport: UdpDiscoveryTransport) {}

  async discover(options: IpSettingDiscoveryOptions = {}): Promise<DiscoveredPrinter[]> {
    const datagrams = await this.transport.search({
      requestPayload: MP4200_FIND_PACKET,
      targets: [options.target ?? createIpSettingDiscoveryTarget()],
      timeoutMs: options.timeoutMs ?? 1_500,
    });
    const byMac = new Map<string, DiscoveredPrinter>();
    for (const datagram of datagrams) {
      const packet = parseMp4200FoundPacket(datagram.data);
      if (!packet) continue;
      const printer = toDiscoveredPrinter(packet, datagram);
      const existing = byMac.get(packet.mac);
      if (!existing) {
        byMac.set(packet.mac, printer);
      } else {
        byMac.set(packet.mac, {
          ...existing,
          metadata: {
            ...existing.metadata,
            duplicateCount: Number(existing.metadata.duplicateCount ?? 1) + 1,
          },
        });
      }
    }
    return [...byMac.values()];
  }
}
