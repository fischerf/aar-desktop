"""Download the CC0 sample photos for the showcase from Wikimedia Commons.

    python fetch_photos.py <out dir>      (showcase.sh does this when they are missing)

Writes <query>.jpg + credits.json (title, license, source of every photo).
Only public-domain / CC0 images are taken; the Unsplash imports are good ones.
"""
import json, sys, time, urllib.parse, urllib.request
from pathlib import Path

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "aar-desktop-showcase/1.0 (personal project page)"}
QUERIES = {
    "table1": "Unsplash dining table",
    "table2": "Unsplash wooden table cafe",
    "table3": "Unsplash desk laptop table",
    "beach": "Unsplash beach sunset",
    "mountain": "Unsplash mountain lake",
    "dog": "Unsplash dog",
    "cake": "Unsplash birthday cake",
    "city": "Unsplash old town street",
}
OK = ("public domain", "cc0", "pd")


def api(params):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.load(r)


credits = []
for key, q in QUERIES.items():
    d = api({"action": "query", "generator": "search", "gsrsearch": f"filetype:bitmap {q}", "gsrnamespace": 6,
             "gsrlimit": 25, "prop": "imageinfo", "iiprop": "url|extmetadata|size", "iiurlwidth": 640, "format": "json"})
    pages = sorted(d.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
    for p in pages:
        ii = p["imageinfo"][0]
        meta = ii.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "").lower()
        if not any(lic.startswith(o) for o in OK) or ii.get("width", 0) < ii.get("height", 1):
            continue
        dest = OUT / f"{key}.jpg"
        with urllib.request.urlopen(urllib.request.Request(ii["thumburl"], headers=UA), timeout=60) as r:
            dest.write_bytes(r.read())
        credits.append({"file": dest.name, "title": p["title"], "license": meta["LicenseShortName"]["value"],
                        "source": ii["descriptionurl"]})
        print(key, "->", p["title"], "|", meta["LicenseShortName"]["value"])
        time.sleep(1.5)
        break
    else:
        print(key, "-> nothing PD found")
(OUT / "credits.json").write_text(json.dumps(credits, indent=2), encoding="utf-8")
