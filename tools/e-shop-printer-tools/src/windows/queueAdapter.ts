import type { ProvisioningPlan } from "../provisioning/buildProvisioningPlan.js";

export interface WindowsQueueBuildInput {
  plan: ProvisioningPlan;
  driverName: string;
  usbPortName?: string;
}

export interface WindowsQueueCommandPlan {
  queueName: "前台" | "厨房";
  transport: "USB" | "STANDARD_TCP_IP";
  protocol: "USB" | "RAW";
  rawPort: 9100 | null;
  portName: string;
  inspectScript: string;
  applyScript: string;
  validateScript: string;
  idempotent: true;
  fieldVerification: "NOT_FIELD_VERIFIED";
}

export interface ExistingWindowsQueueState {
  queueName: string;
  driverName: string;
  portName: string;
  printerHostAddress?: string;
  portNumber?: number;
}

export interface QueueStateValidation {
  ready: boolean;
  differences: string[];
}

export interface WindowsPrinterQueueAdapter {
  buildCommands(input: WindowsQueueBuildInput): WindowsQueueCommandPlan;
  validateState(input: WindowsQueueBuildInput, state: ExistingWindowsQueueState | null): QueueStateValidation;
}

function psQuote(value: string): string {
  if (value.includes("\n") || value.includes("\r") || value.length === 0) {
    throw new Error("INVALID_POWERSHELL_ARGUMENT");
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function validateInput(input: WindowsQueueBuildInput): void {
  if (!input.plan.executionAllowed) {
    throw new Error(`PROVISIONING_PLAN_BLOCKED: ${input.plan.blockers.join(",")}`);
  }
  if (input.driverName.trim().length === 0) throw new Error("DRIVER_NAME_REQUIRED");
  if (input.plan.role === "FRONT" && !input.usbPortName) throw new Error("USB_PORT_NAME_REQUIRED");
  if (input.plan.role === "KITCHEN" && (!input.plan.candidateIp || input.plan.rawPort !== 9100)) {
    throw new Error("VALID_KITCHEN_NETWORK_PLAN_REQUIRED");
  }
}

function queueMutationScript(queueName: string, driverName: string, portName: string): string {
  const queue = psQuote(queueName);
  const driver = psQuote(driverName);
  const port = psQuote(portName);
  return [
    `$driver = Get-PrinterDriver -Name ${driver} -ErrorAction SilentlyContinue`,
    `if (-not $driver) { throw 'PRINTER_DRIVER_NOT_INSTALLED' }`,
    `$queue = Get-Printer -Name ${queue} -ErrorAction SilentlyContinue`,
    `if (-not $queue) { Add-Printer -Name ${queue} -DriverName ${driver} -PortName ${port} }`,
    `elseif ($queue.DriverName -ne ${driver} -or $queue.PortName -ne ${port}) { Set-Printer -Name ${queue} -DriverName ${driver} -PortName ${port} }`,
  ].join("\n");
}

export class PowerShellWindowsPrinterQueueAdapter implements WindowsPrinterQueueAdapter {
  buildCommands(input: WindowsQueueBuildInput): WindowsQueueCommandPlan {
    validateInput(input);
    const queueName = input.plan.queueName;
    const driverName = input.driverName.trim();

    if (input.plan.role === "FRONT") {
      const portName = input.usbPortName!;
      return {
        queueName,
        transport: "USB",
        protocol: "USB",
        rawPort: null,
        portName,
        inspectScript: `Get-Printer -Name ${psQuote(queueName)} -ErrorAction SilentlyContinue | Select-Object Name, DriverName, PortName | ConvertTo-Json -Compress`,
        applyScript: queueMutationScript(queueName, driverName, portName),
        validateScript: `Get-Printer -Name ${psQuote(queueName)} -ErrorAction Stop | Select-Object Name, DriverName, PortName | ConvertTo-Json -Compress`,
        idempotent: true,
        fieldVerification: "NOT_FIELD_VERIFIED",
      };
    }

    const candidateIp = input.plan.candidateIp!;
    const portName = `E-SHOP-RAW-${candidateIp}`;
    const port = psQuote(portName);
    const host = psQuote(candidateIp);
    const portSetup = [
      `$port = Get-PrinterPort -Name ${port} -ErrorAction SilentlyContinue`,
      `if (-not $port) { Add-PrinterPort -Name ${port} -PrinterHostAddress ${host} -PortNumber 9100 }`,
      `elseif ($port.PrinterHostAddress -ne ${host} -or [int]$port.PortNumber -ne 9100) { throw 'PRINTER_PORT_CONFLICT' }`,
    ].join("\n");

    return {
      queueName,
      transport: "STANDARD_TCP_IP",
      protocol: "RAW",
      rawPort: 9100,
      portName,
      inspectScript: [
        `Get-PrinterPort -Name ${port} -ErrorAction SilentlyContinue | Select-Object Name, PrinterHostAddress, PortNumber`,
        `Get-Printer -Name ${psQuote(queueName)} -ErrorAction SilentlyContinue | Select-Object Name, DriverName, PortName`,
      ].join("\n"),
      applyScript: [portSetup, queueMutationScript(queueName, driverName, portName)].join("\n"),
      validateScript: [
        `$port = Get-PrinterPort -Name ${port} -ErrorAction Stop`,
        `$queue = Get-Printer -Name ${psQuote(queueName)} -ErrorAction Stop`,
        `[pscustomobject]@{ QueueName=$queue.Name; DriverName=$queue.DriverName; PortName=$queue.PortName; PrinterHostAddress=$port.PrinterHostAddress; PortNumber=$port.PortNumber } | ConvertTo-Json -Compress`,
      ].join("\n"),
      idempotent: true,
      fieldVerification: "NOT_FIELD_VERIFIED",
    };
  }

  validateState(input: WindowsQueueBuildInput, state: ExistingWindowsQueueState | null): QueueStateValidation {
    validateInput(input);
    if (!state) return { ready: false, differences: ["QUEUE_MISSING"] };

    const expectedPortName = input.plan.role === "FRONT"
      ? input.usbPortName!
      : `E-SHOP-RAW-${input.plan.candidateIp!}`;
    const differences: string[] = [];
    if (state.queueName !== input.plan.queueName) differences.push("QUEUE_NAME_MISMATCH");
    if (state.driverName !== input.driverName.trim()) differences.push("DRIVER_MISMATCH");
    if (state.portName !== expectedPortName) differences.push("PORT_NAME_MISMATCH");
    if (input.plan.role === "KITCHEN") {
      if (state.printerHostAddress !== input.plan.candidateIp) differences.push("HOST_ADDRESS_MISMATCH");
      if (state.portNumber !== 9100) differences.push("RAW_PORT_MISMATCH");
    }
    return { ready: differences.length === 0, differences };
  }
}
