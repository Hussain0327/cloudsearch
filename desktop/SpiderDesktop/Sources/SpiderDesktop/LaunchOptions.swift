import Foundation

struct SelfTestOptions {
  var target: URL
  var timeout: TimeInterval
}

/// Command line: `SpiderDesktop [url-or-path] [--self-test <url-or-path>] [--timeout <seconds>]`.
struct LaunchOptions {
  var initialURL: URL?
  var selfTest: SelfTestOptions?
  var selfTestText: URL?

  static func parse(_ arguments: [String]) -> LaunchOptions {
    var options = LaunchOptions()
    var timeout: TimeInterval = 60
    var index = 0
    while index < arguments.count {
      let argument = arguments[index]
      switch argument {
      case "--self-test":
        if index + 1 < arguments.count {
          options.selfTest = SelfTestOptions(target: resolve(arguments[index + 1]), timeout: timeout)
          index += 1
        }
      case "--self-test-text":
        if index + 1 < arguments.count {
          options.selfTestText = resolve(arguments[index + 1])
          index += 1
        }
      case "--timeout":
        if index + 1 < arguments.count, let seconds = TimeInterval(arguments[index + 1]) {
          timeout = seconds
          index += 1
        }
      default:
        if !argument.hasPrefix("-") {
          options.initialURL = resolve(argument)
        }
      }
      index += 1
    }
    options.selfTest?.timeout = timeout
    return options
  }

  /// A string with a scheme is a URL; anything else is a local file path.
  static func resolve(_ text: String) -> URL {
    if text.contains("://"), let url = URL(string: text) {
      return url
    }
    return URL(fileURLWithPath: (text as NSString).expandingTildeInPath).standardizedFileURL
  }
}
