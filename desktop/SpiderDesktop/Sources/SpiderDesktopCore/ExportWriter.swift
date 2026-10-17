import Foundation

/// Writes found facts as CSV (RFC 4180 quoting) or JSON.
public enum ExportWriter {
  public static let csvHeader = "index,id,category,kind,text,label,value,unit,context"

  public static func csv(_ facts: [FactRecord]) -> String {
    var lines = [csvHeader]
    for fact in facts {
      let fields = [
        String(fact.index), fact.id, fact.category, fact.kind, fact.text, fact.label,
        formatValue(fact.value), fact.unit ?? "", fact.context,
      ]
      lines.append(fields.map(csvField).joined(separator: ","))
    }
    return lines.joined(separator: "\n") + "\n"
  }

  public static func json(url: String, title: String, facts: [FactRecord], capturedAt: Date) throws
    -> Data
  {
    let document = ExportDocument(
      url: url,
      title: title,
      capturedAt: ISO8601DateFormatter().string(from: capturedAt),
      facts: facts
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return try encoder.encode(document)
  }

  /// Whole numbers print without a trailing `.0`; nil prints as an empty field.
  static func formatValue(_ value: Double?) -> String {
    guard let value else { return "" }
    if value == value.rounded(), abs(value) < 1e15 {
      return String(Int64(value))
    }
    return String(value)
  }

  static func csvField(_ field: String) -> String {
    let needsQuotes = field.contains(",") || field.contains("\"") || field.contains("\n")
      || field.contains("\r")
    guard needsQuotes else { return field }
    return "\"" + field.replacingOccurrences(of: "\"", with: "\"\"") + "\""
  }
}

private struct ExportDocument: Encodable {
  let url: String
  let title: String
  let capturedAt: String
  let facts: [FactRecord]
}
