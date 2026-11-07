# Diamond USB readiness timeout ESC-2 successor

SEALED DRAFT. Authority is Workflow V1 §6.2, ES-ENG-001, Design Freeze V1.4 ESC-2, and the prior Diamond USB FRONT successor. The only runtime change is a 5-second ceiling for the existing no-payload probe for the previously bound Diamond FRONT queue. The existing pre-claim fresh probe, separate pre-effect worker and 10-second submission ceiling, current owner validation, ledger/outbox, UNKNOWN, ACK, TCP and KITCHEN retain their behavior. Windows measurements were 3154, 3065 and 3079 ms. RAW paper is an existing result. A real order FIELD result remains pending.

Effective only on verified Founder acceptance and protected exact main integration. No cloud release, new role/queue, security bypass, or unknown task replay.

```json
{
  "task": "ES-DIAMOND-V3-USB-READINESS-TIMEOUT-01",
  "status": "SEALED_DRAFT_NOT_ACTIVE",
  "trustedMain": "ca399bcdd0bd9fb8f1ce4304bd2d79c39154f82a",
  "cloudReleaseUnchanged": "4337c61d7ad0eab564e5591229d70074652869d8",
  "productTree": "62212ad5ab5d8df347d43922633a684c4efacb7f",
  "installerSourceTree": "286bd852d23577dd91622e35fc5426439871822d",
  "installedSource": "fb1826d709f528eb83a8e04e16b8e410c5054ec0",
  "storeCode": "ST883DC00C",
  "host": "DESKTOP-N39GSA4",
  "role": "FRONT",
  "queue": "E-Shop Diamond FRONT USB",
  "port": "USB002",
  "sourcePaths": {
    "desktop/src/main/printing/windowsUsbPrintBoundary.ts": "3ceac60d976808e61c8d684416010090dbc6abaab4dfd85aad3b52a2527c829d",
    "desktop/tests/windows-usb-front.test.ts": "1146587b6d2f55218f24c618c65fc01c4fbb27de0c5341b2ead94a4fa3dc3591"
  },
  "governancePaths": [
    "docs/freezes/ES-DIAMOND-V3-USB-READINESS-TIMEOUT-01.md",
    "docs/change-gates/ES-DIAMOND-V3-USB-READINESS-TIMEOUT-01 CORE Admission Disposition.md",
    "docs/diamond/ES-DIAMOND-V3-USB-READINESS-TIMEOUT-ACCEPTANCE-001.md"
  ],
  "installerVersion": "0.2.0-pilot.2",
  "proof": {
    "payloadFiles": 162,
    "outerChanges": [
      "E-Shop Desktop.exe",
      "resources/app.asar"
    ],
    "innerChanges": [
      "dist/main/printing/windowsUsbPrintBoundary.js"
    ],
    "installedBaselineAsarSha256": "c9f4e01742ab7d261d5541fdfd51c363babd8e254a2daaf799aa1b1af322734b",
    "candidateAsarSha256": "eb563543e39cb2cf837d803f045ffc5dd50278646bfc6de3c60b0254befbfe91",
    "installerSha256": "275c5d87ce1a4912b5b8b309834f98953219b369642a41ab8015a49ae715b994",
    "installerSource": "ad4db0f476a574e7c60def0cca4fbfd624af181d",
    "product": "0e8d4d0a50ef6a47718896aae09e472668044d2f",
    "rollbackInstallerSha256": "4644f91e2aad10a26355487a0530d60d73518799d11b49125390f1235e7d0f54",
    "actualNSISPayloadMatchesBuilt": true,
    "compiledJsChangeOnlyOneBudgetLiteral": true,
    "unchangedProviderFiles": 88,
    "embeddedUninstallerUnchanged": true,
    "publisher": "unsigned-internal first-party",
    "scope": "HKLM/allusers successor on existing Diamond installation"
  },
  "proofSha256": "f35551475be871fd9f3bdd184fead0f50c26bbe2a957ca7f8e5168cc58e1dc68",
  "claudeReviewSha256": "9016505339e174cf50e8464db371b17c53eea49a8c4d93165f0d7abf7167623f",
  "deadlineExclusive": "2026-11-08T00:00:00Z"
}
```
