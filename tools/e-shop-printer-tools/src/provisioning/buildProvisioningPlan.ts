import { intToIpv4, ipv4ToInt, isSameSubnet, parseIpv4 } from "../network/ipv4.js";
import { queueNameForRole } from "../roles.js";
import type { DiscoveredPrinter, NetworkInterfaceInfo, PrinterRole, PrinterTransport, WindowsNetworkSnapshot } from "../types.js";

export type ConflictCheckStatus = "NOT_REQUIRED" | "NOT_RUN" | "AVAILABLE" | "EXHAUSTED";

export interface IpConflictContext {
  network: NetworkInterfaceInfo;
  selectedPrinter: DiscoveredPrinter;
}

export type IpConflictDetector = (candidateIp: string, context: IpConflictContext) => Promise<boolean>;

export interface ProvisioningPlan {
  role: PrinterRole;
  transport: PrinterTransport;
  queueName: "前台" | "厨房";
  selectedPrinterFingerprint: string;
  selectedPrinter: DiscoveredPrinter;
  networkInterface: string | null;
  targetSubnet: string | null;
  targetSubnetMask: string | null;
  targetGateway: string | null;
  candidateIp: string | null;
  rawPort: 9100 | null;
  networkMutationRequired: boolean;
  conflictCheck: {
    status: ConflictCheckStatus;
    checkedCandidates: string[];
  };
  confirmation: {
    required: true;
    matched: boolean;
  };
  executionAllowed: boolean;
  blockers: string[];
  fieldVerification: "NOT_FIELD_VERIFIED";
}

export interface BuildProvisioningPlanInput {
  currentWindowsNetwork: WindowsNetworkSnapshot;
  selectedPrinter: DiscoveredPrinter;
  role: PrinterRole;
  confirmedPrinterFingerprint?: string;
  conflictDetector?: IpConflictDetector;
}

function metadataString(printer: DiscoveredPrinter, key: string): string | null {
  const value = printer.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function printerFingerprint(printer: DiscoveredPrinter): string {
  if (printer.transport === "NETWORK") {
    const identity = printer.mac ?? printer.ip;
    if (!identity) throw new Error("PRINTER_IDENTITY_REQUIRED: NETWORK printer needs MAC or IP");
    return `NETWORK:${identity}`;
  }

  const identity = metadataString(printer, "serialNumber")
    ?? metadataString(printer, "devicePath")
    ?? metadataString(printer, "pnpDeviceId")
    ?? metadataString(printer, "deviceId")
    ?? [metadataString(printer, "vendorId"), metadataString(printer, "productId"), printer.model]
      .filter(Boolean)
      .join(":");
  if (!identity) throw new Error("PRINTER_IDENTITY_REQUIRED: USB printer needs native identity");
  return `USB:${identity}`;
}

function assertRoleTransport(role: PrinterRole, printer: DiscoveredPrinter): void {
  if (role === "FRONT" && printer.transport !== "USB") {
    throw new Error("ROLE_TRANSPORT_MISMATCH: FRONT requires USB");
  }
  if (role === "KITCHEN" && printer.transport !== "NETWORK") {
    throw new Error("ROLE_TRANSPORT_MISMATCH: KITCHEN requires NETWORK");
  }
}

function candidateAddresses(network: NetworkInterfaceInfo, excluded: Set<number>): string[] {
  const networkInt = ipv4ToInt(network.networkAddress);
  const broadcastInt = ipv4ToInt(network.broadcastAddress);
  const candidates: string[] = [];
  if (broadcastInt - networkInt <= 2) return candidates;

  for (let value = broadcastInt - 1; value > networkInt && candidates.length < 256; value -= 1) {
    const normalized = value >>> 0;
    if (!excluded.has(normalized)) candidates.push(intToIpv4(normalized));
  }
  return candidates;
}

async function selectCandidateIp(
  network: NetworkInterfaceInfo,
  printer: DiscoveredPrinter,
  detector?: IpConflictDetector,
): Promise<{ candidateIp: string | null; status: ConflictCheckStatus; checkedCandidates: string[] }> {
  const excluded = new Set<number>([ipv4ToInt(network.ipv4)]);
  if (network.gateway) excluded.add(ipv4ToInt(network.gateway));
  if (printer.ip) excluded.add(ipv4ToInt(printer.ip));
  const candidates = candidateAddresses(network, excluded);
  if (candidates.length === 0) return { candidateIp: null, status: "EXHAUSTED", checkedCandidates: [] };
  if (!detector) return { candidateIp: candidates[0], status: "NOT_RUN", checkedCandidates: [] };

  const checkedCandidates: string[] = [];
  for (const candidateIp of candidates) {
    checkedCandidates.push(candidateIp);
    const hasConflict = await detector(candidateIp, { network, selectedPrinter: printer });
    if (!hasConflict) return { candidateIp, status: "AVAILABLE", checkedCandidates };
  }
  return { candidateIp: null, status: "EXHAUSTED", checkedCandidates };
}

export async function buildProvisioningPlan(input: BuildProvisioningPlanInput): Promise<ProvisioningPlan> {
  assertRoleTransport(input.role, input.selectedPrinter);
  const fingerprint = printerFingerprint(input.selectedPrinter);
  const confirmationMatched = input.confirmedPrinterFingerprint === fingerprint;
  const blockers: string[] = confirmationMatched ? [] : ["EXPLICIT_DEVICE_CONFIRMATION_REQUIRED"];

  if (input.role === "FRONT") {
    return {
      role: "FRONT",
      transport: "USB",
      queueName: queueNameForRole("FRONT"),
      selectedPrinterFingerprint: fingerprint,
      selectedPrinter: input.selectedPrinter,
      networkInterface: null,
      targetSubnet: null,
      targetSubnetMask: null,
      targetGateway: null,
      candidateIp: null,
      rawPort: null,
      networkMutationRequired: false,
      conflictCheck: { status: "NOT_REQUIRED", checkedCandidates: [] },
      confirmation: { required: true, matched: confirmationMatched },
      executionAllowed: blockers.length === 0,
      blockers,
      fieldVerification: "NOT_FIELD_VERIFIED",
    };
  }

  const network = input.currentWindowsNetwork.preferredInterface;
  if (!network) throw new Error("WINDOWS_NETWORK_REQUIRED_FOR_KITCHEN");
  if (input.selectedPrinter.ip) parseIpv4(input.selectedPrinter.ip);
  const sameSubnet = input.selectedPrinter.ip
    ? isSameSubnet(network.ipv4, input.selectedPrinter.ip, network.subnetMask)
    : false;

  const candidate = sameSubnet
    ? { candidateIp: input.selectedPrinter.ip, status: "NOT_REQUIRED" as const, checkedCandidates: [] }
    : await selectCandidateIp(network, input.selectedPrinter, input.conflictDetector);

  if (!candidate.candidateIp) blockers.push("NO_AVAILABLE_CANDIDATE_IP");
  if (candidate.status === "NOT_RUN") blockers.push("IP_CONFLICT_CHECK_REQUIRED");

  return {
    role: "KITCHEN",
    transport: "NETWORK",
    queueName: queueNameForRole("KITCHEN"),
    selectedPrinterFingerprint: fingerprint,
    selectedPrinter: input.selectedPrinter,
    networkInterface: network.interface,
    targetSubnet: network.networkAddress,
    targetSubnetMask: network.subnetMask,
    targetGateway: network.gateway,
    candidateIp: candidate.candidateIp,
    rawPort: 9100,
    networkMutationRequired: !sameSubnet,
    conflictCheck: { status: candidate.status, checkedCandidates: candidate.checkedCandidates },
    confirmation: { required: true, matched: confirmationMatched },
    executionAllowed: blockers.length === 0,
    blockers,
    fieldVerification: "NOT_FIELD_VERIFIED",
  };
}
