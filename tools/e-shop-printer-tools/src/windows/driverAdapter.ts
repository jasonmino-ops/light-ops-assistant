import { ChildProcessWindowsCommandRunner, type WindowsCommandRunner } from "../network/windowsNetworkProvider.js";

export const WINDOWS_PRINTER_DRIVER_QUERY = `
$ErrorActionPreference = 'Stop'
Get-PrinterDriver -ErrorAction Stop |
  Select-Object Name, Manufacturer, MajorVersion, DriverVersion, InfPath, Environment |
  ConvertTo-Json -Depth 4 -Compress
`.trim();

export interface WindowsPrinterDriverState {
  name: string;
  manufacturer: string | null;
  majorVersion: number | null;
  driverVersion: string | null;
  infPath: string | null;
  environment: string | null;
}

interface RawDriverRecord {
  Name?: unknown;
  Manufacturer?: unknown;
  MajorVersion?: unknown;
  DriverVersion?: unknown;
  InfPath?: unknown;
  Environment?: unknown;
}

function optionalString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function parseWindowsPrinterDriversJson(json: string): WindowsPrinterDriverState[] {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch (error) {
    throw new Error(`INVALID_WINDOWS_PRINTER_DRIVER_JSON: ${(error as Error).message}`);
  }
  if (payload == null) return [];
  const records = (Array.isArray(payload) ? payload : [payload]) as RawDriverRecord[];
  return records.map((record) => {
    const name = optionalString(record.Name);
    if (!name) throw new Error("WINDOWS_PRINTER_DRIVER_NAME_REQUIRED");
    const majorVersion = Number(record.MajorVersion);
    return {
      name,
      manufacturer: optionalString(record.Manufacturer),
      majorVersion: Number.isFinite(majorVersion) ? majorVersion : null,
      driverVersion: optionalString(record.DriverVersion),
      infPath: optionalString(record.InfPath),
      environment: optionalString(record.Environment),
    };
  });
}

export interface DriverProvisioningDecision {
  action: "REUSE_INSTALLED_DRIVER" | "BLOCK_MISSING_DRIVER";
  requestedDriverName: string;
  installedDriver: WindowsPrinterDriverState | null;
  ready: boolean;
  blockers: string[];
  idempotent: true;
  fieldVerification: "NOT_FIELD_VERIFIED";
}

export function decideDriverProvisioning(
  requestedDriverName: string,
  installedDrivers: WindowsPrinterDriverState[],
): DriverProvisioningDecision {
  const normalizedName = requestedDriverName.trim();
  if (!normalizedName) throw new Error("DRIVER_NAME_REQUIRED");
  const installedDriver = installedDrivers.find((driver) => (
    driver.name.localeCompare(normalizedName, undefined, { sensitivity: "accent" }) === 0
  )) ?? null;
  return {
    action: installedDriver ? "REUSE_INSTALLED_DRIVER" : "BLOCK_MISSING_DRIVER",
    requestedDriverName: normalizedName,
    installedDriver,
    ready: installedDriver !== null,
    blockers: installedDriver ? [] : ["SAFE_DRIVER_ONLY_AUTOMATION_NOT_VERIFIED"],
    idempotent: true,
    fieldVerification: "NOT_FIELD_VERIFIED",
  };
}

export class WindowsPrinterDriverAdapter {
  constructor(private readonly runner: WindowsCommandRunner = new ChildProcessWindowsCommandRunner()) {}

  async inspect(): Promise<WindowsPrinterDriverState[]> {
    return parseWindowsPrinterDriversJson(await this.runner.runPowerShell(WINDOWS_PRINTER_DRIVER_QUERY));
  }

  async decide(requestedDriverName: string): Promise<DriverProvisioningDecision> {
    return decideDriverProvisioning(requestedDriverName, await this.inspect());
  }
}
