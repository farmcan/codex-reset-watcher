#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"/../..
app="${1:-$PWD/.wrangler/quota-bar/ResetCat Quota Bar.app}"
contents="$app/Contents"
mkdir -p "$contents/MacOS" "$contents/Resources"
cp apps/quota-bar/Info.plist "$contents/Info.plist"
node apps/quota-bar/build-resources.mjs "$contents/Resources"
MACOSX_DEPLOYMENT_TARGET=14.0 xcrun swiftc -O -sdk "$(xcrun --sdk macosx --show-sdk-path)" \
  apps/quota-bar/QuotaModel.swift apps/quota-bar/QuotaPanel.swift apps/quota-bar/main.swift \
  -o "$contents/MacOS/QuotaBar"
icon_dir="$(mktemp -d)"
trap 'rm -rf "$icon_dir"' EXIT
mkdir "$icon_dir/QuotaCat.iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" public/brand-zh.png --out "$icon_dir/QuotaCat.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" public/brand-zh.png --out "$icon_dir/QuotaCat.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$icon_dir/QuotaCat.iconset" -o "$contents/Resources/QuotaCat.icns"
codesign --force --sign - "$app"
printf '%s\n' "$app"
