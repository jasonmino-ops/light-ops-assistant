import { HrtCommandRequestPayload, HrtCommandResultPayload, HrtCustomerDisplaySnapshotPayload, HrtDeviceEventPayload, HrtDiagnosticPayload, HrtFrame, HrtHandshakeRequestPayload, HrtHandshakeResponsePayload, HrtHealthSnapshotPayload, HrtProviderRegistrationPayload } from "../types";
export declare const providerRegistrationFixture: HrtFrame<HrtProviderRegistrationPayload>;
export declare const handshakeRequestFixture: HrtFrame<HrtHandshakeRequestPayload>;
export declare const handshakeResponseFixture: HrtFrame<HrtHandshakeResponsePayload>;
export declare const printReceiptCommandFixture: HrtFrame<HrtCommandRequestPayload>;
export declare const succeededCommandResultFixture: HrtFrame<HrtCommandResultPayload>;
export declare const unknownCommandResultFixture: HrtFrame<HrtCommandResultPayload>;
export declare const scannerEventFixture: HrtFrame<HrtDeviceEventPayload>;
export declare const customerDisplaySnapshotFixture: HrtFrame<HrtCustomerDisplaySnapshotPayload>;
export declare const healthSnapshotFixture: HrtFrame<HrtHealthSnapshotPayload>;
export declare const diagnosticFixture: HrtFrame<HrtDiagnosticPayload>;
export declare const invalidMissingCorrelationFrameFixture: Omit<HrtFrame<HrtDiagnosticPayload>, "correlationId">;
//# sourceMappingURL=frames.d.ts.map