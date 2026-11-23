"""Assemble the recorded frames (capture.mjs) into an optimized GIF.

    python make_gif.py <frames dir> <out.gif> [max colors]
Identical consecutive frames are merged (their durations add up).
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops

src, out = Path(sys.argv[1]), Path(sys.argv[2])
colors = int(sys.argv[3]) if len(sys.argv) > 3 else 128
meta = json.loads((src / "frames.json").read_text())

frames, durations = [], []
prev = None
for m in meta:
    img = Image.open(src / m["file"]).convert("RGB")
    if prev is not None and ImageChops.difference(img, prev).getbbox() is None:
        durations[-1] += m["ms"]
        continue
    frames.append(img)
    durations.append(m["ms"])
    prev = img
durations[-1] = max(durations[-1], 2500)  # rest on the result before looping

# One shared palette (from a few representative frames) keeps colours stable.
probe = Image.new("RGB", (frames[0].width, frames[0].height * 3))
for i, f in enumerate([frames[0], frames[len(frames) // 2], frames[-1]]):
    probe.paste(f, (0, i * f.height))
palette = probe.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
q = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
q[0].save(out, save_all=True, append_images=q[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(f"{out}: {len(q)} frames, {out.stat().st_size // 1024} KB")
