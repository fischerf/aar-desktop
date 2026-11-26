#!/usr/bin/env bash
# Build the self-contained aar runtime for the Linux packages:
# python-build-standalone CPython (relocatable, glibc >= 2.17) + aar + its
# dependencies, installed natively with that Python. Runs inside the jammy
# build chroot (see build-linux.sh).
#
# Output: <work>/dist-py/python/  (bundled by Tauri as resources: lib/Aar/python)
#
# Env:
#   AAR_SRC     aar source tree (default /root/build/aar-src, copied in by build-linux.sh)
#   AAR_EXTRAS  pip extras for aar (default acp,mcp + the cloud provider SDKs)
#   PY_TAG      CPython minor version (default 3.13)
#   PBS_RELEASE python-build-standalone release tag (default: latest)
set -euo pipefail

PY_TAG="${PY_TAG:-3.13}"
AAR_SRC="${AAR_SRC:-/root/build/aar-src}"
AAR_EXTRAS="${AAR_EXTRAS:-acp,mcp,anthropic,openai,gemini}"
WORK="${WORK:-$HOME/build/aar_ui}"
OUT="$WORK/dist-py/python"
CACHE="$HOME/.cache/aar-ui"
ARCH="$(uname -m)"   # x86_64 | aarch64
mkdir -p "$CACHE"
export PIP_ROOT_USER_ACTION=ignore PIP_DISABLE_PIP_VERSION_CHECK=1

echo "==> python-build-standalone CPython $PY_TAG ($ARCH)"
API="https://api.github.com/repos/astral-sh/python-build-standalone/releases"
if [[ -n "${PBS_RELEASE:-}" ]]; then REL="$API/tags/$PBS_RELEASE"; else REL="$API/latest"; fi
# Asset URLs spell the "+" of the version as %2B.
URL="$(curl -fsSL "$REL" | grep -oE "https://[^\"]*/cpython-${PY_TAG//./\\.}\.[0-9]+(\+|%2B)[0-9]+-${ARCH}-unknown-linux-gnu-install_only_stripped\.tar\.gz" | head -1 || true)"
[[ -n "$URL" ]] || { echo "no CPython $PY_TAG build found in $REL" >&2; exit 1; }
TGZ="$CACHE/$(basename "$URL" | sed 's/%2B/+/')"
[[ -f "$TGZ" ]] || curl -fsSL -o "$TGZ" "$URL"
echo "    $(basename "$TGZ")"
rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
tar -xzf "$TGZ" -C "$(dirname "$OUT")"   # unpacks to python/
PY="$OUT/bin/python3"
"$PY" -V

echo "==> aar wheel from $AAR_SRC"
rm -rf "$CACHE/wheels-linux" && mkdir -p "$CACHE/wheels-linux"
"$PY" -m pip wheel -q --no-deps -w "$CACHE/wheels-linux" "$AAR_SRC"
WHEEL="$(ls "$CACHE"/wheels-linux/aar_agent-*.whl | head -1)"
echo "    $(basename "$WHEEL")"

echo "==> dependencies"
# pip + hatchling: Aar Desktop installs extensions and MCP servers at runtime.
# pillow (+ HEIC from phones): photo search (aar_desktop.photos).
"$PY" -m pip install -q --no-warn-script-location "${WHEEL}[${AAR_EXTRAS}]" pip hatchling pillow pillow-heif
if [[ -n "${EXTRA_REQUIREMENTS:-}" ]]; then
  # shellcheck disable=SC2086
  "$PY" -m pip install -q --no-warn-script-location $EXTRA_REQUIREMENTS
fi

# Aar Desktop's own helpers (boot with user extensions, extension/MCP management),
# importable through a .pth file (path relative to site-packages).
SRC_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SITE="$("$PY" -c 'import sysconfig; print(sysconfig.get_path("purelib"))')"
mkdir -p "$OUT/aar-tools"
rsync -a --delete --exclude __pycache__ "$SRC_DIR/python/aar_desktop" "$OUT/aar-tools/"
REL_TOOLS="$(realpath --relative-to="$SITE" "$OUT/aar-tools")"
echo "$REL_TOOLS" > "$SITE/aar-tools.pth"
echo "==> bundled aar_desktop helpers ($REL_TOOLS)"
"$PY" -c 'import aar_desktop.boot, agent.transports.cli; print("    imports ok")'

# Slim down: caches; console scripts carry this build's absolute paths in
# their shebang (the widget always runs `python -m …`).
find "$OUT" -name __pycache__ -type d -prune -exec rm -rf {} +
find "$OUT/bin" -maxdepth 1 \( -type f -o -type l \) ! -name 'python*' -delete
# Tauri refuses dangling symlinks among the resources.
find "$OUT" -xtype l -delete
rm -rf "$OUT/share/man"

echo "==> runtime ready: $(du -sh "$OUT" | cut -f1) in $OUT"
