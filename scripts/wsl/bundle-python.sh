#!/usr/bin/env bash
# Build the self-contained aar runtime that ships inside the installer:
# Windows "embeddable" CPython + aar + its dependencies (Windows wheels),
# assembled on Linux via `pip install --platform win_amd64`.
#
# Output: <work>/dist-py/python/  (bundled by Tauri as resources/python)
#
#   wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/bundle-python.sh
#
# Env:
#   AAR_SRC     aar source tree (default /mnt/b/Github_my/aar) – only read, never modified
#   AAR_EXTRAS  pip extras for aar (default acp,mcp,windows + the cloud provider SDKs)
#   PY_VERSION  embeddable CPython version (default 3.13.12)
set -euo pipefail

PY_VERSION="${PY_VERSION:-3.13.12}"
PY_TAG="$(echo "$PY_VERSION" | cut -d. -f1,2)"          # 3.13
PY_NODOT="$(echo "$PY_TAG" | tr -d .)"                  # 313
AAR_SRC="${AAR_SRC:-/mnt/b/Github_my/aar}"
AAR_EXTRAS="${AAR_EXTRAS:-acp,mcp,windows,anthropic,openai,gemini}"
WORK="${WORK:-$HOME/build/aar_ui}"
OUT="$WORK/dist-py/python"
CACHE="$HOME/.cache/aar-ui"
mkdir -p "$CACHE"

echo "==> embeddable Python $PY_VERSION"
ZIP="$CACHE/python-$PY_VERSION-embed-amd64.zip"
[[ -f "$ZIP" ]] || curl -fsSL -o "$ZIP" "https://www.python.org/ftp/python/$PY_VERSION/python-$PY_VERSION-embed-amd64.zip"
rm -rf "$OUT"
mkdir -p "$OUT"
unzip -q "$ZIP" -d "$OUT"

# Enable site-packages in the embeddable distribution.
PTH="$OUT/python${PY_NODOT}._pth"
sed -i 's/^#\s*import site/import site/' "$PTH"
grep -q '^Lib\\site-packages' "$PTH" || printf 'Lib\\site-packages\r\n' >> "$PTH"
mkdir -p "$OUT/Lib/site-packages"

echo "==> aar wheel from $AAR_SRC"
SRC_COPY="$(mktemp -d)"
trap 'rm -rf "$SRC_COPY"' EXIT
rsync -a --exclude .git --exclude .venv --exclude '.*_cache' --exclude __pycache__ \
  --exclude node_modules --exclude .agent "$AAR_SRC/" "$SRC_COPY/aar/"
rm -rf "$CACHE/wheels" && mkdir -p "$CACHE/wheels"
python3 -m pip wheel -q --no-deps -w "$CACHE/wheels" "$SRC_COPY/aar"
WHEEL="$(ls "$CACHE"/wheels/aar_agent-*.whl | head -1)"
echo "    $(basename "$WHEEL")"
# Also for the sandbox test of an "own aar" (normal Python + this wheel).
mkdir -p "$(cd "$(dirname "$0")/../.." && pwd)/dist"
rm -f "$(cd "$(dirname "$0")/../.." && pwd)"/dist/aar_agent-*.whl
cp "$WHEEL" "$(cd "$(dirname "$0")/../.." && pwd)/dist/"

echo "==> dependencies (win_amd64, cp$PY_NODOT)"
python3 -m pip install -q --disable-pip-version-check \
  --target "$OUT/Lib/site-packages" \
  --platform win_amd64 --python-version "$PY_TAG" --implementation cp --abi "cp$PY_NODOT" \
  --only-binary=:all: \
  "${WHEEL}[${AAR_EXTRAS}]" pip hatchling pillow pillow-heif
# pip + hatchling: Aar Desktop installs extensions (built from the registry
# sources with hatchling, without build isolation) and MCP servers at runtime.
# pillow (+ HEIC from phones): photo search (aar_desktop.photos).

# Optional extra requirements (e.g. Windows desktop automation for the MCP server).
if [[ -n "${EXTRA_REQUIREMENTS:-}" ]]; then
  python3 -m pip install -q --disable-pip-version-check \
    --target "$OUT/Lib/site-packages" \
    --platform win_amd64 --python-version "$PY_TAG" --implementation cp --abi "cp$PY_NODOT" \
    --only-binary=:all: $EXTRA_REQUIREMENTS
fi

# pip evaluated environment markers for Linux, so Windows-only dependencies
# (e.g. pywin32 for mcp) were skipped. Resolve them until nothing is missing.
for round in 1 2 3; do
  MISSING="$(python3 "$(dirname "$0")/win_markers.py" "$OUT/Lib/site-packages" "$PY_TAG" aar-agent "$AAR_EXTRAS")"
  [[ -z "$MISSING" ]] && break
  echo "==> Windows-only dependencies (round $round): $(echo $MISSING | tr '\n' ' ')"
  # shellcheck disable=SC2086
  python3 -m pip install -q --disable-pip-version-check \
    --target "$OUT/Lib/site-packages" \
    --platform win_amd64 --python-version "$PY_TAG" --implementation cp --abi "cp$PY_NODOT" \
    --only-binary=:all: $MISSING
done

# MCP servers shipped with aar live in tools/, outside the wheel: copy the
# Windows desktop server next to the runtime (started by the widget via ACP).
if [[ -d "$SRC_COPY/aar/tools/windows_mcp" ]]; then
  mkdir -p "$OUT/aar-tools"
  rsync -a --exclude __pycache__ --exclude 'test*' "$SRC_COPY/aar/tools/windows_mcp" "$OUT/aar-tools/"
  # The embeddable Python ignores PYTHONPATH (._pth mode): add the dir there,
  # so `python -m windows_mcp.server` works.
  grep -q '^aar-tools' "$PTH" || printf 'aar-tools\r\n' >> "$PTH"
  echo "==> bundled tools/windows_mcp"
fi

# Aar Desktop's own helpers (boot with user extensions, extension/MCP management).
# SRC_DIR: build.sh rsyncs the repo to $WORK, the script may also run from /mnt/b.
SRC_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT/aar-tools"
rsync -a --delete --exclude __pycache__ "$SRC_DIR/python/aar_desktop" "$OUT/aar-tools/"
grep -q '^aar-tools' "$PTH" || printf 'aar-tools\r\n' >> "$PTH"
echo "==> bundled aar_desktop helpers"

# Slim down: caches and Linux console-script shims are useless here.
find "$OUT" -name __pycache__ -type d -prune -exec rm -rf {} +
rm -rf "$OUT/Lib/site-packages/bin"

echo "==> runtime ready: $(du -sh "$OUT" | cut -f1) in $OUT"
