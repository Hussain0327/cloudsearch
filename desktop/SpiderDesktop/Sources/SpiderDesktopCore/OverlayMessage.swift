import Foundation

/// A message from the overlay. See `docs/DESKTOP_SPIDER.md`, section "Messages".
public enum OverlayMessage: Equatable {
  case ready(url: String, title: String)
  case scanned(total: Int, truncated: Bool, counts: [String: Int])
  case visit(index: Int, total: Int, fact: FactRecord)
  case state(String)
  case facts(url: String, title: String, facts: [FactRecord])
  case error(String)

  /// Parses a `WKScriptMessage.body`; returns nil for anything malformed.
  public static func parse(_ body: Any) -> OverlayMessage? {
    guard let dictionary = body as? [String: Any],
      JSONSerialization.isValidJSONObject(dictionary),
      let data = try? JSONSerialization.data(withJSONObject: dictionary),
      let envelope = try? JSONDecoder().decode(Envelope.self, from: data)
    else {
      return nil
    }
    switch envelope.type {
    case "ready":
      guard let url = envelope.url, let title = envelope.title else { return nil }
      return .ready(url: url, title: title)
    case "scanned":
      guard let total = envelope.total else { return nil }
      return .scanned(total: total, truncated: envelope.truncated ?? false, counts: envelope.counts ?? [:])
    case "visit":
      guard let index = envelope.index, let total = envelope.total, let fact = envelope.fact else {
        return nil
      }
      return .visit(index: index, total: total, fact: fact)
    case "state":
      guard let state = envelope.state else { return nil }
      return .state(state)
    case "facts":
      guard let url = envelope.url, let title = envelope.title, let facts = envelope.facts else {
        return nil
      }
      return .facts(url: url, title: title, facts: facts)
    case "error":
      guard let message = envelope.message else { return nil }
      return .error(message)
    default:
      return nil
    }
  }
}

private struct Envelope: Decodable {
  let type: String
  let url: String?
  let title: String?
  let total: Int?
  let truncated: Bool?
  let counts: [String: Int]?
  let index: Int?
  let fact: FactRecord?
  let state: String?
  let facts: [FactRecord]?
  let message: String?
}
