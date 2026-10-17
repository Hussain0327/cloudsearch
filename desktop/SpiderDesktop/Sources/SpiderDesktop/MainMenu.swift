import AppKit

/// The menu bar. Actions with a nil target travel the responder chain to the
/// window controller, so the shortcuts work whenever the Spider window is key.
enum MainMenu {
  static func build() -> NSMenu {
    let main = NSMenu()
    main.addItem(appMenu())
    main.addItem(editMenu())
    main.addItem(spiderMenu())
    main.addItem(viewMenu())
    main.addItem(windowMenu())
    return main
  }

  private static func appMenu() -> NSMenuItem {
    submenu(
      "Spider",
      [
        item("About Spider", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
        .separator(),
        item("Quit Spider", #selector(NSApplication.terminate(_:)), "q"),
      ])
  }

  private static func editMenu() -> NSMenuItem {
    submenu(
      "Edit",
      [
        item("Undo", Selector(("undo:")), "z"),
        item("Redo", Selector(("redo:")), "Z"),
        .separator(),
        item("Cut", #selector(NSText.cut(_:)), "x"),
        item("Copy", #selector(NSText.copy(_:)), "c"),
        item("Paste", #selector(NSText.paste(_:)), "v"),
        item("Select All", #selector(NSText.selectAll(_:)), "a"),
      ])
  }

  private static func spiderMenu() -> NSMenuItem {
    submenu(
      "Crawl",
      [
        item("Run / Pause", #selector(SpiderWindowController.toggleRun(_:)), "\r"),
        item("Reset", #selector(SpiderWindowController.resetCrawl(_:)), "r", [.command, .shift]),
        item("Export…", #selector(SpiderWindowController.exportFacts(_:)), "e"),
        .separator(),
        item("Float on Top", #selector(SpiderWindowController.toggleFloat(_:)), "f", [.command, .control]),
        item("Auto-run on Load", #selector(SpiderWindowController.toggleAutoRun(_:)), ""),
      ])
  }

  private static func viewMenu() -> NSMenuItem {
    submenu(
      "View",
      [
        item("Open Location…", #selector(SpiderWindowController.focusURL(_:)), "l"),
        item("Reload Page", #selector(SpiderWindowController.reloadPage(_:)), "r"),
        .separator(),
        item("Back", #selector(SpiderWindowController.goBack(_:)), "["),
        item("Forward", #selector(SpiderWindowController.goForward(_:)), "]"),
      ])
  }

  private static func windowMenu() -> NSMenuItem {
    let menuItem = submenu(
      "Window",
      [
        item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
        item("Zoom", #selector(NSWindow.performZoom(_:)), ""),
      ])
    NSApp.windowsMenu = menuItem.submenu
    return menuItem
  }

  private static func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
    let menuItem = NSMenuItem()
    let menu = NSMenu(title: title)
    for entry in items {
      menu.addItem(entry)
    }
    menuItem.submenu = menu
    return menuItem
  }

  private static func item(
    _ title: String, _ action: Selector?, _ key: String,
    _ modifiers: NSEvent.ModifierFlags = [.command]
  ) -> NSMenuItem {
    let menuItem = NSMenuItem(title: title, action: action, keyEquivalent: key)
    menuItem.keyEquivalentModifierMask = modifiers
    return menuItem
  }
}
