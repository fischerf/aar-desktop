#!/usr/bin/env bash
# Runs inside a headless Plasma session (started by run-test.sh via
# kwin_wayland --exit-with-session or run-x11.sh). Drives Aar Desktop and takes screenshots.
#   $1 = package to test: appimage | targz
set -u
PKG="${1:-appimage}"
A=/home/tester/aar
S=$A/shots/$PKG
mkdir -p "$S"
log() { echo "[$(date +%T)] $*" | tee -a "$S/test.log"; }
# The headless KWin has no OpenGL (no workspace screenshots): capture Aar's X11 window.
shot() {
  sleep 1
  local w
  w=$(xdotool search --name '^Aar$' 2>/dev/null | head -1)
  if [[ -n "$w" ]]; then
    xwd -id "$w" -silent | convert xwd:- "$S/$1.png" 2>/dev/null
    log "shot $1: $(xdotool getwindowgeometry "$w" | tr '\n' ' ') state=$(xprop -id "$w" _NET_WM_STATE | cut -d= -f2) mapped=$(xwininfo -id "$w" | awk '/Map State/ {print $3}')"
  else
    log "shot $1: no Aar window"
  fi
  # X11 session (Xvfb): the whole screen with panel and tray as well.
  [[ "${AAR_TEST_SESSION:-}" == x11 ]] && import -window root "$S/$1-screen.png" 2>/dev/null
  return 0
}

export XDG_CURRENT_DESKTOP=KDE KDE_FULL_SESSION=true XDG_SESSION_TYPE="${AAR_TEST_SESSION:-wayland}" KDE_SESSION_VERSION=$(plasmashell --version 2>/dev/null | grep -o "[0-9]" | head -1)
log "session: ${AAR_TEST_SESSION:-wayland} WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-} DISPLAY=${DISPLAY:-}"
/usr/lib/x86_64-linux-gnu/libexec/polkit-kde-authentication-agent-1 >/dev/null 2>&1 &
# kded hosts the StatusNotifierWatcher (tray); plasmashell = panel, tray host, notifications.
KDED=$(command -v kded6 || command -v kded5)
"$KDED" >"$S/kded.log" 2>&1 &
sleep 3
plasmashell >"$S/plasmashell.log" 2>&1 &
sleep 20
sni() { dbus-send --session --print-reply --dest=org.kde.StatusNotifierWatcher /StatusNotifierWatcher \
  org.freedesktop.DBus.Properties.Get string:org.kde.StatusNotifierWatcher "string:$1" 2>&1 | tr -s ' \n' ' '; }
log "plasma: $(plasmashell --version 2>/dev/null)"
log "workarea: $(xprop -root _NET_WORKAREA 2>&1)"
log "tray host registered: $(sni IsStatusNotifierHostRegistered)"
log "notifications: $(dbus-send --session --print-reply --dest=org.freedesktop.Notifications /org/freedesktop/Notifications org.freedesktop.Notifications.GetServerInformation 2>&1 | tr -s ' \n' ' ' | cut -c1-120)"

if [[ $PKG == targz ]]; then
  rm -rf "$A/tgz" && mkdir -p "$A/tgz" && tar -xzf "$A"/Aar_*_x86_64.tar.gz -C "$A/tgz"
  sh "$A"/tgz/Aar_*/install.sh | tee -a "$S/test.log"
  APP=("$(ls "$A"/tgz/Aar_*/bin/aar-desktop)")
else
  APP=("$(ls "$A"/Aar_*_amd64.AppImage)")
fi
log "app: ${APP[*]}"

# --- 1. fresh start: setup wizard, mascot bottom right, tray icon -------------
rm -rf ~/.config/de.aar.ui ~/.local/share/de.aar.ui ~/.aar
"${APP[@]}" >"$S/app1.log" 2>&1 &
sleep 30
shot 01-first-start
xwininfo -root -tree 2>/dev/null | grep -i '"Aar"' | tee -a "$S/test.log"
log "tray items: $(sni RegisteredStatusNotifierItems)"
"${APP[@]}" >/dev/null 2>&1 &   # second start = toggle (single instance)
sleep 6
shot 02-second-start-toggles
pkill -f aar-desktop; sleep 3

# --- 2. configured for the host's Ollama: chat round trip --------------------
mkdir -p ~/.config/de.aar.ui
OLLAMA_URL="${OLLAMA_URL:-}"
cat > ~/.config/de.aar.ui/settings.json <<EOF
{"provider": "ollama", "model": "${MODEL:-qwen3.8:latest}", "baseUrl": "$OLLAMA_URL", "language": "de", "autostart": true}
EOF
"${APP[@]}" >"$S/app2.log" 2>&1 &
sleep 30
"${APP[@]}" >/dev/null 2>&1 &   # open the bubble
sleep 6
shot 03-ready
WIN=$(xdotool search --name '^Aar$' 2>/dev/null | head -1)
log "x11 window: ${WIN:-none} $(xdotool getwindowgeometry "$WIN" 2>/dev/null | tr '\n' ' ')"
if [[ -n "$WIN" ]]; then
  xdotool windowactivate --sync "$WIN" 2>/dev/null
  sleep 1
  xdotool type --delay 40 "Sag mir in einem kurzen Satz Hallo."
  xdotool key Return
  log "prompt typed"
  sleep 90
  shot 04-answer
  # Collapse via toggle, then the mascot alone.
  "${APP[@]}" >/dev/null 2>&1 &
  sleep 5
  shot 05-collapsed
fi
ls ~/.local/share/de.aar.ui/rules/ >>"$S/test.log" 2>&1
cp ~/.local/share/de.aar.ui/logs/aar.log "$S/aar.log" 2>/dev/null
cp ~/.config/autostart/aar-desktop.desktop "$S/" 2>/dev/null
pkill -f aar-desktop
sleep 2
log "done"
