import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRongtaUdpDatagram,
  parseRongtaUsbNativeResult,
  RongtaNetworkDiscoveryAdapter,
  RongtaUsbDiscoveryAdapter,
  type RongtaUsbNativeBridge,
  type UdpDiscoveryDatagram,
  type UdpDiscoveryRequest,
  type UdpDiscoveryTransport,
} from "../src/index.js";

function datagram(text: string, remoteAddress = "10.20.30.40"): UdpDiscoveryDatagram {
  return {
    data: new TextEncoder().encode(text),
    remoteAddress,
    remotePort: 32100,
    receivedOnInterface: "Ethernet",
  };
}

class FixtureUdpTransport implements UdpDiscoveryTransport {
  constructor(private readonly datagrams: UdpDiscoveryDatagram[]) {}
  async search(_request: UdpDiscoveryRequest): Promise<UdpDiscoveryDatagram[]> {
    return this.datagrams;
  }
}

test("USB discovery handles empty and one-printer native results", async () => {
  const emptyBridge: RongtaUsbNativeBridge = {
    integrationStatus: "NOT_FIELD_VERIFIED",
    async listUsbPrinters() { return []; },
  };
  assert.deepEqual(await new RongtaUsbDiscoveryAdapter(emptyBridge).discover(), []);

  const printer = parseRongtaUsbNativeResult(JSON.stringify({ printers: [{
    manufacturer: "Rongta",
    model: "RP80",
    serialNumber: "SYNTHETIC-001",
    devicePath: "synthetic-usb-path",
    usbPortName: "USB001",
  }] }));
  assert.equal(printer.length, 1);
  assert.equal(printer[0].transport, "USB");
  assert.equal(printer[0].metadata.usbPortName, "USB001");
  assert.equal(printer[0].metadata.fieldVerification, "NOT_FIELD_VERIFIED");
});

test("USB discovery rejects malformed native responses instead of guessing", () => {
  assert.throws(() => parseRongtaUsbNativeResult("printer-looking-text"), /MALFORMED_RONGTA_USB_RESPONSE/);
});

test("network response parser extracts labeled fields and preserves raw metadata", () => {
  const printer = parseRongtaUdpDatagram(datagram(
    "Manufacturer=Rongta;Model=RP80;MAC=00-11-22-33-44-55;IP=10.20.30.40;Port=9100",
  ));
  assert.deepEqual(printer && {
    manufacturer: printer.manufacturer,
    model: printer.model,
    mac: printer.mac,
    ip: printer.ip,
    port: printer.port,
    transport: printer.transport,
  }, {
    manufacturer: "Rongta",
    model: "RP80",
    mac: "00:11:22:33:44:55",
    ip: "10.20.30.40",
    port: 9100,
    transport: "NETWORK",
  });
  assert.equal(printer?.metadata.parser, "KEY_VALUE_HEURISTIC");
});

test("network discovery handles empty, malformed, multiple, and duplicate MAC results", async () => {
  const empty = new RongtaNetworkDiscoveryAdapter(new FixtureUdpTransport([]));
  assert.deepEqual(await empty.discover({ requestPayload: Uint8Array.of(1), targets: [] }), []);

  const adapter = new RongtaNetworkDiscoveryAdapter(new FixtureUdpTransport([
    datagram("malformed payload without device identity"),
    datagram("Model=RP80;MAC=00:11:22:33:44:55;IP=10.20.30.40"),
    datagram("MAC=00-11-22-33-44-55;Port=9100"),
    datagram("Model=RP80B;MAC=00:11:22:33:44:66;IP=10.20.30.41"),
  ]));
  const printers = await adapter.discover({ requestPayload: Uint8Array.of(1), targets: [] });

  assert.equal(printers.length, 2);
  assert.equal(printers[0].metadata.duplicateCount, 2);
  assert.equal(printers[0].port, 9100);
  assert.equal(printers[1].mac, "00:11:22:33:44:66");
});
