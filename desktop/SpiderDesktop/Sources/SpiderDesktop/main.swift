import AppKit

let launch = LaunchOptions.parse(Array(CommandLine.arguments.dropFirst()))
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate(launch: launch)
app.delegate = delegate
app.mainMenu = MainMenu.build()
app.run()
