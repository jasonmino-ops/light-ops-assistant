"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HRT_PROVIDER_COMPATIBILITY_MATRIX = exports.HRT_CONTRACT_VERSION = void 0;
exports.HRT_CONTRACT_VERSION = "1.0.0";
exports.HRT_PROVIDER_COMPATIBILITY_MATRIX = {
    providerId: "windows-provider-simulator",
    minProviderVersion: "0.1.0",
    maxProviderVersionExclusive: "1.0.0",
    requiredCapabilities: [
        "printer.receipt",
        "scanner.barcode_event",
        "customer_display.snapshot",
    ],
};
//# sourceMappingURL=types.js.map