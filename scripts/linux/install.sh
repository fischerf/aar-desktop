#!/bin/sh
# Aar Desktop (tar.gz): add Aar to the application menu of the current user.
# The program stays in this folder – move the folder first if you want it
# elsewhere, then run ./install.sh again. Remove with ./uninstall.sh.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"

if ! ldconfig -p 2>/dev/null | grep -q 'libwebkit2gtk-4.1.so.0'; then
  echo "WebKitGTK 4.1 is missing. Install it first, e.g.:"
  echo "  Ubuntu/Kubuntu/Debian: sudo apt install libwebkit2gtk-4.1-0 libayatana-appindicator3-1"
  echo "  Fedora:                sudo dnf install webkit2gtk4.1 libayatana-appindicator-gtk3"
  echo "  openSUSE:              sudo zypper install libwebkit2gtk-4_1-0 libayatana-appindicator3-1"
fi

mkdir -p "$DATA/applications" "$DATA/icons/hicolor/128x128/apps" "$DATA/icons/hicolor/32x32/apps" "$HOME/.local/bin"
cp "$DIR/share/icons/hicolor/128x128/apps/aar-desktop.png" "$DATA/icons/hicolor/128x128/apps/"
cp "$DIR/share/icons/hicolor/32x32/apps/aar-desktop.png" "$DATA/icons/hicolor/32x32/apps/"
sed "s|^Exec=.*|Exec=\"$DIR/bin/aar-desktop\"|" "$DIR/share/applications/aar-desktop.desktop" \
  > "$DATA/applications/aar-desktop.desktop"
ln -sf "$DIR/bin/aar-desktop" "$HOME/.local/bin/aar-desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "$DATA/applications" 2>/dev/null || true

echo "Aar is in the application menu now (command: aar-desktop)."
echo "Start it from there or run: \"$DIR/bin/aar-desktop\""
