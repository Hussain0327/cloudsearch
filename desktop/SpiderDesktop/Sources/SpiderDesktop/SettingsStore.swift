import Foundation
import SpiderDesktopCore

/// Persists the crawl settings and the last URL in `UserDefaults`.
enum SettingsStore {
  private static let settingsKey = "crawlSettings"
  private static let lastURLKey = "lastURL"

  static func load() -> CrawlSettings {
    guard let data = UserDefaults.standard.data(forKey: settingsKey),
      let settings = try? JSONDecoder().decode(CrawlSettings.self, from: data)
    else {
      return .default
    }
    return settings.clamped()
  }

  static func save(_ settings: CrawlSettings) {
    guard let data = try? JSONEncoder().encode(settings) else { return }
    UserDefaults.standard.set(data, forKey: settingsKey)
  }

  static var lastURL: URL? {
    get { UserDefaults.standard.string(forKey: lastURLKey).flatMap { URL(string: $0) } }
    set { UserDefaults.standard.set(newValue?.absoluteString, forKey: lastURLKey) }
  }
}
