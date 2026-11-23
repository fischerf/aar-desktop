"""Copy the showcase of one language into the project page (or the README):
PNG scenes -> WebP (same 1600x1200), plus the GIF.

    python publish.py <dist/showcase/<lang>> <site img dir>/<lang> [scene,scene]

Without a scene list all SCENES are copied.
"""
import shutil
import sys
from pathlib import Path

from PIL import Image

SCENES = ["paint", "permission", "photo-search", "vision", "extensions", "tools", "photos-settings", "setup"]

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
only = [s for s in (sys.argv[3] if len(sys.argv) > 3 else "").split(",") if s]
dst.mkdir(parents=True, exist_ok=True)
for name in only or SCENES:
    png = src / f"{name}.png"
    if not png.is_file():
        continue
    out = dst / f"{name}.webp"
    Image.open(png).save(out, "WEBP", quality=88, method=6)
    print(f"{out.name}: {out.stat().st_size // 1024} KB")
gif = src / "aar-desktop.gif"
if gif.is_file():
    shutil.copy(gif, dst / gif.name)
    print(f"{gif.name}: {gif.stat().st_size // 1024} KB")
