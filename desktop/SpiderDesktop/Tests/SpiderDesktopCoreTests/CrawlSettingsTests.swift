import Foundation
import XCTest

@testable import SpiderDesktopCore

final class CrawlSettingsTests: XCTestCase {
  func testDefaultsMatchTheSpec() {
    let settings = CrawlSettings.default
    XCTAssertEqual(settings.paceMs, 350)
    XCTAssertEqual(settings.customPattern, "")
    XCTAssertFalse(settings.autoRun)
    XCTAssertFalse(settings.floatOnTop)
    XCTAssertEqual(
      settings.detectors,
      [
        "notes": true, "money": true, "shares": true, "percent": true, "date": true,
        "number": false, "email": false,
      ])
  }

  func testSliderEndpointsMapToPaceLimits() {
    XCTAssertEqual(CrawlSettings.pace(fromSlider: 0), 1500)
    XCTAssertEqual(CrawlSettings.pace(fromSlider: 1), 60)
    XCTAssertEqual(CrawlSettings.slider(fromPace: 1500), 0, accuracy: 1e-9)
    XCTAssertEqual(CrawlSettings.slider(fromPace: 60), 1, accuracy: 1e-9)
    // Round trip stays within one millisecond.
    XCTAssertEqual(CrawlSettings.pace(fromSlider: CrawlSettings.slider(fromPace: 350)), 350)
  }

  func testPaceIsClamped() {
    var settings = CrawlSettings.default
    settings.paceMs = 5
    XCTAssertEqual(settings.clamped().paceMs, 60)
    settings.paceMs = 99_999
    XCTAssertEqual(settings.clamped().paceMs, 1500)
  }

  func testConfigureCommandEmitsConfigure() throws {
    var settings = CrawlSettings.default
    settings.customPattern = "iPhone, Mac"
    let json = try settings.configureCommand()
    let object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    XCTAssertEqual(object["cmd"] as? String, "configure")
    XCTAssertEqual(object["paceMs"] as? Int, 350)
    XCTAssertEqual(object["custom"] as? String, "iPhone, Mac")
    let detectors = try XCTUnwrap(object["detectors"] as? [String: Bool])
    XCTAssertEqual(detectors["money"], true)
    XCTAssertEqual(detectors["number"], false)
    XCTAssertEqual(detectors["custom"], true, "custom is on whenever a pattern is set")
  }

  func testConfigureCommandTurnsCustomOffWhenPatternIsBlank() throws {
    let json = try CrawlSettings.default.configureCommand()
    let object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    let detectors = try XCTUnwrap(object["detectors"] as? [String: Bool])
    XCTAssertEqual(detectors["custom"], false)
  }
}
