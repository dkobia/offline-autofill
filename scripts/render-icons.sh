#!/usr/bin/env bash
# Regenerates the committed extension icon PNGs from the icon SVG.
# Run after editing images/offline-autofill-icon.svg.
# Requires rsvg-convert (brew install librsvg).
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p images/icons

for size in 16 32 48 128; do
  rsvg-convert -w "$size" -h "$size" images/offline-autofill-icon.svg -o "images/icons/icon-$size.png"
done

echo "rendered images/icons/icon-{16,32,48,128}.png"
