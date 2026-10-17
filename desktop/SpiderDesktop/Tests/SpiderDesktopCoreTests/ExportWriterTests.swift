import Foundation
import XCTest

@testable import SpiderDesktopCore

final class ExportWriterTests: XCTestCase {
  private let notes = FactRecord(
    index: 0,
    id: "f-00000",
    category: "debt",
    kind: "percent",
    text: "3.600% Notes due 2042",
    label: "Notes due 2042",
    value: 3.6,
    unit: "percent",
    context: "our 3.600% Notes due 2042 and"
  )

  func testCSVHeaderMatchesSpecColumns() {
    let csv = ExportWriter.csv([])
    XCTAssertEqual(csv, "index,id,category,kind,text,label,value,unit,context\n")
  }

  func testCSVQuotesCommasQuotesAndNewlines() {
    let tricky = FactRecord(
      index: 1,
      id: "f-00001",
      category: "revenue",
      kind: "money",
      text: "$24.6 billion",
      label: "Net sales, up",
      value: 24_600_000_000,
      unit: "USD",
      context: "He said \"up\", twice\nnext line"
    )
    let lines = ExportWriter.csv([notes, tricky]).split(separator: "\n", omittingEmptySubsequences: false)
    XCTAssertEqual(
      lines[1],
      "0,f-00000,debt,percent,3.600% Notes due 2042,Notes due 2042,3.6,percent,our 3.600% Notes due 2042 and"
    )
    // The newline inside the quoted field splits the line in this crude check; join it back.
    let third = lines[2...3].joined(separator: "\n")
    XCTAssertEqual(
      third,
      "1,f-00001,revenue,money,$24.6 billion,\"Net sales, up\",24600000000,USD,\"He said \"\"up\"\", twice\nnext line\""
    )
  }

  func testCSVLeavesNilValueAndUnitEmpty() {
    let date = FactRecord(
      index: 2, id: "f-00002", category: "other", kind: "date", text: "September 27, 2025",
      label: "Fiscal year end", value: nil, unit: nil, context: "ended September 27, 2025")
    let lines = ExportWriter.csv([date]).split(separator: "\n")
    XCTAssertEqual(
      lines[1], "2,f-00002,other,date,\"September 27, 2025\",Fiscal year end,,,\"ended September 27, 2025\"")
  }

  func testJSONIncludesUrlTitleCapturedAtAndFacts() throws {
    let when = Date(timeIntervalSince1970: 1_760_000_000)
    let data = try ExportWriter.json(
      url: "https://example.com/10k", title: "Example 10-K", facts: [notes], capturedAt: when)
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    XCTAssertEqual(object["url"] as? String, "https://example.com/10k")
    XCTAssertEqual(object["title"] as? String, "Example 10-K")
    XCTAssertEqual(object["capturedAt"] as? String, "2025-10-09T08:53:20Z")
    let facts = try XCTUnwrap(object["facts"] as? [[String: Any]])
    XCTAssertEqual(facts.count, 1)
    XCTAssertEqual(facts[0]["id"] as? String, "f-00000")
    XCTAssertEqual(facts[0]["value"] as? Double, 3.6)
  }
}
