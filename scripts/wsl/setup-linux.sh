#!/usr/bin/env bash
# One-time setup of the Linux build environment: an Ubuntu 22.04 (jammy)
# chroot inside the WSL build VM. Building there (glibc 2.35, WebKitGTK 4.1)
# keeps the Linux packages runnable on Ubuntu/Kubuntu 22.04+, Debian 12+,
# Fedora 36+ and similar – a build on the VM's 24.04 would need glibc 2.39.
#
# Usage (from Windows):
#   wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/setup-linux.sh
#
# Env: AARUI_JAMMY  chroot directory (default /srv/aarui-jammy)
set -euo pipefail

ROOT="${AARUI_JAMMY:-/srv/aarui-jammy}"
NODE_MAJOR=22
export DEBIAN_FRONTEND=noninteractive
source "$(dirname "$0")/linux-chroot.sh"

if [[ ! -x "$ROOT/bin/bash" ]]; then
  echo "==> debootstrap jammy -> $ROOT"
  command -v debootstrap >/dev/null || { apt-get update -y && apt-get install -y debootstrap; }
  debootstrap --variant=minbase jammy "$ROOT" http://archive.ubuntu.com/ubuntu
fi

chroot_mount "$ROOT"
trap 'chroot_umount "$ROOT"' EXIT

cat >"$ROOT/etc/apt/sources.list" <<'EOF'
deb http://archive.ubuntu.com/ubuntu jammy main universe
deb http://archive.ubuntu.com/ubuntu jammy-updates main universe
deb http://security.ubuntu.com/ubuntu jammy-security main universe
EOF

in_chroot "$ROOT" "
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo '==> apt packages'
apt-get update -y
apt-get install -y --no-install-recommends \
  build-essential curl ca-certificates git pkg-config rsync file xz-utils zstd patchelf \
  libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev \
  libfuse2 squashfs-tools desktop-file-utils

echo '==> Node.js ${NODE_MAJOR}'
if ! command -v node >/dev/null || [[ \"\$(node -v)\" != v${NODE_MAJOR}* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y nodejs
fi

echo '==> Rust'
if [[ ! -x \"\$HOME/.cargo/bin/rustup\" ]]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
source \"\$HOME/.cargo/env\"
rustup update stable

echo '==> versions'
node -v; npm -v; rustc -V; cargo -V; ldd --version | head -1
pkg-config --modversion webkit2gtk-4.1
echo OK
"
