#!/bin/sh
# Aar Desktop (tar.gz): remove the menu entry, the command link and the
# autostart entry. Settings, conversations and add-ons stay in
# ~/.config/de.aar.ui and ~/.local/share/de.aar.ui; then delete this folder.
set -eu
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
rm -f "$DATA/applications/aar-desktop.desktop" \
  "$DATA/icons/hicolor/128x128/apps/aar-desktop.png" \
  "$DATA/icons/hicolor/32x32/apps/aar-desktop.png" \
  "$CONFIG/autostart/aar-desktop.desktop"
[ -L "$HOME/.local/bin/aar-desktop" ] && rm -f "$HOME/.local/bin/aar-desktop"
echo "Aar was removed from the menu. You can delete this folder now."
