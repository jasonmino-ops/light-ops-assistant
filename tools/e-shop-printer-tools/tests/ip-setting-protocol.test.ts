import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMp4200SavePacket,
  createIpSettingDiscoveryTarget,
  IpSettingNetworkDiscoveryAdapter,
  MP4200_DISCOVERY_DESTINATION_PORT,
  MP4200_DISCOVERY_SOURCE_PORT,
  MP4200_FIND_PACKET,
  parseMp4200FoundPacket,
  type UdpDiscoveryDatagram,
  type UdpDiscoveryRequest,
  type UdpDiscoveryTransport,
} from "../src/index.js";

function fromHex(hex: string): Uint8Array {
  assert.equal(hex.length % 2, 0);
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const FOUND_HEX = "4d5034323030464f554e44a801573027a40f000a141e28ffffff000a141e018c2300";
const SAVE_HEX = "4d503432303053415645a801573027a40f000a141e28ffffff000a141e01238c00";

class CapturingTransport implements UdpDiscoveryTransport {
  request: UdpDiscoveryRequest | null = null;
  constructor(private readonly datagrams: UdpDiscoveryDatagram[]) {}
  async search(request: UdpDiscoveryRequest): Promise<UdpDiscoveryDatagram[]> {
    this.request = request;
    return this.datagrams;
  }
}

test("MP4200FIND is the exact 10-byte static payload", () => {
  assert.equal(toHex(MP4200_FIND_PACKET), "4d503432303046494e44");
  assert.equal(new TextDecoder().decode(MP4200_FIND_PACKET), "MP4200FIND");
  assert.equal(MP4200_FIND_PACKET.byteLength, 10);
});

test("parses exact MP4200FOUND binary layout and little-endian port", () => {
  assert.deepEqual(parseMp4200FoundPacket(fromHex(FOUND_HEX)), {
    mac: "A8:01:57:30:27:A4",
    ip: "10.20.30.40",
    subnetMask: "255.255.255.0",
    gateway: "10.20.30.1",
    port: 9100,
    dhcpEnabled: false,
    headerOffset: 0,
    dataLength: 15,
    rawHex: FOUND_HEX,
  });
});

test("finds MP4200FOUND after a prefix just like the audited tool", () => {
  const prefixed = Uint8Array.from([0xaa, 0xbb, ...fromHex(FOUND_HEX)]);
  assert.equal(parseMp4200FoundPacket(prefixed)?.headerOffset, 2);
});

test("builds exact MP4200SAVE layout with big-endian port and confirmation gate", () => {
  const packet = buildMp4200SavePacket({
    mac: "A8-01-57-30-27-A4",
    confirmedMac: "A8:01:57:30:27:A4",
    ip: "10.20.30.40",
    subnetMask: "255.255.255.0",
    gateway: "10.20.30.1",
    port: 9100,
    dhcpEnabled: false,
  });
  assert.equal(packet.byteLength, 33);
  assert.equal(toHex(packet), SAVE_HEX);
  assert.throws(() => buildMp4200SavePacket({
    mac: "A8:01:57:30:27:A4",
    confirmedMac: "A8:01:57:30:27:A5",
    ip: "10.20.30.40",
    subnetMask: "255.255.255.0",
    gateway: "10.20.30.1",
    port: 9100,
    dhcpEnabled: false,
  }), /EXPLICIT_DEVICE_CONFIRMATION_REQUIRED/);
});

test("rejects malformed MP4200FOUND lengths, masks, and DHCP flags", () => {
  assert.throws(() => parseMp4200FoundPacket(fromHex(FOUND_HEX.slice(0, -2))), /shorter than 34 bytes/);
  const badLength = fromHex(FOUND_HEX);
  badLength[17] = 14;
  assert.throws(() => parseMp4200FoundPacket(badLength), /unexpected data length/);
  const badMask = fromHex(FOUND_HEX);
  badMask.set([255, 0, 255, 0], 23);
  assert.throws(() => parseMp4200FoundPacket(badMask), /INVALID_SUBNET_MASK/);
  const badDhcp = fromHex(FOUND_HEX);
  badDhcp[33] = 2;
  assert.throws(() => parseMp4200FoundPacket(badDhcp), /invalid DHCP flag/);
});

test("IPSetting discovery uses source 4040, broadcast destination 1460, and deduplicates by MAC", async () => {
  const datagram: UdpDiscoveryDatagram = {
    data: fromHex(FOUND_HEX),
    remoteAddress: "10.20.30.40",
    remotePort: 1460,
    receivedOnInterface: "Ethernet",
  };
  const transport = new CapturingTransport([datagram, datagram]);
  const printers = await new IpSettingNetworkDiscoveryAdapter(transport).discover({ timeoutMs: 900 });
  assert.equal(printers.length, 1);
  assert.equal(printers[0].mac, "A8:01:57:30:27:A4");
  assert.equal(printers[0].model, null);
  assert.equal(printers[0].metadata.duplicateCount, 2);
  assert.deepEqual(transport.request?.targets, [createIpSettingDiscoveryTarget()]);
  assert.equal(transport.request?.targets[0].sourcePort, MP4200_DISCOVERY_SOURCE_PORT);
  assert.equal(transport.request?.targets[0].destinationPort, MP4200_DISCOVERY_DESTINATION_PORT);
  assert.equal(toHex(transport.request!.requestPayload), toHex(MP4200_FIND_PACKET));
});
