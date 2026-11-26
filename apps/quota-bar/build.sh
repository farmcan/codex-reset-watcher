#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"/../..
app="${1:-$PWD/.wrangler/quota-bar/ResetCat Quota Bar.app}"
contents="$app/Contents"
mkdir -p "$contents/MacOS" "$contents/Resources"
cp apps/quota-bar/Info.plist "$contents/Info.plist"
node apps/quota-bar/build-resources.mjs "$contents/Resources"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
sdk="$(xcrun --sdk macosx --show-sdk-path)"
sources=(apps/quota-bar/CodexQuota.swift apps/quota-bar/CodexHistory.swift apps/quota-bar/LoginItem.swift apps/quota-bar/QuotaModel.swift apps/quota-bar/QuotaPanel.swift apps/quota-bar/main.swift)
if [[ "${QUOTA_BAR_UNIVERSAL:-0}" == 1 ]]; then
  for architecture in arm64 x86_64; do
    xcrun swiftc -O -sdk "$sdk" -target "$architecture-apple-macosx14.0" \
      "${sources[@]}" -o "$scratch/QuotaBar-$architecture"
  done
  xcrun lipo -create "$scratch/QuotaBar-arm64" "$scratch/QuotaBar-x86_64" -o "$contents/MacOS/QuotaBar"
else
  MACOSX_DEPLOYMENT_TARGET=14.0 xcrun swiftc -O -sdk "$sdk" "${sources[@]}" -o "$contents/MacOS/QuotaBar"
fi
icon_dir="$scratch"
mkdir "$icon_dir/QuotaCat.iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" public/brand-zh.png --out "$icon_dir/QuotaCat.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" public/brand-zh.png --out "$icon_dir/QuotaCat.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$icon_dir/QuotaCat.iconset" -o "$contents/Resources/QuotaCat.icns"
codesign --force --sign - "$app"
printf '%s\n' "$app"
