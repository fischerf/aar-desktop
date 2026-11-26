#!/usr/bin/env bash
# Plasma X11 session headless (Xvfb + kwin_x11 + kded + plasmashell), then session.sh.
#   bash run-x11.sh appimage|targz
set -u
cd /home/tester/aar
source /home/tester/aar/no-wslg.sh
Xvfb :5 -screen 0 1600x1000x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
XPID=$!
sleep 2
export DISPLAY=:5 AAR_TEST_SESSION=x11
dbus-run-session -- bash -c "kwin_x11 >/tmp/kwin_x11.log 2>&1 & sleep 4; bash /home/tester/aar/session.sh ${1:-appimage}"
kill $XPID 2>/dev/null
