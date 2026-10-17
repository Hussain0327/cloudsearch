#!/bin/bash
#
# Wraps the release binary in desktop/build/Spider.app with an Info.plist so it
# can be opened from the Finder and keep its own settings and permissions.

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DESKTOP_DIR="$(dirname "${SCRIPT_DIR}")"
readonly BINARY="${DESKTOP_DIR}/SpiderDesktop/.build/release/SpiderDesktop"
readonly APP_DIR="${DESKTOP_DIR}/build/Spider.app"

function main() {
  if [[ ! -x "${BINARY}" ]]; then
    echo "Release binary not found at ${BINARY}; run 'make desktop-build' first." >&2
    exit 1
  fi

  rm -rf "${APP_DIR}"
  mkdir -p "${APP_DIR}/Contents/MacOS" "${APP_DIR}/Contents/Resources"
  cp "${BINARY}" "${APP_DIR}/Contents/MacOS/Spider"

  cat > "${APP_DIR}/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>Spider</string>
  <key>CFBundleIdentifier</key>
  <string>com.cloudsearch.spider</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Spider</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.developer-tools</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsArbitraryLoadsInWebContent</key>
    <true/>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
PLIST

  # An ad-hoc signature keeps macOS from re-prompting for permissions on every rebuild.
  codesign --force --sign - "${APP_DIR}" >/dev/null 2>&1 || true
  echo "Built ${APP_DIR}"
}

main "$@"
