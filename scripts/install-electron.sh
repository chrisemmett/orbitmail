#!/usr/bin/env bash
set -euo pipefail

# Ensures the Electron binary is present (fixes partial installs / extract-zip failures).
unset ELECTRON_RUN_AS_NODE

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_DIR="$ROOT/node_modules/electron"
VERSION="$(node -p "require('$ELECTRON_DIR/package.json').version")"
DIST="$ELECTRON_DIR/dist"
PATH_FILE="$ELECTRON_DIR/path.txt"

# Where the binary lands inside dist/, and what the download is called, both
# vary by platform. This script hardcoded the Linux answers to all three, and on
# macOS that was not a graceful degradation: `node install.js` downloaded the
# right zip, the executable check then looked for `dist/electron` — which only
# exists on Linux — and the script exited 1, taking `npm install` with it. Ask
# Node what platform this is rather than assuming.
PLATFORM="$(node -p 'process.platform')"
ARCH="$(node -p 'process.arch')"

case "$PLATFORM" in
  darwin) PLATFORM_PATH="Electron.app/Contents/MacOS/Electron" ;;
  win32)  PLATFORM_PATH="electron.exe" ;;
  *)      PLATFORM_PATH="electron" ;;
esac

# Where @electron/get keeps downloaded zips, which is also what CI caches. The
# fast path below is only a fast path — install.js reads this same cache itself,
# so getting it wrong costs a re-download at worst, never correctness. Which is
# exactly why it is worth deriving rather than assuming: a silently-never-hit
# cache lookup looks identical to a working one.
case "$PLATFORM" in
  darwin) CACHE_DIR="${HOME}/Library/Caches/electron" ;;
  win32)  CACHE_DIR="${LOCALAPPDATA:-${HOME}/AppData/Local}/electron/Cache" ;;
  *)      CACHE_DIR="${XDG_CACHE_HOME:-${HOME}/.cache}/electron" ;;
esac

if [[ -x "$DIST/$PLATFORM_PATH" ]] && [[ -f "$PATH_FILE" ]]; then
  echo "Electron $VERSION already installed."
  exit 0
fi

echo "Installing Electron $VERSION binary for ${PLATFORM}-${ARCH}..."

rm -rf "$DIST"
mkdir -p "$DIST"

# `find` exits non-zero when the cache directory does not exist, and under
# `set -euo pipefail` that killed this script silently — the download below was
# never reached. It went unnoticed for as long as the directory always existed:
# up to Electron 41 Electron's own postinstall created and populated it. From
# Electron 42 that download was removed, so on a cold runner there is no
# directory at all, and a cache miss became a build failure. Keep the guard.
CACHE_ZIP=""
if [[ -d "$CACHE_DIR" ]]; then
  CACHE_ZIP=$(find "$CACHE_DIR" -name "electron-v${VERSION}-${PLATFORM}-${ARCH}.zip" 2>/dev/null | head -1 || true)
fi

if [[ -z "$CACHE_ZIP" ]]; then
  echo "Not in ${CACHE_DIR}; downloading."
  node "$ELECTRON_DIR/install.js"
else
  echo "Found $CACHE_ZIP; unpacking."
  unzip -q -o "$CACHE_ZIP" -d "$DIST"
fi

printf '%s' "$PLATFORM_PATH" > "$PATH_FILE"

if [[ ! -x "$DIST/$PLATFORM_PATH" ]]; then
  echo "Electron binary missing after install." >&2
  exit 1
fi

echo "Electron $VERSION ready at $DIST/$PLATFORM_PATH"
