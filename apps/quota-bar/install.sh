#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
destination="$HOME/Applications/ResetCat Quota Bar.app"
if pgrep -xf "$destination/Contents/MacOS/QuotaBar" >/dev/null; then
  printf '%s\n' 'Quit ResetCat Quota Bar before updating the installed app.' >&2
  exit 1
fi
if [ -e "$destination" ] && [ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$destination/Contents/Info.plist" 2>/dev/null)" != dev.resetcat.quota-bar ]; then
  printf '%s\n' "Unexpected bundle at $destination" >&2
  exit 1
fi
app="$(./build.sh)"
mkdir -p "$HOME/Applications"
ditto "$app" "$destination"
codesign --verify --deep --strict "$destination"
open "$destination"
printf '%s\n' "$destination"
