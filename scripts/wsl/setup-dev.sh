#!/usr/bin/env bash
# One-time setup of the aar_ui build VM (WSL Ubuntu 24.04).
# Installs Rust, Node, and the cross toolchain to build the Windows app
# (x86_64-pc-windows-msvc via cargo-xwin) plus NSIS for the installer.
#
# Usage (from Windows):
#   wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/setup-dev.sh
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
NODE_MAJOR=22

echo "==> apt packages"
apt-get update -y
apt-get install -y --no-install-recommends \
  build-essential curl ca-certificates git pkg-config rsync unzip \
  clang lld llvm nsis \
  libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev

echo "==> Node.js ${NODE_MAJOR}"
if ! command -v node >/dev/null || [[ "$(node -v)" != v${NODE_MAJOR}* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

echo "==> Rust"
if ! command -v rustup >/dev/null && [[ ! -x "$HOME/.cargo/bin/rustup" ]]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
# shellcheck disable=SC1091
source "$HOME/.cargo/env"
rustup target add x86_64-pc-windows-msvc

echo "==> cargo-xwin"
if ! command -v cargo-xwin >/dev/null; then
  cargo install --locked cargo-xwin
fi

echo "==> versions"
node -v; npm -v; rustc -V; cargo -V; cargo xwin --version; makensis -VERSION
echo "OK"
