#!/usr/bin/env bash
set -euo pipefail

# Ensures the Electron binary is present (fixes partial installs / extract-zip failures).
unset ELECTRON_RUN_AS_NODE

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_DIR="$ROOT/node_modules/electron"
VERSION="$(node -p "require('$ELECTRON_DIR/package.json').version")"
DIST="$ELECTRON_DIR/dist"
PATH_FILE="$ELECTRON_DIR/path.txt"

# Where the executable lives inside the unpacked dist, and what the zip in the
# cache is called. Both are platform-specific, and both used to be hardcoded to
# Linux: `path.txt` said "electron" and the cache lookup asked for
# `…-linux-x64.zip`. On a Mac that meant the "already installed" check could
# never pass, so every install wiped `dist/` and re-downloaded, then wrote a
# `path.txt` pointing at a file that does not exist there — leaving `npm
# install` failing on the guard at the bottom of this script.
#
# The mapping mirrors `getPlatformPath()` in Electron's own `install.js`; the
# npm_config_* overrides are honoured for the same reason it honours them, so
# cross-installs still land in the right place.
PLATFORM="$(node -p "process.env.npm_config_platform || process.platform")"
ARCH="$(node -p "process.env.npm_config_arch || process.arch")"

case "$PLATFORM" in
  darwin|mas) PLATFORM_PATH="Electron.app/Contents/MacOS/Electron" ;;
  linux|freebsd|openbsd) PLATFORM_PATH="electron" ;;
  win32) PLATFORM_PATH="electron.exe" ;;
  *) echo "Electron builds are not available on platform: $PLATFORM" >&2; exit 1 ;;
esac

if [[ -x "$DIST/$PLATFORM_PATH" ]] && [[ -f "$PATH_FILE" ]]; then
  echo "Electron $VERSION already installed."
  exit 0
fi

echo "Installing Electron $VERSION binary for $PLATFORM-$ARCH..."

rm -rf "$DIST"
mkdir -p "$DIST"

# `find` exits non-zero when the cache directory does not exist, and under
# `set -euo pipefail` that killed this script silently — the download below was
# never reached. It went unnoticed for as long as the directory always existed:
# up to Electron 41 Electron's own postinstall created and populated it. From
# Electron 42 that download was removed, so on a cold runner there is no
# directory at all, and a cache miss became a build failure. Keep the guard.
CACHE_ZIP=""
if [[ -d "${HOME}/.cache/electron" ]]; then
  CACHE_ZIP=$(find "${HOME}/.cache/electron" -name "electron-v${VERSION}-${PLATFORM}-${ARCH}.zip" 2>/dev/null | head -1 || true)
fi

if [[ -z "$CACHE_ZIP" ]]; then
  echo "Not in ${HOME}/.cache/electron; downloading."
  # install.js writes path.txt itself, and on a Mac running x64 Node under
  # Rosetta it also upgrades the download to arm64 — so let it have the last
  # word rather than re-deriving anything here.
  node "$ELECTRON_DIR/install.js"
else
  echo "Found $CACHE_ZIP; unpacking."
  unzip -q -o "$CACHE_ZIP" -d "$DIST"
  printf '%s' "$PLATFORM_PATH" > "$PATH_FILE"
fi

if [[ ! -x "$DIST/$PLATFORM_PATH" ]]; then
  echo "Electron binary missing after install (expected $DIST/$PLATFORM_PATH)." >&2
  exit 1
fi

echo "Electron $VERSION ready at $DIST/$PLATFORM_PATH"
