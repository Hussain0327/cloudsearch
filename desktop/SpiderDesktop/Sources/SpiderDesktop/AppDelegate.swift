import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
  private let launch: LaunchOptions
  private var windowController: SpiderWindowController?

  init(launch: LaunchOptions) {
    self.launch = launch
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let controller = SpiderWindowController(settings: SettingsStore.load(), selfTest: launch.selfTest)
    windowController = controller
    controller.showWindow(nil)
    NSApp.activate(ignoringOtherApps: true)

    if let selfTest = launch.selfTest {
      controller.beginSelfTest(selfTest)
    } else if let url = launch.initialURL ?? SettingsStore.lastURL {
      controller.load(url)
    } else {
      controller.focusURL(nil)
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }
}
