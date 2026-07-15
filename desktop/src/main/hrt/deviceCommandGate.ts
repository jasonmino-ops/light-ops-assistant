import { HrtCapability, HrtCommandFamily, HrtCommandRequestPayload, HrtDeviceKind } from "@eshop/hrt-contract";
import { RegisteredHrtDevice } from "./deviceRegistry";

export type HrtDeviceCommandRejectReason =
  | "UNKNOWN_DEVICE"
  | "UNASSIGNED_DEVICE"
  | "KIND_MISMATCH"
  | "CAPABILITY_MISMATCH"
  | "OWNERSHIP_INVALID"
  | "STALE_PROVIDER_INSTANCE";

export interface HrtDeviceCommandGateResult {
  accepted: boolean;
  reason?: HrtDeviceCommandRejectReason;
  requiredKind?: HrtDeviceKind;
  requiredCapability?: HrtCapability;
  commandFamily?: HrtCommandFamily;
}

const commandRequirements: Record<
  HrtCommandRequestPayload["commandType"],
  { kind: HrtDeviceKind; capability: HrtCapability; family: HrtCommandFamily }
> = {
  PRINT_RECEIPT: { kind: "PRINTER", capability: "printer.receipt", family: "printer" },
  OPEN_ATTACHED_CASH_DRAWER: { kind: "PRINTER", capability: "printer.cash_drawer_pulse", family: "printer" },
  SET_SCANNER_ENABLED: { kind: "SCANNER", capability: "scanner.barcode_event", family: "scanner" },
  DISPLAY_SNAPSHOT: { kind: "CUSTOMER_DISPLAY", capability: "customer_display.snapshot", family: "customer_display" },
  CLEAR_DISPLAY: { kind: "CUSTOMER_DISPLAY", capability: "customer_display.snapshot", family: "customer_display" },
};

export function evaluateDeviceCommandEligibility(args: {
  command: HrtCommandRequestPayload;
  device?: RegisteredHrtDevice;
}): HrtDeviceCommandGateResult {
  const requirement = commandRequirements[args.command.commandType];
  if (!args.device) {
    return { accepted: false, reason: "UNKNOWN_DEVICE", ...shapeRequirement(requirement) };
  }
  if (args.device.assignmentState !== "ASSIGNED") {
    return { accepted: false, reason: "UNASSIGNED_DEVICE", ...shapeRequirement(requirement) };
  }
  if (args.device.device.deviceKind !== requirement.kind) {
    return { accepted: false, reason: "KIND_MISMATCH", ...shapeRequirement(requirement) };
  }
  if (!args.device.capabilities.includes(requirement.capability)) {
    return { accepted: false, reason: "CAPABILITY_MISMATCH", ...shapeRequirement(requirement) };
  }
  if (args.device.ownershipState === "STALE_PROVIDER") {
    return { accepted: false, reason: "STALE_PROVIDER_INSTANCE", ...shapeRequirement(requirement) };
  }
  if (args.device.ownershipState !== "VALID") {
    return { accepted: false, reason: "OWNERSHIP_INVALID", ...shapeRequirement(requirement) };
  }
  return { accepted: true, ...shapeRequirement(requirement) };
}

function shapeRequirement(requirement: { kind: HrtDeviceKind; capability: HrtCapability; family: HrtCommandFamily }) {
  return {
    requiredKind: requirement.kind,
    requiredCapability: requirement.capability,
    commandFamily: requirement.family,
  };
}
