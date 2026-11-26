#!/usr/bin/env bash
# Build the Linux packages of Aar Desktop inside the jammy chroot of the WSL
# build VM (one-time setup: setup-linux.sh):
#
#   dist/linux/Aar_<ver>_amd64.AppImage     one file, brings WebKitGTK along
#   dist/linux/Aar-<ver>-1.x86_64.rpm       Fedora, openSUSE, …
#   dist/linux/Aar_<ver>_x86_64.tar.gz      unpack anywhere, ./install.sh
#
# Usage (from Windows):
#   wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/build-linux.sh [--python] [--debug]
#
#   --python  rebuild the bundled aar runtime (from AAR_SRC, default /mnt/b/Github_my/aar)
set -euo pipefail

SRC="${AAR_UI_SRC:-/mnt/b/Github_my/aar_ui}"
AAR_SRC="${AAR_SRC:-/mnt/b/Github_my/aar}"
ROOT="${AARUI_JAMMY:-/srv/aarui-jammy}"
PROFILE=release
PYTHON=0
for a in "$@"; do
  case "$a" in
    --debug) PROFILE=debug ;;
    --python) PYTHON=1 ;;
  esac
done
source "$(dirname "$0")/linux-chroot.sh"
[[ -x "$ROOT/root/.cargo/bin/cargo" ]] || { echo "Build chroot missing: run scripts/wsl/setup-linux.sh first" >&2; exit 1; }

WORK=/root/build/aar_ui          # inside the chroot
echo "==> sync $SRC -> $ROOT$WORK"
mkdir -p "$ROOT$WORK"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude dist-web \
  --exclude src-tauri/target --exclude src-tauri/gen --exclude .git --exclude dist-py \
  "$SRC/" "$ROOT$WORK/"
if [[ $PYTHON == 1 || ! -x "$ROOT$WORK/dist-py/python/bin/python3" ]]; then
  PYTHON=1
  echo "==> sync aar $AAR_SRC"
  rsync -a --delete --exclude .git --exclude .venv --exclude '.*_cache' --exclude __pycache__ \
    --exclude node_modules --exclude .agent --exclude config.json "$AAR_SRC/" "$ROOT/root/build/aar-src/"
fi

chroot_mount "$ROOT"
trap 'chroot_umount "$ROOT"' EXIT

in_chroot "$ROOT" "
set -euo pipefail
source /root/.cargo/env
cd $WORK
echo '==> npm install'
npm ci --no-audit --no-fund
if [[ $PYTHON == 1 ]]; then WORK=$WORK bash scripts/wsl/bundle-python-linux.sh; fi

echo '==> tauri build ($PROFILE, appimage + rpm)'
# linuxdeploy is an AppImage itself: no FUSE in the chroot.
export APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1
ARGS=(build --bundles appimage,rpm)
[[ $PROFILE == debug ]] && ARGS+=(--debug)
npx tauri \"\${ARGS[@]}\"

echo '==> tar.gz'
VERSION=\$(node -p \"require('./src-tauri/tauri.conf.json').version\")
OUT=src-tauri/target/$PROFILE
NAME=Aar_\${VERSION}_x86_64
STAGE=\$(mktemp -d)/\$NAME
mkdir -p \$STAGE/bin \$STAGE/lib/Aar \$STAGE/share/applications \$STAGE/share/icons/hicolor/128x128/apps \$STAGE/share/icons/hicolor/32x32/apps
cp \$OUT/aar-desktop \$STAGE/bin/
cp -a dist-py/python \$STAGE/lib/Aar/
cp src-tauri/icons/128x128.png \$STAGE/share/icons/hicolor/128x128/apps/aar-desktop.png
cp src-tauri/icons/32x32.png \$STAGE/share/icons/hicolor/32x32/apps/aar-desktop.png
cp scripts/linux/aar-desktop.desktop \$STAGE/share/applications/
cp scripts/linux/install.sh scripts/linux/uninstall.sh scripts/linux/README.txt \$STAGE/
chmod +x \$STAGE/install.sh \$STAGE/uninstall.sh \$STAGE/bin/aar-desktop
tar -C \$(dirname \$STAGE) -czf \$OUT/bundle/\$NAME.tar.gz \$NAME
rm -rf \$(dirname \$STAGE)

mkdir -p /root/build/out && rm -f /root/build/out/*
cp \$OUT/bundle/appimage/Aar_\${VERSION}_*.AppImage \$OUT/bundle/rpm/Aar-\${VERSION}-*.rpm \$OUT/bundle/\$NAME.tar.gz /root/build/out/
"

cp "$ROOT$WORK/src-tauri/Cargo.lock" "$SRC/src-tauri/"
cp "$ROOT$WORK/package-lock.json" "$SRC/"
mkdir -p "$SRC/dist/linux"
cp "$ROOT"/root/build/out/* "$SRC/dist/linux/"
echo "==> done:"
ls -la "$SRC/dist/linux"
