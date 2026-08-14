import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DiscoveredPrinter } from "../types.js";
import type { WindowsCommandRunner } from "../network/windowsNetworkProvider.js";

const execFileAsync = promisify(execFile);
const WINDOWS_USB_DISCOVERY_TIMEOUT_MS = 20_000;

export const WINDOWS_USB_PRINTER_QUERY = `
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $ErrorActionPreference = 'Stop'
  $WarningPreference = 'SilentlyContinue'
  $ProgressPreference = 'SilentlyContinue'
  $InformationPreference = 'SilentlyContinue'
  $queues = @(Get-Printer -ErrorAction SilentlyContinue | Select-Object Name, DriverName, PortName)
  $devices = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object {
    $_.InstanceId -like 'USBPRINT\\*' -or ($_.Class -eq 'Printer' -and $_.InstanceId -like 'USB\\*')
  })
  $records = @($devices | ForEach-Object {
    $device = $_
    $instanceId = [string]$device.InstanceId
    $parent = Get-PnpDeviceProperty -InstanceId $instanceId -KeyName 'DEVPKEY_Device_Parent' -ErrorAction SilentlyContinue
    $hardware = Get-PnpDeviceProperty -InstanceId $instanceId -KeyName 'DEVPKEY_Device_HardwareIds' -ErrorAction SilentlyContinue
    $manufacturer = Get-PnpDeviceProperty -InstanceId $instanceId -KeyName 'DEVPKEY_Device_Manufacturer' -ErrorAction SilentlyContinue
    $parentId = if ($parent) { [string]$parent.Data } else { $null }
    $hardwareIds = if ($hardware) { @($hardware.Data) } else { @() }
    $usbInstanceId = @($instanceId, $parentId) + $hardwareIds |
      Where-Object { $_ -is [string] -and $_ -match '^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}\\' } |
      Select-Object -First 1
    $usbPrintIdentity = if ($instanceId -like 'USBPRINT\\*') { $instanceId } else { $null }
    $friendlyName = [string]$device.FriendlyName
    $matchingQueues = @($queues | Where-Object { $_.Name -eq $friendlyName })
    $serial = if ($usbInstanceId -and $usbInstanceId.Contains('\\')) { $usbInstanceId.Substring($usbInstanceId.LastIndexOf('\\') + 1) } else { $null }
    [pscustomobject]@{
      FriendlyName = $friendlyName
      Manufacturer = if ($manufacturer) { [string]$manufacturer.Data } else { $null }
      Model = $friendlyName
      InstanceId = $instanceId
      UsbInstanceId = $usbInstanceId
      USBPRINTIdentity = $usbPrintIdentity
      HardwareID = $hardwareIds
      SerialNumber = $serial
      Status = [string]$device.Status
      ExistingQueues = $matchingQueues
    }
  })
  $json = ConvertTo-Json -InputObject @($records) -Depth 6 -Compress
  [Console]::Out.Write($json)
} catch {
  [Console]::Error.WriteLine("WINDOWS_USB_DISCOVERY_QUERY_FAILED: " + $_.Exception.Message)
  exit 1
}
`.trim();

interface RawUsbPrinterRecord {
  FriendlyName?: unknown;
  Manufacturer?: unknown;
  Model?: unknown;
  InstanceId?: unknown;
  UsbInstanceId?: unknown;
  USBPRINTIdentity?: unknown;
  SerialNumber?: unknown;
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
  if (json.trim().length === 0) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch (error) {
    throw new Error(`INVALID_WINDOWS_USB_PRINTER_JSON: ${(error as Error).message}`);
  }
  if (payload == null) return [];
  const records = (Array.isArray(payload) ? payload : [payload]) as RawUsbPrinterRecord[];

  const printers = records.map((record) => {
    const instanceId = optionalString(record.InstanceId);
    const usbPrintIdentity = optionalString(record.USBPRINTIdentity);
    const usbInstanceId = optionalString(record.UsbInstanceId);
    const deviceId = usbPrintIdentity ?? optionalString(record.DeviceID) ?? instanceId;
    const pnpDeviceId = usbInstanceId ?? optionalString(record.PNPDeviceID) ?? instanceId;
    if (!deviceId && !pnpDeviceId) throw new Error("USB_PRINTER_DEVICE_ID_REQUIRED");
    const hardwareIds = strings(record.HardwareID);
    const { vendorId, productId } = extractVidPid([pnpDeviceId ?? "", deviceId ?? "", ...hardwareIds]);
    return {
      manufacturer: optionalString(record.Manufacturer),
      model: optionalString(record.FriendlyName) ?? optionalString(record.Model) ?? optionalString(record.Name),
      mac: null,
      ip: null,
      port: null,
      transport: "USB" as const,
      capabilities: ["USB" as const],
      rawData: null,
      metadata: {
        deviceId,
        pnpDeviceId,
        instanceId,
        usbPrintIdentity,
        serialNumber: optionalString(record.SerialNumber),
        hardwareIds,
        vendorId,
        productId,
        status: optionalString(record.Status),
        existingQueues: Array.isArray(record.ExistingQueues) ? record.ExistingQueues : [],
        source: "WINDOWS_PNP_DEVICE",
        fieldVerification: "NOT_FIELD_VERIFIED",
      },
    };
  });

  const unique = new Map<string, DiscoveredPrinter>();
  for (const printer of printers) {
    const identity = String(printer.metadata.pnpDeviceId ?? printer.metadata.deviceId).toUpperCase();
    if (!unique.has(identity)) unique.set(identity, printer);
  }
  return [...unique.values()];
}

export class ChildProcessWindowsUsbCommandRunner implements WindowsCommandRunner {
  async runPowerShell(script: string): Promise<string> {
    if (process.platform !== "win32") {
      throw new Error("WINDOWS_USB_DISCOVERY_UNAVAILABLE: NOT FIELD VERIFIED on this platform");
    }
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ], {
      encoding: "utf8",
      windowsHide: true,
      timeout: WINDOWS_USB_DISCOVERY_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  }
}

export class WindowsUsbPrinterDiscoveryAdapter {
  constructor(private readonly runner: WindowsCommandRunner = new ChildProcessWindowsUsbCommandRunner()) {}

  async discover(): Promise<DiscoveredPrinter[]> {
    const stdout = await this.runner.runPowerShell(WINDOWS_USB_PRINTER_QUERY);
    return parseWindowsUsbPrinterJson(stdout);
  }
}
