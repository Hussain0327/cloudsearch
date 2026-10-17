import Foundation

/// What the person asked the spider to collect, how fast, and when.
public struct CrawlSettings: Codable, Equatable {
  public static let minPaceMs = 60
  public static let maxPaceMs = 1500
  public static let defaultPaceMs = 350

  /// Detector order as shown in the Get menu. `custom` is implied by the pattern.
  public static let detectorNames = ["notes", "money", "shares", "percent", "date", "number", "email"]
  public static let detectorTitles: [String: String] = [
    "notes": "Notes due (debt)",
    "money": "Money",
    "shares": "Share counts",
    "percent": "Percentages",
    "date": "Dates",
    "number": "Big numbers",
    "email": "Emails",
  ]

  public var detectors: [String: Bool]
  public var customPattern: String
  public var paceMs: Int
  public var autoRun: Bool
  public var floatOnTop: Bool

  public static let `default` = CrawlSettings(
    detectors: [
      "notes": true, "money": true, "shares": true, "percent": true, "date": true,
      "number": false, "email": false,
    ],
    customPattern: "",
    paceMs: defaultPaceMs,
    autoRun: false,
    floatOnTop: false
  )

  public init(
    detectors: [String: Bool], customPattern: String, paceMs: Int, autoRun: Bool, floatOnTop: Bool
  ) {
    self.detectors = detectors
    self.customPattern = customPattern
    self.paceMs = paceMs
    self.autoRun = autoRun
    self.floatOnTop = floatOnTop
  }

  public func clamped() -> CrawlSettings {
    var copy = self
    copy.paceMs = min(Self.maxPaceMs, max(Self.minPaceMs, paceMs))
    return copy
  }

  /// Maps the speed slider (0 = slowest, 1 = fastest) to a pace on a log scale.
  public static func pace(fromSlider value: Double) -> Int {
    let clamped = min(1, max(0, value))
    let ratio = Double(minPaceMs) / Double(maxPaceMs)
    return Int((Double(maxPaceMs) * pow(ratio, clamped)).rounded())
  }

  public static func slider(fromPace ms: Int) -> Double {
    let clamped = Double(min(maxPaceMs, max(minPaceMs, ms)))
    let ratio = Double(minPaceMs) / Double(maxPaceMs)
    return log(clamped / Double(maxPaceMs)) / log(ratio)
  }

  /// The JSON `configure` command for the overlay.
  public func configureCommand() throws -> String {
    var all = detectors
    all["custom"] = !customPattern.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    let command = ConfigureCommand(
      cmd: "configure", detectors: all, custom: customPattern, paceMs: clamped().paceMs)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return String(decoding: try encoder.encode(command), as: UTF8.self)
  }
}

private struct ConfigureCommand: Encodable {
  let cmd: String
  let detectors: [String: Bool]
  let custom: String
  let paceMs: Int
}
