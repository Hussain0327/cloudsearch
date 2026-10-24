import AppKit

let launch = LaunchOptions.parse(Array(CommandLine.arguments.dropFirst()))
if let textURL = launch.selfTestText {
  exit(TextSelfTest.run(textURL: textURL))
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate(launch: launch)
app.delegate = delegate
app.mainMenu = MainMenu.build()
app.run()
