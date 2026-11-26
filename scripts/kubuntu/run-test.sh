#!/usr/bin/env bash
# Start a Plasma 6 Wayland session headless (KWin virtual backend: real compositor
# with XWayland, renders off-screen) and run session.sh in it.
#   bash run-test.sh appimage|targz
set -u
cd /home/tester/aar
source /home/tester/aar/no-wslg.sh
export KWIN_SCREENSHOT_NO_PERMISSION_CHECKS=1
exec dbus-run-session -- kwin_wayland --virtual --xwayland --width 1600 --height 1000 \
  --exit-with-session "/home/tester/aar/session.sh ${1:-appimage}"
