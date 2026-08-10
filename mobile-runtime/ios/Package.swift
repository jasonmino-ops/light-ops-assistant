// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "MobileRuntimeCore",
    platforms: [
        .iOS(.v15),
        .macOS(.v13),
    ],
    products: [
        .library(name: "MobileRuntimeCore", targets: ["MobileRuntimeCore"]),
        .executable(name: "MobileRuntimeCoreChecks", targets: ["MobileRuntimeCoreChecks"]),
    ],
    targets: [
        .target(
            name: "MobileRuntimeCore",
            path: "Sources/MobileRuntimeCore"
        ),
        .executableTarget(
            name: "MobileRuntimeCoreChecks",
            dependencies: ["MobileRuntimeCore"],
            path: "Checks/MobileRuntimeCoreChecks"
        ),
        .testTarget(
            name: "MobileRuntimeCoreTests",
            dependencies: ["MobileRuntimeCore"],
            path: "Tests/MobileRuntimeCoreTests"
        ),
    ]
)
