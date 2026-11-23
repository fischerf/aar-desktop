#!/usr/bin/env bash
# Build the Windows app + NSIS installer inside the WSL build VM.
#
# The repo on B: is the source of truth. It is rsynced into the VM's native
# filesystem (fast builds, Linux node_modules stay out of the Windows tree),
# built with cargo-xwin for x86_64-pc-windows-msvc, and the results are copied
# back to <repo>/dist/.
#
# Usage (from Windows):
#   wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/build.sh [--debug] [--icons]
set -euo pipefail
source "$HOME/.cargo/env"

SRC="${AAR_UI_SRC:-/mnt/b/Github_my/aar_ui}"
WORK="$HOME/build/aar_ui"
TARGET=x86_64-pc-windows-msvc
PROFILE=release
ICONS=0
PYTHON=0
for a in "$@"; do
  case "$a" in
    --debug) PROFILE=debug ;;
    --icons) ICONS=1 ;;
    --python) PYTHON=1 ;;   # rebuild the bundled aar runtime
  esac
done

echo "==> sync $SRC -> $WORK"
mkdir -p "$WORK"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude dist-web \
  --exclude src-tauri/target --exclude src-tauri/gen --exclude .git --exclude dist-py \
  "$SRC/" "$WORK/"
cd "$WORK"

echo "==> npm install"
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
# Keep the lockfile in the repo.
cp package-lock.json "$SRC/"

if [[ $ICONS == 1 || ! -f src-tauri/icons/icon.ico ]]; then
  echo "==> icons"
  npx tauri icon assets/app-icon.svg -o src-tauri/icons
  mkdir -p "$SRC/src-tauri/icons"
  cp src-tauri/icons/{32x32.png,128x128.png,128x128@2x.png,icon.ico,icon.png} "$SRC/src-tauri/icons/"
fi

if [[ $PYTHON == 1 || ! -f dist-py/python/python.exe ]]; then
  WORK="$WORK" bash "$SRC/scripts/wsl/bundle-python.sh"
fi

echo "==> tauri build ($PROFILE, $TARGET)"
ARGS=(build --runner cargo-xwin --target "$TARGET" --bundles nsis)
[[ $PROFILE == debug ]] && ARGS+=(--debug)
npx tauri "${ARGS[@]}"

cp src-tauri/Cargo.lock "$SRC/src-tauri/"

OUT="src-tauri/target/$TARGET/$PROFILE"
mkdir -p "$SRC/dist"
rm -f "$SRC/dist/Aar.exe"   # old name, shadowed `aar` on PATH lookups
cp "$OUT/aar-desktop.exe" "$SRC/dist/aar-desktop.exe"
cp "$OUT"/bundle/nsis/*.exe "$SRC/dist/"
echo "==> done:"
ls -la "$SRC/dist"
