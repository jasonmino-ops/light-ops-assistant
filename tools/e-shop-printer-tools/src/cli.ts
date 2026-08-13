#!/usr/bin/env node
import {
  IpSettingNetworkDiscoveryAdapter,
  NodeUdpDiscoveryTransport,
  WindowsNetworkDetectionProvider,
  WindowsPrinterDriverAdapter,
  WindowsUsbPrinterDiscoveryAdapter,
  parseMp4200FoundPacket,
  probeRaw9100,
} from "./index.js";

function usage(): string {
  return [
    "E-Shop Printer Tools P0 diagnostic CLI",
    "",
    "Commands:",
    "  inspect-network              Read Windows IPv4/subnet/gateway state",
    "  scan-usb                     Read Windows USB printer PnP state",
    "  scan-network [timeout-ms]    Send MP4200FIND; never writes printer settings",
    "  inspect-drivers              Read installed Windows printer drivers",
    "  probe-9100 <ipv4>            TCP connect-only probe; sends zero bytes",
    "  decode-found <hex>           Decode one captured MP4200FOUND datagram",
    "",
    "P0 safety: no command transmits MP4200SAVE or creates/modifies a queue.",
  ].join("\n");
}

function parseHex(value: string | undefined): Uint8Array {
  if (!value || !/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error("VALID_EVEN_LENGTH_HEX_REQUIRED");
  return Uint8Array.from(value.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(args: string[]): Promise<void> {
  const [command, argument] = args;
  switch (command) {
    case "inspect-network":
      print(await new WindowsNetworkDetectionProvider().detect());
      return;
    case "scan-usb":
      print(await new WindowsUsbPrinterDiscoveryAdapter().discover());
      return;
    case "scan-network": {
      const timeoutMs = argument === undefined ? 1_500 : Number(argument);
      print(await new IpSettingNetworkDiscoveryAdapter(new NodeUdpDiscoveryTransport()).discover({ timeoutMs }));
      return;
    }
    case "inspect-drivers":
      print(await new WindowsPrinterDriverAdapter().inspect());
      return;
    case "probe-9100":
      if (!argument) throw new Error("IPV4_REQUIRED");
      print(await probeRaw9100(argument));
      return;
    case "decode-found":
      print(parseMp4200FoundPacket(parseHex(argument)));
      return;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(`${usage()}\n`);
      return;
    default:
      throw new Error(`UNKNOWN_COMMAND: ${command}\n\n${usage()}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
