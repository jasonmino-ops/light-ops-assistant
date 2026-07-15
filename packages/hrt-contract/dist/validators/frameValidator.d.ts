import { HrtCapability, HrtCompatibilityResultPayload, HrtCommandRequestPayload, HrtCommandResultPayload, HrtCustomerDisplaySnapshotPayload, HrtDeviceEventPayload, HrtDiagnosticPayload, HrtFrame, HrtHandshakeRequestPayload, HrtHandshakeResponsePayload, HrtHealthSnapshotPayload, HrtProviderRegistrationPayload } from "../types";
export interface ValidationResult {
    ok: boolean;
    errors: string[];
}
export declare function validateFrame(value: unknown): ValidationResult;
export declare function validateCommandRequestPayload(value: unknown): ValidationResult;
export declare function validateProviderRegistrationPayload(value: unknown): ValidationResult;
export declare function validateHandshakeRequestPayload(value: unknown): ValidationResult;
export declare function evaluateCompatibility(registration: HrtProviderRegistrationPayload, requiredCapabilities?: readonly HrtCapability[]): HrtCompatibilityResultPayload;
export declare function validateCompatibilityResultPayload(value: unknown): ValidationResult;
export declare function validateHandshakeResponsePayload(value: unknown): ValidationResult;
export declare function validateCommandResultPayload(value: unknown): ValidationResult;
export declare function validateScannerEventPayload(value: unknown): ValidationResult;
export declare function validateCustomerDisplaySnapshotPayload(value: unknown): ValidationResult;
export declare function validateHealthSnapshotPayload(value: unknown): ValidationResult;
export declare function validateDiagnosticPayload(value: unknown): ValidationResult;
export declare function assertValidFrame<TPayload>(frame: HrtFrame<TPayload>): void;
export declare function assertValidCommandRequest(payload: HrtCommandRequestPayload): void;
export declare function assertValidCommandResult(payload: HrtCommandResultPayload): void;
export declare function assertValidProviderRegistration(payload: HrtProviderRegistrationPayload): void;
export declare function assertValidHandshakeRequest(payload: HrtHandshakeRequestPayload): void;
export declare function assertValidHandshakeResponse(payload: HrtHandshakeResponsePayload): void;
export declare function assertValidScannerEvent(payload: HrtDeviceEventPayload): void;
export declare function assertValidCustomerDisplaySnapshot(payload: HrtCustomerDisplaySnapshotPayload): void;
export declare function assertValidHealthSnapshot(payload: HrtHealthSnapshotPayload): void;
export declare function assertValidDiagnostic(payload: HrtDiagnosticPayload): void;
//# sourceMappingURL=frameValidator.d.ts.map