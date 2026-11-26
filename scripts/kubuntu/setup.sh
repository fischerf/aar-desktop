#!/usr/bin/env bash
# Turn a fresh Ubuntu WSL distro into a Kubuntu-like test machine for Aar Desktop.
# Runs as root on the first boot (drives still mounted), then isolates the distro:
# no Windows drives, no Windows interop. Packages are copied in from dist/linux.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
DIST=/mnt/b/Github_my/aar_ui/dist/linux

id tester >/dev/null 2>&1 || useradd -m -s /bin/bash -G video,render,audio tester
# No sudo for tester: the agent under test runs commands as this user.

echo "==> apt"
apt-get update -y
apt-get install -y kde-plasma-desktop kde-spectacle xdotool x11-utils imagemagick \
  libwebkit2gtk-4.1-0 libayatana-appindicator3-1 dbus-x11 curl jq
apt-get install -y libfuse2t64 || apt-get install -y libfuse2

echo "==> Aar packages"
mkdir -p /home/tester/aar
cp "$DIST"/Aar_*_amd64.AppImage "$DIST"/Aar_*_x86_64.tar.gz /home/tester/aar/
chmod +x /home/tester/aar/*.AppImage
chown -R tester:tester /home/tester/aar

echo "==> isolate (applies after wsl --terminate)"
cat >/etc/wsl.conf <<'EOF'
[boot]
systemd=true

[user]
default=tester

[automount]
enabled=false
mountFsTab=false

[interop]
enabled=false
appendWindowsPath=false
EOF
plasmashell --version || true
kwin_wayland --version || true
echo OK
