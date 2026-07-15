import { HrtRuntimeDiagnostics } from "./runtimeDiagnostics";
import { HrtDeviceScope, HrtDeviceSlotReference, scopeMatches } from "./deviceSlot";

export type HrtDeviceAssignmentState = "UNASSIGNED" | "ASSIGNED" | "INVALID" | "AWAITING_REBIND";

export interface HrtDeviceAssignment {
  assignmentId: string;
  slotId: string;
  physicalDeviceId: string;
  providerId: string;
  providerInstanceId: string;
  assignedAt: string;
  assignmentState: HrtDeviceAssignmentState;
  ownershipState: "VALID" | "STALE_PROVIDER" | "INVALIDATED" | "UNKNOWN";
  reason?: string;
  scope: HrtDeviceScope;
  revision: string;
}

export type HrtAssignmentRejectReason =
  | "UNKNOWN_SLOT"
  | "UNKNOWN_DEVICE"
  | "KIND_MISMATCH"
  | "CAPABILITY_MISMATCH"
  | "STALE_PROVIDER_INSTANCE"
  | "CONFLICTING_ASSIGNMENT"
  | "INVALID_SCOPE";

export interface HrtAssignmentResult {
  accepted: boolean;
  assignment?: HrtDeviceAssignment;
  reason?: HrtAssignmentRejectReason;
}

export class HrtDeviceAssignmentRuntime {
  private readonly assignmentsById = new Map<string, HrtDeviceAssignment>();
  private readonly assignmentIdBySlot = new Map<string, string>();
  private readonly assignmentIdByDevice = new Map<string, string>();

  constructor(private readonly diagnostics: HrtRuntimeDiagnostics) {}

  assign(args: {
    slot: HrtDeviceSlotReference;
    physicalDeviceId: string;
    providerId: string;
    providerInstanceId: string;
    scope: HrtDeviceScope;
    revision?: string;
    now?: string;
  }): HrtAssignmentResult {
    if (!scopeMatches(args.slot.scope, args.scope)) {
      return this.reject("INVALID_SCOPE", args.slot.slotId, args.physicalDeviceId);
    }
    const existingSlotAssignmentId = this.assignmentIdBySlot.get(args.slot.slotId);
    const existingDeviceAssignmentId = this.assignmentIdByDevice.get(args.physicalDeviceId);
    if (
      (existingSlotAssignmentId && this.assignmentsById.get(existingSlotAssignmentId)?.physicalDeviceId !== args.physicalDeviceId) ||
      (existingDeviceAssignmentId && this.assignmentsById.get(existingDeviceAssignmentId)?.slotId !== args.slot.slotId)
    ) {
      return this.reject("CONFLICTING_ASSIGNMENT", args.slot.slotId, args.physicalDeviceId);
    }
    const assignment: HrtDeviceAssignment = {
      assignmentId: `${args.slot.slotId}:${args.physicalDeviceId}`,
      slotId: args.slot.slotId,
      physicalDeviceId: args.physicalDeviceId,
      providerId: args.providerId,
      providerInstanceId: args.providerInstanceId,
      assignedAt: args.now ?? new Date().toISOString(),
      assignmentState: "ASSIGNED",
      ownershipState: "VALID",
      scope: args.scope,
      revision: args.revision ?? args.slot.revision ?? "runtime",
    };
    this.assignmentsById.set(assignment.assignmentId, assignment);
    this.assignmentIdBySlot.set(assignment.slotId, assignment.assignmentId);
    this.assignmentIdByDevice.set(assignment.physicalDeviceId, assignment.assignmentId);
    return { accepted: true, assignment };
  }

  replace(args: Parameters<HrtDeviceAssignmentRuntime["assign"]>[0]): HrtAssignmentResult {
    this.unassignSlot(args.slot.slotId, "REPLACED");
    return this.assign(args);
  }

  unassignSlot(slotId: string, reason = "UNASSIGNED"): HrtDeviceAssignment | undefined {
    const assignmentId = this.assignmentIdBySlot.get(slotId);
    if (!assignmentId) {
      return undefined;
    }
    return this.invalidate(assignmentId, "UNASSIGNED", reason);
  }

  invalidateByProviderInstance(providerInstanceId: string, reason: string): HrtDeviceAssignment[] {
    const invalidated: HrtDeviceAssignment[] = [];
    for (const assignment of this.assignmentsById.values()) {
      if (assignment.providerInstanceId === providerInstanceId && assignment.assignmentState === "ASSIGNED") {
        const next = this.invalidate(assignment.assignmentId, "AWAITING_REBIND", reason);
        if (next) {
          invalidated.push(next);
        }
      }
    }
    return invalidated;
  }

  invalidate(assignmentId: string, assignmentState: HrtDeviceAssignmentState, reason: string): HrtDeviceAssignment | undefined {
    const current = this.assignmentsById.get(assignmentId);
    if (!current) {
      return undefined;
    }
    const next: HrtDeviceAssignment = {
      ...current,
      assignmentState,
      ownershipState: assignmentState === "ASSIGNED" ? current.ownershipState : "INVALIDATED",
      reason,
    };
    this.assignmentsById.set(assignmentId, next);
    if (assignmentState !== "ASSIGNED") {
      this.assignmentIdBySlot.delete(next.slotId);
      this.assignmentIdByDevice.delete(next.physicalDeviceId);
    }
    this.diagnostics.emit({
      eventCode: "HRT_DEVICE_ASSIGNMENT_INVALIDATED",
      severity: "WARN",
      providerId: next.providerId,
      providerInstanceId: next.providerInstanceId,
      reason,
      details: {
        assignmentId,
        slotId: next.slotId,
        physicalDeviceId: next.physicalDeviceId,
        assignmentState,
      },
    });
    return next;
  }

  getBySlot(slotId: string): HrtDeviceAssignment | undefined {
    const assignmentId = this.assignmentIdBySlot.get(slotId);
    return assignmentId ? this.assignmentsById.get(assignmentId) : undefined;
  }

  getByDevice(physicalDeviceId: string): HrtDeviceAssignment | undefined {
    const assignmentId = this.assignmentIdByDevice.get(physicalDeviceId);
    return assignmentId ? this.assignmentsById.get(assignmentId) : undefined;
  }

  resolve(slotId: string): HrtDeviceAssignment | undefined {
    const assignment = this.getBySlot(slotId);
    return assignment?.assignmentState === "ASSIGNED" ? assignment : undefined;
  }

  list(): HrtDeviceAssignment[] {
    return [...this.assignmentsById.values()];
  }

  private reject(
    reason: HrtAssignmentRejectReason,
    slotId: string,
    physicalDeviceId: string,
  ): HrtAssignmentResult {
    this.diagnostics.emit({
      eventCode: "HRT_DEVICE_ASSIGNMENT_REJECTED",
      severity: "WARN",
      reason,
      details: { slotId, physicalDeviceId },
    });
    return { accepted: false, reason };
  }
}
