export interface HrtAuditEvent {
  type: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export class HrtAuditEmitter {
  private readonly events: HrtAuditEvent[] = [];

  emit(type: string, details: Record<string, unknown>): void {
    this.events.push({
      type,
      timestamp: new Date().toISOString(),
      details,
    });
  }

  list(): HrtAuditEvent[] {
    return [...this.events];
  }
}

