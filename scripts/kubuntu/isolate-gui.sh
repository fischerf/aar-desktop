#!/usr/bin/env bash
# Run as root before every test session: cut the distro off from WSLg, so no
# program can ever open a window on the Windows desktop. Our sessions bring
# their own display (KWin --virtual / Xvfb).
for d in /run/user/*; do rm -f "$d"/wayland-0 "$d"/wayland-0.lock; done
# Without the WSLg/systemd user session the runtime dir may belong to root.
install -d -m 700 -o tester -g tester /run/user/1000
chown tester:tester /run/user/1000 && chmod 700 /run/user/1000
umount /tmp/.X11-unix 2>/dev/null
rm -rf /tmp/.X11-unix && mkdir -m 1777 /tmp/.X11-unix
umount -l /mnt/wslg/runtime-dir 2>/dev/null
umount -l /mnt/wslg 2>/dev/null
# Check: no WSLg sockets reachable any more.
if ls /run/user/*/wayland-0 /mnt/wslg/runtime-dir/wayland-0 /mnt/wslg/.X11-unix/X0 2>/dev/null | grep -q .; then
  echo "WSLG STILL REACHABLE" >&2
  exit 1
fi
echo "isolated from WSLg"
