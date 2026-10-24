import Foundation
import JavaScriptCore
import SpiderDesktopCore

/// Runs the overlay's detectors over plain text by evaluating the DOM-free
/// `TextCoreScript` bundle in JavaScriptCore, so there is one copy of the regexes.
final class TextExtractor {
  struct Result: Decodable {
    let facts: [FactRecord]
    let truncated: Bool
    let error: String?
  }

  enum Failure: Error {
    case script(String)
    case missingResult
  }

  // JSContext is not thread safe; every touch goes through this queue.
  private let queue = DispatchQueue(label: "spider.text-extractor")
  private let context: JSContext
  private var lastException: String?

  init() throws {
    guard let context = JSContext() else { throw Failure.script("no JSContext") }
    self.context = context
    context.exceptionHandler = { [weak self] _, exception in
      self?.lastException = exception?.toString()
    }
    context.evaluateScript(TextCoreScript.source)
    if let message = lastException { throw Failure.script(message) }
  }

  /// `configJSON` is `{detectors, custom}`, the shape `CrawlSettings.configureCommand()` emits.
  func extract(text: String, configJSON: String) throws -> Result {
    try queue.sync {
      lastException = nil
      let function = context.objectForKeyedSubscript("SpiderText")?.objectForKeyedSubscript("extract")
      let value = function?.call(withArguments: [text, configJSON])
      if let message = lastException { throw Failure.script(message) }
      guard let json = value?.toString(), value?.isString == true else { throw Failure.missingResult }
      return try JSONDecoder().decode(Result.self, from: Data(json.utf8))
    }
  }
}

/// `SpiderDesktop --self-test-text <capture.txt>`: extracts from the text and compares
/// with `<capture>.expected.json` (the golden file the node test also checks).
enum TextSelfTest {
  private struct Golden: Decodable {
    let facts: [FactRecord]
  }

  /// Returns the process exit code.
  static func run(textURL: URL) -> Int32 {
    let goldenURL = textURL.deletingPathExtension().appendingPathExtension("expected.json")
    do {
      let text = try String(contentsOf: textURL, encoding: .utf8)
      let goldenData = try Data(contentsOf: goldenURL)
      let configJSON = try configFrom(goldenData)
      let expected = try JSONDecoder().decode(Golden.self, from: goldenData).facts
      let actual = try TextExtractor().extract(text: text, configJSON: configJSON).facts
      let ok = actual == expected
      print("{\"selfTestText\":\"\(ok ? "pass" : "fail")\",\"facts\":\(actual.count),\"expected\":\(expected.count)}")
      if !ok {
        FileHandle.standardError.write(Data("text self-test mismatch\nactual: \(actual)\nexpected: \(expected)\n".utf8))
      }
      return ok ? 0 : 1
    } catch {
      FileHandle.standardError.write(Data("text self-test error: \(error)\n".utf8))
      return 1
    }
  }

  private static func configFrom(_ data: Data) throws -> String {
    let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    guard let config = object?["config"] else { throw TextExtractor.Failure.missingResult }
    return String(decoding: try JSONSerialization.data(withJSONObject: config), as: UTF8.self)
  }
}
