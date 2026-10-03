#!/bin/sh
# Installs Dalliance on a Mac:
#
#   curl -fsSL https://dalliance.io/install.sh | sh
#
# curl doesn't quarantine what it downloads, so macOS opens the app without the unidentified developer warning.
# Everything runs inside main(), so a download of this script that stops halfway runs nothing.
set -eu

main() {
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "Dalliance runs on macOS only." >&2
    exit 1
  fi
  if pgrep -xq Dalliance; then
    echo "Quit Dalliance, then run this again." >&2
    exit 1
  fi

  # /Applications, or the user's own Applications folder when they can't write to it
  apps=/Applications
  if [ ! -w "$apps" ]; then
    apps="$HOME/Applications"
    mkdir -p "$apps"
  fi

  tmp=$(mktemp -d)
  trap 'hdiutil detach -quiet "$tmp/volume" 2>/dev/null || true; rm -rf "$tmp"' EXIT

  echo "Downloading Dalliance..."
  curl -fL --progress-bar -o "$tmp/Dalliance.dmg" "https://dalliance.io/download?from=install"
  hdiutil attach -quiet -nobrowse -readonly -noautoopen -mountpoint "$tmp/volume" "$tmp/Dalliance.dmg"

  # Replace, never merge: files left over from an older version would break the app's signature
  rm -rf "$apps/Dalliance.app"
  ditto "$tmp/volume/Dalliance.app" "$apps/Dalliance.app"
  echo "Installed Dalliance in $apps."
}

main "$@"
