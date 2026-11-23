#!/usr/bin/env bash
# Screenshots (1600x1200) + GIF of Aar Desktop for the project page, made with
# the real frontend on a fake desktop (scripts/showcase), one set per language.
# Output: dist/showcase/<lang>, then WebP + GIF into the page
# (fischerf.github.io/aar-desktop/img/<lang>) and the English GIF + one
# screenshot into docs/img for the README.
#
#   wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/showcase.sh [scene,scene] [en,de,zh]
#
# Scenes: paint, photo-search, vision, permission, extensions, tools,
#         photos-settings, setup, gif   (none given or "all" = all)
# Languages: en, de, zh (default: all three)
# Env: SHOWCASE_SITE=<img dir of the page>  ("" = do not copy into the page)
#      SHOWCASE_README=<dir>  (default docs/img of the repo, "" = do not copy)
set -euo pipefail
SRC="${AAR_UI_SRC:-/mnt/b/Github_my/aar_ui}"
WORK="$HOME/build/aar_ui"
OUT="$SRC/dist/showcase"

rsync -a --delete \
  --exclude node_modules --exclude dist --exclude dist-web \
  --exclude src-tauri/target --exclude src-tauri/gen --exclude .git --exclude dist-py \
  "$SRC/" "$WORK/"
cd "$WORK"
[[ -d node_modules ]] || npm ci --no-audit --no-fund
E2E="$HOME/e2e-tools"
[[ -d "$E2E/node_modules/playwright" ]] || { echo "run scripts/wsl/e2e.sh once first"; exit 1; }
export NODE_PATH="$E2E/node_modules"
ln -sfn "$E2E/node_modules/playwright" node_modules/playwright
ln -sfn "$E2E/node_modules/playwright-core" node_modules/playwright-core

# Python with Pillow for thumbnails and the GIF.
PY="$HOME/venvs/showcase/bin/python"
[[ -x "$PY" ]] || { python3 -m venv "$HOME/venvs/showcase"; "$HOME/venvs/showcase/bin/pip" -q install pillow; }

# Segoe UI is not available on Linux: use Microsoft's metric-compatible Selawik.
FONTS="$HOME/.local/share/fonts/selawik"
if ! ls "$FONTS"/*.ttf >/dev/null 2>&1; then
  mkdir -p "$FONTS"
  curl -fsSL -o /tmp/selawik.zip "https://github.com/microsoft/Selawik/releases/download/1.01/Selawik_Release.zip"
  python3 -c "import zipfile,sys; z=zipfile.ZipFile('/tmp/selawik.zip'); [open(sys.argv[1]+'/'+n.split('/')[-1],'wb').write(z.read(n)) for n in z.namelist() if n.lower().endswith('.ttf')]" "$FONTS"
  mkdir -p "$HOME/.config/fontconfig"
  cat > "$HOME/.config/fontconfig/fonts.conf" <<'XML'
<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <alias><family>Segoe UI</family><prefer><family>Selawik</family></prefer></alias>
  <alias><family>Segoe UI Variable Text</family><prefer><family>Selawik</family></prefer></alias>
</fontconfig>
XML
  fc-cache -f >/dev/null
fi

# CC0 sample photos (downloaded once, kept outside the repo).
if ! ls "$SRC"/dist/showcase-src/photos/*.jpg >/dev/null 2>&1; then
  "$PY" scripts/showcase/fetch_photos.py "$SRC/dist/showcase-src/photos"
fi

# Photos -> 256 px thumbnails.
PH="$WORK/scripts/showcase/photos"
mkdir -p "$PH/thumbs"
cp "$SRC"/dist/showcase-src/photos/*.jpg "$PH/"
"$PY" - "$PH" <<'PYEOF'
import sys
from pathlib import Path
from PIL import Image, ImageOps
d = Path(sys.argv[1])
for f in d.glob("*.jpg"):
    im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
    im.thumbnail((256, 256))
    im.save(d / "thumbs" / f.name, quality=85)
PYEOF

npx vite --port 1420 --strictPort >/tmp/vite.log 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -sf http://localhost:1420/ >/dev/null && break; sleep 0.2; done

SCENES="${1:-}"
[[ "$SCENES" == all ]] && SCENES=""
LANGS="${2:-en,de,zh}"
mkdir -p "$OUT"
for L in ${LANGS//,/ }; do rm -rf "$OUT/$L/gif-frames"; done
SHOWCASE_OUT="$OUT" SHOWCASE_PHOTOS="$PH" SHOWCASE_ONLY="$SCENES" SHOWCASE_LANGS="$LANGS" node scripts/showcase/capture.mjs
SITE="${SHOWCASE_SITE-/mnt/b/Github_my/fischerf.github.io/aar-desktop/img}"
for L in ${LANGS//,/ }; do
  if [[ -f "$OUT/$L/gif-frames/frames.json" ]]; then
    "$PY" scripts/showcase/make_gif.py "$OUT/$L/gif-frames" "$OUT/$L/aar-desktop.gif" 128
    rm -rf "$OUT/$L/gif-frames"
  fi
  if [[ -n "$SITE" && -d "$(dirname "$SITE")" ]]; then
    echo "==> page: $SITE/$L"
    "$PY" scripts/showcase/publish.py "$OUT/$L" "$SITE/$L"
  fi
  ls -la "$OUT/$L"
done
README="${SHOWCASE_README-$SRC/docs/img}"
if [[ -n "$README" && ",$LANGS," == *,en,* ]]; then
  echo "==> README: $README"
  "$PY" scripts/showcase/publish.py "$OUT/en" "$README" photo-search
fi
