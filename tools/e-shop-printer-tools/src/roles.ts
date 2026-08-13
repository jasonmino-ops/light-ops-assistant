import type { PrinterRole } from "./types.js";

const VALID_ROLES = new Set<PrinterRole>(["FRONT", "KITCHEN"]);

export function parsePrinterRole(value: unknown): PrinterRole {
  if (typeof value !== "string" || !VALID_ROLES.has(value as PrinterRole)) {
    throw new Error("INVALID_PRINTER_ROLE: expected FRONT or KITCHEN");
  }

  return value as PrinterRole;
}

export function queueNameForRole(role: PrinterRole): "前台" | "厨房" {
  return role === "FRONT" ? "前台" : "厨房";
}
