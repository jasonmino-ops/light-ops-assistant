# E-Shop Mobile Runtime V1.0 — Phase 1

This directory contains the sandbox-first, repository-owned iOS runtime for the
single approved native capability: `taskType = print`.

## Scope

The runtime receives a validated ESC/POS command stream, writes those exact
bytes to one IPv4 endpoint on TCP port 9100, closes the connection, and returns
a stable result. It contains no receipt rendering, bitmap conversion, ESC/POS
encoding, store rules, order rules, printer discovery, retry queue, Bluetooth,
AirPrint, camera, NFC, notification, or background-task capability.

## Structure

- `EShopMobileRuntime/`: thin UIKit/WKWebView shell and native task entry.
- `Sources/MobileRuntimeCore/`: contract, validation, dispatch, result mapping,
  and TCP print execution.
- `Tests/MobileRuntimeCoreTests/`: contract and loopback TCP tests.
- `EShopMobileRuntime.xcodeproj/`: minimal iPhone application project.

## Local checks

The core is also a Swift package so contract and TCP behavior can be checked
without changing the production web application:

```bash
cd mobile-runtime/ios
swift run MobileRuntimeCoreChecks
```

The XCTest target remains available for full Xcode environments. The executable
checks cover contract preservation, result correlation, exact loopback TCP
delivery, close, and stable offline failure mapping without XCTest.

An iOS build requires the full Xcode application and iOS SDK:

```bash
xcodebuild \
  -project EShopMobileRuntime.xcodeproj \
  -scheme EShopMobileRuntime \
  -sdk iphonesimulator \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  build
```

For a signed real-device sandbox build, select a development team in Xcode.
The default Web Host is `https://elifekh.com/home`; a sandbox build can override
it with the `ESHOP_WEB_URL` scheme environment variable. Only HTTPS origins are
accepted, and navigation remains restricted to the configured origin.

## Native boundary

The WKWebView exposes exactly one contract-level browser façade:

```text
window.eshopMobileRuntime.submitTask(task) -> Promise<result>
```

No socket or native networking method is exposed to browser code. Production
web pages do not import the sandbox handoff in `../browser-sandbox`.

## Sandbox gate

The code is ready for the next physical verification gate only after an iOS
build is produced with full Xcode. Verification must use a real iPhone and real
LAN ESC/POS printer on the same LAN, exercise success and stable failure
results, and physically confirm Chinese, English, Khmer, feed, and cut. Pyto is
not part of this runtime.
