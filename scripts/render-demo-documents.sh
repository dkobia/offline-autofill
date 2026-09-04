#!/usr/bin/env bash
# Regenerates the committed demo PDFs from their HTML sources.
# Run after editing demo/documents/src/*.html.
# Requires a Chrome or Chromium binary: set CHROME, or have google-chrome / chromium on PATH,
# or Google Chrome installed in /Applications.
set -euo pipefail

cd "$(dirname "$0")/.."

find_chrome() {
  if [[ -n "${CHROME:-}" ]]; then
    echo "$CHROME"
    return
  fi
  for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return
    fi
  done
  local mac="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [[ -x "$mac" ]]; then
    echo "$mac"
    return
  fi
  echo "no Chrome found: set CHROME to a Chrome or Chromium binary" >&2
  exit 1
}

chrome="$(find_chrome)"

render() {
  local source="$1" target="$2"
  "$chrome" --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
    --print-to-pdf="$target" "file://$PWD/$source" >/dev/null 2>&1
  echo "rendered $target"
}

render demo/documents/src/resume.html demo/documents/Tessa_Marlowe_Resume.pdf
render demo/documents/src/cover-letter.html demo/documents/Tessa_Marlowe_Cover_Letter.pdf
