import type { DiscoveredPrinter } from "../types.js";

export interface RongtaNativeUsbPrinterRecord {
  manufacturer?: unknown;
  model?: unknown;
  serialNumber?: unknown;
  devicePath?: unknown;
  usbPortName?: unknown;
  vendorId?: unknown;
  productId?: unknown;
  rawData?: unknown;
}

export interface RongtaUsbNativeBridge {
  readonly integrationStatus: "NOT_FIELD_VERIFIED";
  listUsbPrinters(): Promise<unknown>;
}

export class UnsupportedRongtaUsbNativeBridge implements RongtaUsbNativeBridge {
  readonly integrationStatus = "NOT_FIELD_VERIFIED" as const;

  async listUsbPrinters(): Promise<never> {
    throw new Error("RONGTA_USB_NATIVE_UNAVAILABLE: NOT FIELD VERIFIED");
  }
}

export interface RongtaDllBinding {
  getAllRongTaUsbPrinters(): unknown | Promise<unknown>;
}

/**
 * Deliberately accepts an injected binding instead of loading or redistributing a vendor DLL.
 * ABI, bitness, dependencies, calling convention, and license remain field-audit gates.
 */
export class RongtaDllUsbNativeBridge implements RongtaUsbNativeBridge {
  readonly integrationStatus = "NOT_FIELD_VERIFIED" as const;

  constructor(private readonly binding: RongtaDllBinding) {}

  async listUsbPrinters(): Promise<unknown> {
    return this.binding.getAllRongTaUsbPrinters();
  }
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseNativePayload(payload: unknown): RongtaNativeUsbPrinterRecord[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload as RongtaNativeUsbPrinterRecord[];

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.length === 0) return [];
    try {
      return parseNativePayload(JSON.parse(trimmed));
    } catch {
      throw new Error("MALFORMED_RONGTA_USB_RESPONSE: expected structured JSON");
    }
  }

  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.printers)) return record.printers as RongtaNativeUsbPrinterRecord[];
    return [record as RongtaNativeUsbPrinterRecord];
  }

  throw new Error("MALFORMED_RONGTA_USB_RESPONSE: unsupported native result");
}

export function parseRongtaUsbNativeResult(payload: unknown): DiscoveredPrinter[] {
  return parseNativePayload(payload).map((record) => ({
    manufacturer: optionalString(record.manufacturer),
    model: optionalString(record.model),
    mac: null,
    ip: null,
    port: null,
    transport: "USB",
    capabilities: ["USB"],
    rawData: optionalString(record.rawData),
    metadata: {
      serialNumber: optionalString(record.serialNumber),
      devicePath: optionalString(record.devicePath),
      usbPortName: optionalString(record.usbPortName),
      vendorId: optionalString(record.vendorId),
      productId: optionalString(record.productId),
      source: "RONGTA_NATIVE_WRAPPER",
      fieldVerification: "NOT_FIELD_VERIFIED",
    },
  }));
}

export class RongtaUsbDiscoveryAdapter {
  constructor(private readonly nativeBridge: RongtaUsbNativeBridge = new UnsupportedRongtaUsbNativeBridge()) {}

  async discover(): Promise<DiscoveredPrinter[]> {
    return parseRongtaUsbNativeResult(await this.nativeBridge.listUsbPrinters());
  }
}
