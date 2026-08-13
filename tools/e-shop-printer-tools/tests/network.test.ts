import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSubnet,
  parseIpv4,
  parseWindowsNetworkJson,
  prefixLengthToSubnetMask,
  subnetMaskToPrefixLength,
} from "../src/index.js";

test("parses IPv4 and calculates a subnet without store-specific addresses", () => {
  assert.deepEqual(parseIpv4("10.42.7.19"), [10, 42, 7, 19]);
  assert.equal(prefixLengthToSubnetMask(24), "255.255.255.0");
  assert.equal(subnetMaskToPrefixLength("255.255.252.0"), 22);
  assert.deepEqual(calculateSubnet("10.42.7.19", "255.255.252.0"), {
    networkAddress: "10.42.4.0",
    broadcastAddress: "10.42.7.255",
    firstUsableAddress: "10.42.4.1",
    lastUsableAddress: "10.42.7.254",
  });
});

test("rejects invalid IPv4 and non-contiguous subnet masks", () => {
  assert.throws(() => parseIpv4("10.0.0.999"), /INVALID_IPV4/);
  assert.throws(() => subnetMaskToPrefixLength("255.0.255.0"), /INVALID_SUBNET_MASK/);
});

test("parses gateway and selects the connected interface with a default route", () => {
  const snapshot = parseWindowsNetworkJson(JSON.stringify([
    {
      InterfaceAlias: "Ethernet",
      InterfaceIndex: 4,
      NetAdapterStatus: "Up",
      IPv4Address: "10.20.30.10",
      PrefixLength: 24,
      IPv4DefaultGateway: "10.20.30.1",
    },
  ]));

  assert.equal(snapshot.preferredInterface?.interface, "Ethernet");
  assert.equal(snapshot.preferredInterface?.gateway, "10.20.30.1");
  assert.equal(snapshot.preferredInterface?.subnetMask, "255.255.255.0");
});

test("handles multiple NICs and ignores disconnected adapters", () => {
  const snapshot = parseWindowsNetworkJson(JSON.stringify([
    {
      InterfaceAlias: "Disconnected",
      InterfaceIndex: 1,
      NetAdapterStatus: "Disconnected",
      IPv4Address: "172.16.0.10",
      PrefixLength: 16,
    },
    {
      InterfaceAlias: "Wi-Fi",
      InterfaceIndex: 8,
      NetAdapterStatus: "Up",
      IPv4Address: "10.8.0.15",
      PrefixLength: 24,
    },
    {
      InterfaceAlias: "Ethernet",
      InterfaceIndex: 4,
      NetAdapterStatus: "Up",
      IPv4Address: "10.20.30.10",
      PrefixLength: 24,
      IPv4DefaultGateway: "10.20.30.1",
    },
  ]));

  assert.deepEqual(snapshot.interfaces.map((item) => item.interface), ["Wi-Fi", "Ethernet"]);
  assert.equal(snapshot.preferredInterface?.interface, "Ethernet");
});

test("rejects malformed Windows network JSON", () => {
  assert.throws(() => parseWindowsNetworkJson("not-json"), /INVALID_WINDOWS_NETWORK_JSON/);
});
