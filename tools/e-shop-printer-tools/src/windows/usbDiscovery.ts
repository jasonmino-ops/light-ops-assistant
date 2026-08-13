import type { DiscoveredPrinter } from "../types.js";
import { ChildProcessWindowsCommandRunner, type WindowsCommandRunner } from "../network/windowsNetworkProvider.js";

export const WINDOWS_USB_PRINTER_QUERY = `
$ErrorActionPreference = 'Stop'
$queues = @(Get-Printer -ErrorAction SilentlyContinue | Select-Object Name, DriverName, PortName)
$devices = @(Get-CimInstance Win32_PnPEntity -ErrorAction Stop |
  Where-Object { $_.PNPClass -eq 'Printer' -and ($_.PNPDeviceID -like 'USB*' -or $_.DeviceID -like 'USB*') } |
  ForEach-Object {
    $device = $_
    $matchingQueues = @($queues | Where-Object { $_.Name -eq $device.Name })
    [pscustomobject]@{
      Manufacturer = $device.Manufacturer
      Name = $device.Name
      DeviceID = $device.DeviceID
      PNPDeviceID = $device.PNPDeviceID
      HardwareID = @($device.HardwareID)
      Status = $device.Status
      ExistingQueues = $matchingQueues
    }
  })
$devices | ConvertTo-Json -Depth 6 -Compress
`.trim();

interface RawUsbPrinterRecord {
  Manufacturer?: unknown;
  Name?: unknown;
  DeviceID?: unknown;
  PNPDeviceID?: unknown;
  HardwareID?: unknown;
  Status?: unknown;
  ExistingQueues?: unknown;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function extractVidPid(values: string[]): { vendorId: string | null; productId: string | null } {
  for (const value of values) {
    const match = value.match(/VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})/i);
    if (match) return { vendorId: match[1].toUpperCase(), productId: match[2].toUpperCase() };
  }
  return { vendorId: null, productId: null };
}

export function parseWindowsUsbPrinterJson(json: string): DiscoveredPrinter[] {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch (error) {
    throw new Error(`INVALID_WINDOWS_USB_PRINTER_JSON: ${(error as Error).message}`);
  }
  if (payload == null) return [];
  const records = (Array.isArray(payload) ? payload : [payload]) as RawUsbPrinterRecord[];

  return records.map((record) => {
    const deviceId = optionalString(record.DeviceID);
    const pnpDeviceId = optionalString(record.PNPDeviceID);
    if (!deviceId && !pnpDeviceId) throw new Error("USB_PRINTER_DEVICE_ID_REQUIRED");
    const hardwareIds = strings(record.HardwareID);
    const { vendorId, productId } = extractVidPid([pnpDeviceId ?? "", deviceId ?? "", ...hardwareIds]);
    return {
      manufacturer: optionalString(record.Manufacturer),
      model: optionalString(record.Name),
      mac: null,
      ip: null,
      port: null,
      transport: "USB" as const,
      capabilities: ["USB" as const],
      rawData: null,
      metadata: {
        deviceId,
        pnpDeviceId,
        hardwareIds,
        vendorId,
        productId,
        status: optionalString(record.Status),
        existingQueues: Array.isArray(record.ExistingQueues) ? record.ExistingQueues : [],
        source: "WINDOWS_CIM_PNP_ENTITY",
        fieldVerification: "NOT_FIELD_VERIFIED",
      },
    };
  });
}

export class WindowsUsbPrinterDiscoveryAdapter {
  constructor(private readonly runner: WindowsCommandRunner = new ChildProcessWindowsCommandRunner()) {}

  async discover(): Promise<DiscoveredPrinter[]> {
    const stdout = await this.runner.runPowerShell(WINDOWS_USB_PRINTER_QUERY);
    return parseWindowsUsbPrinterJson(stdout);
  }
}
