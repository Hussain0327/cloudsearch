import Foundation

/// One figure the spider found. Field names follow `docs/DESKTOP_SPIDER.md`.
public struct FactRecord: Codable, Equatable {
  public let index: Int
  public let id: String
  public let category: String
  public let kind: String
  public let text: String
  public let label: String
  public let value: Double?
  public let unit: String?
  public let context: String

  public init(
    index: Int, id: String, category: String, kind: String, text: String, label: String,
    value: Double?, unit: String?, context: String
  ) {
    self.index = index
    self.id = id
    self.category = category
    self.kind = kind
    self.text = text
    self.label = label
    self.value = value
    self.unit = unit
    self.context = context
  }
}
