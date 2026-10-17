import AppKit
import SpiderDesktopCore
import UniformTypeIdentifiers
import WebKit

/// Forwards script messages without the user content controller retaining the window controller.
private final class ScriptMessageProxy: NSObject, WKScriptMessageHandler {
  weak var target: SpiderWindowController?

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    target?.handle(message.body)
  }
}

/// The one window: a two-row control bar over a `WKWebView` with the overlay injected.
final class SpiderWindowController: NSWindowController, NSWindowDelegate, NSTextFieldDelegate,
  WKNavigationDelegate, WKUIDelegate
{
  private static let worldName = "cloudsearch-spider"
  private static let handlerName = "spider"

  private let world: WKContentWorld
  private let webView: WKWebView
  private let messageProxy = ScriptMessageProxy()
  private var settings: CrawlSettings
  private var selfTest: SelfTestOptions?
  private var selfTestFinished = false

  private var crawlState = "idle"
  private var total = 0
  private var counts: [String: Int] = [:]
  private var visited = Set<Int>()

  // Row 1
  private let backButton = NSButton(title: "‹", target: nil, action: nil)
  private let forwardButton = NSButton(title: "›", target: nil, action: nil)
  private let reloadButton = NSButton(title: "⟳", target: nil, action: nil)
  private let urlField = NSTextField(string: "")
  private let floatCheck = NSButton(checkboxWithTitle: "Float on top", target: nil, action: nil)
  private let autoRunCheck = NSButton(checkboxWithTitle: "Auto-run", target: nil, action: nil)

  // Row 2
  private let runButton = NSButton(title: "Run", target: nil, action: nil)
  private let resetButton = NSButton(title: "Reset", target: nil, action: nil)
  private let speedTitle = NSTextField(labelWithString: "Speed")
  private let speedSlider = NSSlider(value: 0, minValue: 0, maxValue: 1, target: nil, action: nil)
  private let speedLabel = NSTextField(labelWithString: "350 ms")
  private let getPopup = NSPopUpButton(frame: .zero, pullsDown: true)
  private let customField = NSTextField(string: "")
  private let statusLabel = NSTextField(labelWithString: "idle")
  private let exportButton = NSButton(title: "Export…", target: nil, action: nil)

  init(settings: CrawlSettings, selfTest: SelfTestOptions?) {
    self.settings = settings
    self.selfTest = selfTest

    let world = WKContentWorld.world(name: Self.worldName)
    self.world = world
    let configuration = WKWebViewConfiguration()
    configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
    configuration.userContentController.addUserScript(
      WKUserScript(
        source: OverlayScript.source, injectionTime: .atDocumentEnd, forMainFrameOnly: true,
        in: world))
    webView = WKWebView(frame: .zero, configuration: configuration)

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Spider"
    window.setFrameAutosaveName("SpiderMain")
    window.center()
    super.init(window: window)

    window.delegate = self
    messageProxy.target = self
    configuration.userContentController.add(messageProxy, contentWorld: world, name: Self.handlerName)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true

    guard let contentView = window.contentView else { return }
    buildLayout(in: contentView)
    wireControls()
    applySettingsToControls()
    applyFloat()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("SpiderWindowController is created in code")
  }

  // MARK: - Layout

  private func buildLayout(in contentView: NSView) {
    urlField.placeholderString = "Enter a URL and press Return"
    urlField.setContentHuggingPriority(.defaultLow, for: .horizontal)
    urlField.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    customField.placeholderString = "custom: words, or /regex/"
    customField.setContentHuggingPriority(.defaultLow, for: .horizontal)
    customField.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    speedSlider.isContinuous = true
    speedSlider.widthAnchor.constraint(equalToConstant: 140).isActive = true
    speedLabel.font = .monospacedDigitSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular)
    speedLabel.widthAnchor.constraint(equalToConstant: 56).isActive = true
    statusLabel.font = .monospacedDigitSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular)
    statusLabel.textColor = .secondaryLabelColor
    statusLabel.lineBreakMode = .byTruncatingTail
    statusLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    for button in [backButton, forwardButton, reloadButton, runButton, resetButton, exportButton] {
      button.bezelStyle = .rounded
    }
    runButton.keyEquivalent = ""

    getPopup.addItem(withTitle: "Get")
    for name in CrawlSettings.detectorNames {
      let item = NSMenuItem(
        title: CrawlSettings.detectorTitles[name] ?? name,
        action: #selector(toggleDetector(_:)),
        keyEquivalent: ""
      )
      item.target = self
      item.representedObject = name
      getPopup.menu?.addItem(item)
    }

    let row1 = NSStackView(views: [backButton, forwardButton, reloadButton, urlField, floatCheck, autoRunCheck])
    let row2 = NSStackView(views: [
      runButton, resetButton, speedTitle, speedSlider, speedLabel, getPopup, customField, statusLabel,
      exportButton,
    ])
    for row in [row1, row2] {
      row.orientation = .horizontal
      row.spacing = 8
      row.alignment = .centerY
      row.distribution = .fill
    }

    let bar = NSStackView(views: [row1, row2])
    bar.orientation = .vertical
    bar.alignment = .width
    bar.spacing = 6
    bar.edgeInsets = NSEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)

    let effect = NSVisualEffectView()
    effect.material = .headerView
    effect.blendingMode = .withinWindow
    effect.state = .active
    effect.translatesAutoresizingMaskIntoConstraints = false
    bar.translatesAutoresizingMaskIntoConstraints = false
    effect.addSubview(bar)

    let separator = NSBox()
    separator.boxType = .separator
    separator.translatesAutoresizingMaskIntoConstraints = false

    webView.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(effect)
    contentView.addSubview(separator)
    contentView.addSubview(webView)

    NSLayoutConstraint.activate([
      bar.topAnchor.constraint(equalTo: effect.topAnchor),
      bar.bottomAnchor.constraint(equalTo: effect.bottomAnchor),
      bar.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
      bar.trailingAnchor.constraint(equalTo: effect.trailingAnchor),

      effect.topAnchor.constraint(equalTo: contentView.topAnchor),
      effect.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
      effect.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),

      separator.topAnchor.constraint(equalTo: effect.bottomAnchor),
      separator.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
      separator.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),

      webView.topAnchor.constraint(equalTo: separator.bottomAnchor),
      webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      webView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
    ])
  }

  private func wireControls() {
    backButton.target = self
    backButton.action = #selector(goBack(_:))
    forwardButton.target = self
    forwardButton.action = #selector(goForward(_:))
    reloadButton.target = self
    reloadButton.action = #selector(reloadPage(_:))
    urlField.target = self
    urlField.action = #selector(loadFromField(_:))
    floatCheck.target = self
    floatCheck.action = #selector(toggleFloat(_:))
    autoRunCheck.target = self
    autoRunCheck.action = #selector(toggleAutoRun(_:))
    runButton.target = self
    runButton.action = #selector(toggleRun(_:))
    resetButton.target = self
    resetButton.action = #selector(resetCrawl(_:))
    speedSlider.target = self
    speedSlider.action = #selector(speedChanged(_:))
    customField.delegate = self
    exportButton.target = self
    exportButton.action = #selector(exportFacts(_:))
  }

  private func applySettingsToControls() {
    speedSlider.doubleValue = CrawlSettings.slider(fromPace: settings.paceMs)
    speedLabel.stringValue = "\(settings.paceMs) ms"
    customField.stringValue = settings.customPattern
    autoRunCheck.state = settings.autoRun ? .on : .off
    floatCheck.state = settings.floatOnTop ? .on : .off
    for item in getPopup.itemArray {
      guard let name = item.representedObject as? String else { continue }
      item.state = settings.detectors[name] == true ? .on : .off
    }
  }

  // MARK: - Navigation

  func load(_ url: URL) {
    urlField.stringValue = url.absoluteString
    if url.isFileURL {
      webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    } else {
      webView.load(URLRequest(url: url))
    }
  }

  @objc func loadFromField(_ sender: Any?) {
    var text = urlField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    if !text.contains("://") {
      text = "https://" + text
    }
    guard let url = URL(string: text) else {
      updateStatus("Not a URL")
      return
    }
    load(url)
    window?.makeFirstResponder(webView)
  }

  @objc func focusURL(_ sender: Any?) {
    window?.makeFirstResponder(urlField)
    urlField.selectText(nil)
  }

  @objc func reloadPage(_ sender: Any?) {
    webView.reload()
  }

  @objc func goBack(_ sender: Any?) {
    webView.goBack()
  }

  @objc func goForward(_ sender: Any?) {
    webView.goForward()
  }

  // MARK: - Crawl controls

  @objc func toggleRun(_ sender: Any?) {
    send(crawlState == "running" ? #"{"cmd":"pause"}"# : #"{"cmd":"run"}"#)
  }

  @objc func resetCrawl(_ sender: Any?) {
    send(#"{"cmd":"reset"}"#)
    visited.removeAll()
    updateStatus("idle")
  }

  @objc func speedChanged(_ sender: Any?) {
    settings.paceMs = CrawlSettings.pace(fromSlider: speedSlider.doubleValue)
    speedLabel.stringValue = "\(settings.paceMs) ms"
    SettingsStore.save(settings)
    send(#"{"cmd":"setPace","paceMs":\#(settings.paceMs)}"#)
  }

  @objc func toggleDetector(_ sender: NSMenuItem) {
    guard let name = sender.representedObject as? String else { return }
    let enabled = sender.state != .on
    sender.state = enabled ? .on : .off
    settings.detectors[name] = enabled
    SettingsStore.save(settings)
    sendConfigure()
  }

  @objc func toggleFloat(_ sender: Any?) {
    settings.floatOnTop.toggle()
    SettingsStore.save(settings)
    applyFloat()
  }

  @objc func toggleAutoRun(_ sender: Any?) {
    settings.autoRun.toggle()
    autoRunCheck.state = settings.autoRun ? .on : .off
    SettingsStore.save(settings)
  }

  @objc func exportFacts(_ sender: Any?) {
    send(#"{"cmd":"export"}"#)
  }

  /// The custom pattern applies when editing ends (Return or focus change).
  func controlTextDidEndEditing(_ notification: Notification) {
    guard (notification.object as? NSTextField) === customField else { return }
    let pattern = customField.stringValue
    guard pattern != settings.customPattern else { return }
    settings.customPattern = pattern
    SettingsStore.save(settings)
    sendConfigure()
  }

  private func applyFloat() {
    guard let window else { return }
    window.level = settings.floatOnTop ? .floating : .normal
    window.collectionBehavior = settings.floatOnTop ? [.canJoinAllSpaces, .fullScreenAuxiliary] : []
    floatCheck.state = settings.floatOnTop ? .on : .off
  }

  private func sendConfigure() {
    guard let command = try? settings.configureCommand() else { return }
    visited.removeAll()
    send(command)
  }

  /// Evaluates `window.__spider.command(<json>)` in the overlay's content world.
  private func send(_ json: String) {
    guard let literal = try? JSONEncoder().encode(json) else { return }
    let script = "window.__spider && window.__spider.command(\(String(decoding: literal, as: UTF8.self)));"
    webView.evaluateJavaScript(script, in: nil, in: world) { result in
      if case .failure(let error) = result {
        NSLog("spider command failed: %@", String(describing: error))
      }
    }
  }

  // MARK: - Messages from the overlay

  func handle(_ body: Any) {
    guard let message = OverlayMessage.parse(body) else { return }
    switch message {
    case .ready:
      visited.removeAll()
      total = 0
      counts = [:]
      updateStatus("ready")
      if selfTest != nil {
        var everything = CrawlSettings.default
        for name in CrawlSettings.detectorNames {
          everything.detectors[name] = true
        }
        everything.paceMs = CrawlSettings.minPaceMs
        if let command = try? everything.configureCommand() {
          send(command)
        }
        send(#"{"cmd":"run"}"#)
      } else if settings.autoRun {
        sendConfigure()
        send(#"{"cmd":"run"}"#)
      }
    case .scanned(let total, let truncated, let counts):
      self.total = total
      self.counts = counts
      updateStatus(truncated ? "Found 0 of \(total)+ (capped)" : "Found 0 of \(total)")
    case .visit(let index, let total, _):
      self.total = total
      visited.insert(index)
      updateStatus("Found \(visited.count) of \(total)")
    case .state(let state):
      crawlState = state
      runButton.title = state == "running" ? "Pause" : "Run"
      if state == "done" {
        updateStatus("Done · \(visited.count) of \(total)")
        finishSelfTest()
      } else if state == "paused" {
        updateStatus("Paused · \(visited.count) of \(total)")
      }
    case .facts(let url, let title, let facts):
      saveExport(url: url, title: title, facts: facts)
    case .error(let message):
      updateStatus("Error: \(message)")
      failSelfTest(message)
    }
  }

  private func updateStatus(_ text: String) {
    statusLabel.stringValue = text
  }

  // MARK: - Export

  private func saveExport(url: String, title: String, facts: [FactRecord]) {
    guard let window else { return }
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.json, .commaSeparatedText]
    panel.canSelectHiddenExtension = true
    panel.nameFieldStringValue = "spider-facts.json"
    panel.beginSheetModal(for: window) { [weak self] response in
      guard response == .OK, let target = panel.url else { return }
      do {
        let data: Data
        if target.pathExtension.lowercased() == "csv" {
          data = Data(ExportWriter.csv(facts).utf8)
        } else {
          data = try ExportWriter.json(url: url, title: title, facts: facts, capturedAt: Date())
        }
        try data.write(to: target)
        self?.updateStatus("Exported \(facts.count) facts")
      } catch {
        self?.updateStatus("Export failed: \(error.localizedDescription)")
      }
    }
  }

  // MARK: - Self-test

  func beginSelfTest(_ options: SelfTestOptions) {
    selfTest = options
    load(options.target)
    DispatchQueue.main.asyncAfter(deadline: .now() + options.timeout) { [weak self] in
      self?.failSelfTest("timed out after \(Int(options.timeout))s")
    }
  }

  private func finishSelfTest() {
    guard selfTest != nil, !selfTestFinished else { return }
    selfTestFinished = true
    let report: [String: Any] = [
      "url": webView.url?.absoluteString ?? "",
      "total": total,
      "counts": counts,
      "visited": visited.count,
    ]
    if let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]) {
      print(String(decoding: data, as: UTF8.self))
    }
    exit(total > 0 && visited.count == total ? 0 : 1)
  }

  private func failSelfTest(_ reason: String) {
    guard selfTest != nil, !selfTestFinished else { return }
    selfTestFinished = true
    FileHandle.standardError.write(Data("self-test failed: \(reason)\n".utf8))
    exit(1)
  }

  // MARK: - WKNavigationDelegate

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    urlField.stringValue = webView.url?.absoluteString ?? ""
    if let title = webView.title, !title.isEmpty {
      window?.title = "\(title) — Spider"
    } else {
      window?.title = "Spider"
    }
    if selfTest == nil, let url = webView.url, !url.isFileURL {
      SettingsStore.lastURL = url
    }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    updateStatus("Failed: \(error.localizedDescription)")
    failSelfTest(error.localizedDescription)
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
  ) {
    updateStatus("Failed: \(error.localizedDescription)")
    failSelfTest(error.localizedDescription)
  }

  // MARK: - WKUIDelegate

  /// Links that ask for a new window open in this one instead.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url {
      webView.load(URLRequest(url: url))
    }
    return nil
  }
}
