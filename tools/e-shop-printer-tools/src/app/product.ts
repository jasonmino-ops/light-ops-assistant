declare const __BUILD_COMMIT__: string | undefined;
declare const __WINFORMS_SCRIPT__: string | undefined;

export const PRODUCT_NAME = "E-Shop Printer Tools";
export const PRODUCT_VERSION = "P0.5";
export const SAFE_MODE = true as const;
export const WRITE_OPERATIONS_ENABLED = false as const;

export const BUILD_COMMIT = typeof __BUILD_COMMIT__ === "string"
  ? __BUILD_COMMIT__
  : "DEVELOPMENT";

export const WINFORMS_SCRIPT = typeof __WINFORMS_SCRIPT__ === "string"
  ? __WINFORMS_SCRIPT__
  : "";

export const REVIEW_FEATURES = [
  "WINDOWS_NETWORK_READ",
  "USB_ENUMERATION",
  "MP4200FIND_DISCOVERY",
  "MP4200FOUND_PARSE",
  "TCP_9100_CONNECT_ONLY_PROBE",
  "PROVISIONING_PREVIEW",
  "QUEUE_PREVIEW",
  "LOCAL_DIAGNOSTIC_LOGGING",
] as const;

export const DISABLED_WRITE_OPERATIONS = [
  "MP4200SAVE_TRANSMIT",
  "WINDOWS_QUEUE_MUTATION",
  "DRIVER_INSTALLATION",
  "TEST_PRINT",
  "REGISTRY_MUTATION",
  "FIREWALL_MUTATION",
] as const;

export function productManifest() {
  return {
    productName: PRODUCT_NAME,
    version: PRODUCT_VERSION,
    buildCommit: BUILD_COMMIT,
    safeMode: SAFE_MODE,
    writeOperationsEnabled: WRITE_OPERATIONS_ENABLED,
    features: REVIEW_FEATURES,
    disabledWriteOperations: DISABLED_WRITE_OPERATIONS,
    fieldVerification: "NOT_FIELD_VERIFIED" as const,
  };
}
