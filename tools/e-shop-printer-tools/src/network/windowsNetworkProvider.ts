import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { calculateSubnet, prefixLengthToSubnetMask } from "./ipv4.js";
import type { NetworkDetectionProvider, NetworkInterfaceInfo, WindowsNetworkSnapshot } from "../types.js";

const execFileAsync = promisify(execFile);

export const WINDOWS_NETWORK_QUERY = `
$ErrorActionPreference = 'Stop'
Get-NetIPConfiguration -All |
  ForEach-Object {
    $config = $_
    @($config.IPv4Address) | ForEach-Object {
      [pscustomobject]@{
        InterfaceAlias = $config.InterfaceAlias
        InterfaceIndex = $config.InterfaceIndex
        NetAdapterStatus = $config.NetAdapter.Status
        IPv4Address = $_.IPAddress
        PrefixLength = $_.PrefixLength
        IPv4DefaultGateway = $config.IPv4DefaultGateway.NextHop
      }
    }
  } |
  ConvertTo-Json -Depth 4 -Compress
`.trim();

interface RawWindowsNetworkRecord {
  InterfaceAlias?: unknown;
  InterfaceIndex?: unknown;
  NetAdapterStatus?: unknown;
  IPv4Address?: unknown;
  PrefixLength?: unknown;
  IPv4DefaultGateway?: unknown;
}

export interface WindowsCommandRunner {
  runPowerShell(script: string): Promise<string>;
}

export class ChildProcessWindowsCommandRunner implements WindowsCommandRunner {
  async runPowerShell(script: string): Promise<string> {
    if (process.platform !== "win32") {
      throw new Error("WINDOWS_PROVIDER_UNAVAILABLE: NOT FIELD VERIFIED on this platform");
    }

    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ], { windowsHide: true, maxBuffer: 1024 * 1024 });
    return stdout;
  }
}

function parseRecord(record: RawWindowsNetworkRecord): NetworkInterfaceInfo | null {
  if (record.NetAdapterStatus !== "Up") return null;
  if (typeof record.InterfaceAlias !== "string" || typeof record.IPv4Address !== "string") return null;

  const prefixLength = Number(record.PrefixLength);
  const subnetMask = prefixLengthToSubnetMask(prefixLength);
  const subnet = calculateSubnet(record.IPv4Address, subnetMask);
  const gateway = typeof record.IPv4DefaultGateway === "string" && record.IPv4DefaultGateway.length > 0
    ? record.IPv4DefaultGateway
    : null;

  return {
    interface: record.InterfaceAlias,
    interfaceIndex: Number.isInteger(Number(record.InterfaceIndex)) ? Number(record.InterfaceIndex) : null,
    ipv4: record.IPv4Address,
    subnetMask,
    prefixLength,
    gateway,
    networkAddress: subnet.networkAddress,
    broadcastAddress: subnet.broadcastAddress,
  };
}

export function parseWindowsNetworkJson(
  json: string,
  source: WindowsNetworkSnapshot["source"] = "FIXTURE",
): WindowsNetworkSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`INVALID_WINDOWS_NETWORK_JSON: ${(error as Error).message}`);
  }

  const records = (Array.isArray(parsed) ? parsed : [parsed]) as RawWindowsNetworkRecord[];
  const interfaces = records.map(parseRecord).filter((value): value is NetworkInterfaceInfo => value !== null);
  const preferredInterface = interfaces.find((item) => item.gateway !== null) ?? interfaces[0] ?? null;

  return {
    interfaces,
    preferredInterface,
    capturedAt: new Date().toISOString(),
    source,
  };
}

export class WindowsNetworkDetectionProvider implements NetworkDetectionProvider {
  constructor(private readonly runner: WindowsCommandRunner = new ChildProcessWindowsCommandRunner()) {}

  async detect(): Promise<WindowsNetworkSnapshot> {
    const stdout = await this.runner.runPowerShell(WINDOWS_NETWORK_QUERY);
    return parseWindowsNetworkJson(stdout, "WINDOWS_POWERSHELL");
  }
}
