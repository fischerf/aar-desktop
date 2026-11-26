#!/usr/bin/env bash
# Inner session (run via kwin_wayland --virtual --exit-with-session, see README):
# how does the window geometry evolve when Aar collapses/expands?
A=/home/tester/aar
L=$A/geom.log
: >"$L"
export XDG_CURRENT_DESKTOP=KDE KDE_FULL_SESSION=true XDG_SESSION_TYPE=wayland KDE_SESSION_VERSION=6
plasmashell >/dev/null 2>&1 &
sleep 15
APP=$(ls $A/Aar_*_amd64.AppImage)
mkdir -p ~/.config/de.aar.ui
echo '{"provider":"ollama","model":"qwen3.5:4b","language":"de"}' > ~/.config/de.aar.ui/settings.json
rm -rf ~/.local/share/de.aar.ui
"$APP" >/dev/null 2>&1 &
geo() {
  local w; w=$(xdotool search --name '^Aar$' | head -1)
  echo "[$1] $(xdotool getwindowgeometry "$w" | tr '\n' ' ' | sed 's/  */ /g') | $(xprop -id "$w" WM_NORMAL_HINTS | tr '\n' ' ' | sed 's/  */ /g')" >>"$L"
}
sleep 25; geo "start"
xprop -root | grep -i -E '_NET_WORKAREA|_NET_DESKTOP_GEOMETRY' >>"$L"
xrandr --query 2>&1 | head -3 >>"$L"
"$APP" >/dev/null 2>&1 & sleep 0.5; geo "open+0.5s"; sleep 2; geo "open+2.5s"; sleep 3; geo "open+5.5s"
"$APP" >/dev/null 2>&1 & sleep 0.5; geo "close+0.5s"; sleep 2; geo "close+2.5s"; sleep 3; geo "close+5.5s"
W=$(xdotool search --name '^Aar$' | head -1)
xdotool windowsize "$W" 150 150; sleep 1; geo "xdotool 150"
xdotool windowmove "$W" 1438 838; sleep 1; geo "xdotool move"
cat ~/.config/de.aar.ui/settings.json >>"$L"
pkill -f aar-desktop; sleep 2
