import Foundation
import XCTest

@testable import SpiderDesktopCore

final class OverlayMessageTests: XCTestCase {
  func testParsesReady() {
    let message = OverlayMessage.parse(["type": "ready", "url": "https://a.test/", "title": "A"])
    XCTAssertEqual(message, .ready(url: "https://a.test/", title: "A"))
  }

  func testParsesScannedWithCounts() {
    let message = OverlayMessage.parse([
      "type": "scanned", "total": 3, "truncated": false,
      "counts": ["revenue": 1, "debt": 2],
    ])
    XCTAssertEqual(message, .scanned(total: 3, truncated: false, counts: ["revenue": 1, "debt": 2]))
  }

  func testParsesVisitWithFact() {
    let body: [String: Any] = [
      "type": "visit", "index": 3, "total": 10,
      "fact": [
        "index": 3, "id": "f-00003", "category": "debt", "kind": "percent",
        "text": "3.600% Notes due 2042", "label": "Notes due 2042", "value": 3.6,
        "unit": "percent", "context": "our 3.600% Notes due 2042 and",
      ],
    ]
    let expected = FactRecord(
      index: 3, id: "f-00003", category: "debt", kind: "percent", text: "3.600% Notes due 2042",
      label: "Notes due 2042", value: 3.6, unit: "percent", context: "our 3.600% Notes due 2042 and")
    XCTAssertEqual(OverlayMessage.parse(body), .visit(index: 3, total: 10, fact: expected))
  }

  func testParsesStateFactsAndError() {
    XCTAssertEqual(OverlayMessage.parse(["type": "state", "state": "done"]), .state("done"))
    XCTAssertEqual(
      OverlayMessage.parse(["type": "facts", "url": "u", "title": "t", "facts": []]),
      .facts(url: "u", title: "t", facts: []))
    XCTAssertEqual(OverlayMessage.parse(["type": "error", "message": "bad"]), .error("bad"))
  }

  func testRejectsUnknownOrMalformed() {
    XCTAssertNil(OverlayMessage.parse(["type": "dance"]))
    XCTAssertNil(OverlayMessage.parse("not a dictionary"))
    XCTAssertNil(OverlayMessage.parse(["type": "visit", "index": "three"]))
  }
}
