// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "SpiderDesktop",
  platforms: [.macOS(.v14)],
  targets: [
    // Pure logic (export formats, settings, message parsing) so it can be unit tested.
    .target(
      name: "SpiderDesktopCore",
      path: "Sources/SpiderDesktopCore"
    ),
    // The AppKit + WebKit application.
    .executableTarget(
      name: "SpiderDesktop",
      dependencies: ["SpiderDesktopCore"],
      path: "Sources/SpiderDesktop"
    ),
    .testTarget(
      name: "SpiderDesktopCoreTests",
      dependencies: ["SpiderDesktopCore"],
      path: "Tests/SpiderDesktopCoreTests"
    ),
  ],
  swiftLanguageVersions: [.v5]
)
