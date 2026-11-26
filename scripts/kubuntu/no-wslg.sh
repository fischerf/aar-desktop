# Sourced at the top of every test runner (as tester), before any display is
# started: never talk to WSLg, so nothing can open a window on the Windows
# desktop. Uses a private runtime dir (WSL recreates /run/user/<uid> with the
# WSLg socket links on every login). Exits if WSLg is still reachable.
unset WAYLAND_DISPLAY DISPLAY PULSE_SERVER
export XDG_RUNTIME_DIR="/tmp/aar-xdg-$(id -u)"
rm -rf "$XDG_RUNTIME_DIR" && mkdir -m 700 "$XDG_RUNTIME_DIR"
if [ ! -k /tmp/.X11-unix ]; then
  echo "ABORT: /tmp/.X11-unix is still WSLg's - run isolate-gui.sh as root first" >&2; exit 1
fi
if [ -e /tmp/.X11-unix/X0 ]; then
  echo "ABORT: an X server on :0 exists before the test (WSLg?)" >&2; exit 1
fi
if [ -e /mnt/wslg/runtime-dir/wayland-0 ]; then
  echo "ABORT: /mnt/wslg still mounted - run isolate-gui.sh as root first" >&2; exit 1
fi
echo "no-wslg: ok ($XDG_RUNTIME_DIR)"
