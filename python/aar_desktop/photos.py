"""Photo search for Aar Desktop: a local index of what is on the user's photos.

Every photo in the folders the user chose (Settings → Photos) is described
once by the local vision model (Ollama) – a sentence, the visible objects, the
number of people, indoor/outdoor, visible text. Searching ("all photos with
tables") is then a quick lookup in that index instead of the agent looking at
thousands of images. Nothing leaves the PC.

    python -m aar_desktop.photos index    build/refresh the index (progress in progress.json)
    python -m aar_desktop.photos status   JSON (``@@JSON`` line) for the settings page
    python -m aar_desktop.photos prune    forget photos outside the folders (folder removed)
    python -m aar_desktop.photos serve    MCP server (stdio) with photo_search & co.

Environment (set by the app):
    AAR_DESKTOP_PHOTO_DIRS    folders, separated by os.pathsep
    AAR_DESKTOP_PHOTO_DB      index directory (index.sqlite, thumbs/, progress.json)
    AAR_DESKTOP_OLLAMA_URL    e.g. http://localhost:11434
    AAR_DESKTOP_PHOTO_MODEL   vision model, e.g. qwen3.8:latest
    AAR_DESKTOP_OLLAMA_OPTIONS  optional extra Ollama options (JSON), e.g. {"num_gpu": 0}
"""

from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"}
MIN_BYTES = 1_000  # empty/broken files
#: Shorter side below this = icon, sprite or tile: found, but not sent to the
#: model (counted as "skipped" so the user sees why).
MIN_EDGE = 64
SKIPPED = "skipped:"
MAX_TRIES = 3  # failed photos are retried in later runs up to this many times
#: The model server answers with an error for this many photos in a row: stop
#: the run (the server is broken, not the photos).
MAX_HTTP_ERRORS = 3
MODEL_EDGE = 1024  # longest side sent to the model (~1000 image tokens)
THUMB_EDGE = 256
HEARTBEAT = 5.0
STALE = 30.0  # progress older than this = not running

PROMPT = (
    "Describe this photo for a photo search index. Answer only with JSON: "
    '{"description": "<one English sentence>", '
    '"objects": ["<lowercase English singular nouns of all clearly visible things: '
    'furniture, animals, vehicles, food, plants, clothing, devices, buildings, ...>"], '
    '"people": <number of people visible>, "scene": "<indoor|outdoor>", '
    '"place": "<kind of place, e.g. kitchen, office, beach, street>", '
    '"text": "<clearly readable text, or empty>"}'
)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class Config:
    folders: list[Path]
    db_dir: Path
    url: str
    model: str

    @classmethod
    def from_env(cls) -> Config:
        dirs = [Path(p) for p in os.environ.get("AAR_DESKTOP_PHOTO_DIRS", "").split(os.pathsep) if p.strip()]
        db = os.environ.get("AAR_DESKTOP_PHOTO_DB", "").strip()
        if not db:
            raise SystemExit("AAR_DESKTOP_PHOTO_DB is not set")
        return cls(
            folders=dirs,
            db_dir=Path(db),
            url=os.environ.get("AAR_DESKTOP_OLLAMA_URL", "").strip().rstrip("/"),
            model=os.environ.get("AAR_DESKTOP_PHOTO_MODEL", "").strip(),
        )

    @property
    def thumbs(self) -> Path:
        return self.db_dir / "thumbs"

    @property
    def progress_file(self) -> Path:
        return self.db_dir / "progress.json"

    @property
    def stop_file(self) -> Path:
        return self.db_dir / "stop"


def path_key(path: str | Path) -> str:
    """FNV-1a 64 of the lower-cased path: thumbnail file name (the app computes
    the same in Rust to show thumbnails)."""
    h = 0xCBF29CE484222325
    for b in str(path).lower().encode("utf-8"):
        h = ((h ^ b) * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{h:016x}"


def in_folders(path: Path, folders: list[Path]) -> bool:
    try:
        real = Path(os.path.realpath(path))
    except OSError:
        return False
    for f in folders:
        with contextlib.suppress(ValueError, OSError):
            real.relative_to(os.path.realpath(f))
            return True
    return False


def connect(cfg: Config) -> sqlite3.Connection:
    cfg.db_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(cfg.db_dir / "index.sqlite", timeout=30)
    db.execute(
        """CREATE TABLE IF NOT EXISTS photos (
            path TEXT PRIMARY KEY, mtime REAL, size INTEGER, taken TEXT,
            width INTEGER, height INTEGER, description TEXT, objects TEXT,
            people INTEGER, scene TEXT, place TEXT, text TEXT,
            model TEXT, indexed_at REAL, error TEXT)"""
    )
    # Failed attempts per photo (older indexes lack the column).
    if "tries" not in {r[1] for r in db.execute("PRAGMA table_info(photos)")}:
        db.execute("ALTER TABLE photos ADD COLUMN tries INTEGER DEFAULT 0")
        db.commit()
    return db


def retry_later(error: str, tries: int) -> bool:
    """A failed photo (timeout, model error) is tried again in later runs, at most
    MAX_TRIES times; skipped ones (too small) never."""
    return bool(error) and not error.startswith(SKIPPED) and (tries or 0) < MAX_TRIES


def scan(folders: list[Path]) -> dict[str, tuple[float, int]]:
    """Photos below *folders*: path -> (mtime, size)."""
    found: dict[str, tuple[float, int]] = {}
    for root in folders:
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith((".", "$"))]
            for name in filenames:
                if Path(name).suffix.lower() not in EXTENSIONS:
                    continue
                p = os.path.join(dirpath, name)
                with contextlib.suppress(OSError):
                    st = os.stat(p)
                    if st.st_size >= MIN_BYTES:
                        found[p] = (st.st_mtime, st.st_size)
    return found


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------


def _open_image(path: str):
    from PIL import Image, ImageOps

    with contextlib.suppress(Exception):
        import pillow_heif

        pillow_heif.register_heif_opener()
    img = Image.open(path)
    taken = _taken(img)
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img, taken


def _taken(img) -> str:
    with contextlib.suppress(Exception):
        exif = img.getexif()
        value = exif.get_ifd(0x8769).get(36867) or exif.get(306)
        if value:
            d = str(value).strip().replace(":", "-", 2)
            return d[:19]
    return ""


def _model_jpeg(img) -> bytes:
    """Image for the model: at most MODEL_EDGE; small images (e.g. 160x144 game
    screenshots) are enlarged so the vision encoder gets enough pixels."""
    from PIL import Image

    w, h = img.size
    if max(w, h) < 448:
        f = 448 / max(w, h)
        resample = Image.Resampling.NEAREST if max(w, h) <= 256 else Image.Resampling.LANCZOS
        img = img.resize((round(w * f), round(h * f)), resample)
    return _jpeg(img, MODEL_EDGE, 85)


def _jpeg(img, edge: int, quality: int) -> bytes:
    copy = img.copy()
    copy.thumbnail((edge, edge))
    buf = io.BytesIO()
    copy.convert("RGB").save(buf, "JPEG", quality=quality)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Ollama
# ---------------------------------------------------------------------------


def _post(url: str, body: dict, timeout: float) -> dict:
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def check_model(cfg: Config) -> str | None:
    """Why the model cannot index photos, or None."""
    if not cfg.url or not cfg.model:
        return "no local Ollama model configured"
    try:
        info = _post(f"{cfg.url}/api/show", {"model": cfg.model}, 30)
    except Exception as exc:  # noqa: BLE001
        return f"Ollama not reachable at {cfg.url}: {exc}"
    caps = info.get("capabilities")
    if isinstance(caps, list) and "vision" not in caps:
        return f"model {cfg.model} cannot see images (no 'vision' capability)"
    return None


def _ask(cfg: Config, prompt: str, jpeg: bytes, json_mode: bool = False, max_tokens: int = 0) -> str:
    options: dict = {"temperature": 0, "num_ctx": 8192}
    # Extra Ollama options as JSON, e.g. {"num_gpu": 0} = processor only (tests, tuning).
    with contextlib.suppress(ValueError, TypeError):
        options.update(json.loads(os.environ.get("AAR_DESKTOP_OLLAMA_OPTIONS") or "{}"))
    if max_tokens:
        options["num_predict"] = max_tokens
    body = {
        "model": cfg.model,
        "messages": [{"role": "user", "content": prompt, "images": [base64.b64encode(jpeg).decode()]}],
        "stream": False,
        "think": False,
        "options": options,
    }
    if json_mode:
        body["format"] = "json"
    reply = _post(f"{cfg.url}/api/chat", body, 900)
    return str(reply["message"]["content"] or "").strip()


# Small caption models (Moondream) cannot fill in the JSON template: they copy
# the placeholders. They answer short plain questions well, though.
SIMPLE_MODELS = ("moondream",)
_ARTICLE = re.compile(r"^(?:a|an|the|some|several|many|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+")


def _objects_from_list(text: str) -> list[str]:
    # Only the list itself: small models often go on with sentences or new questions.
    text = re.split(r"\n\s*\n|\n\s*\d+\.", text.lower())[0]
    out = set()
    for p in re.split(r",|;|\n|\band\b|•", text):
        p = re.split(r"\b(?:are|is|can be|visible|in the)\b", p)[0]
        p = _ARTICLE.sub("", p.strip(" .:-*\"'<>()[]"))
        if p and len(p) <= 40 and len(p.split()) <= 4 and not p.startswith(("i see", "there", "this", "the image")):
            out.add(p)
    return sorted(out)[:60]


_INDOOR = {"room", "kitchen", "bedroom", "bathroom", "office", "sofa", "couch", "bed", "ceiling", "wall", "indoor",
           "indoors", "inside", "museum", "restaurant", "dining", "desk", "shelf", "carpet", "fireplace", "classroom"}
_OUTDOOR = {"sky", "tree", "trees", "park", "street", "road", "grass", "garden", "beach", "mountain", "mountains",
            "field", "outdoor", "outdoors", "outside", "forest", "lake", "sea", "ocean", "river", "flagpole", "sunset"}
_PEOPLE = {"person", "people", "man", "men", "woman", "women", "child", "children", "boy", "girl", "kid", "kids",
           "baby", "crowd", "family", "couple", "player", "players"}
_NUMBERS = {"no": 0, "zero": 0, "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
            "seven": 7, "eight": 8, "nine": 9, "ten": 10}


def _scene_from(answer: str, text: str) -> str:
    a = answer.lower()
    if "indoor" in a or "inside" in a:
        return "indoor"
    if "outdoor" in a or "outside" in a:
        return "outdoor"
    words = set(_WORD.findall(text.lower()))
    indoor, outdoor = len(words & _INDOOR), len(words & _OUTDOOR)
    return "indoor" if indoor > outdoor else "outdoor" if outdoor > indoor else ""


def _people_from(answer: str, text: str) -> int:
    for source in (answer.lower(), text.lower()):
        if re.search(r"\bno (?:people|person|one|humans?)\b|\bnobody\b|\bempty\b", source):
            return 0
        m = re.search(r"\b(\d+|no|zero|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?("
                      + "|".join(sorted(_PEOPLE)) + r")\b", source)
        if m:
            return int(m.group(1)) if m.group(1).isdigit() else _NUMBERS[m.group(1)]
        if set(_WORD.findall(source)) & _PEOPLE:
            return 1
    return 0


def _describe_simple(cfg: Config, jpeg: bytes) -> dict:
    """Plain questions for small caption models; what they leave out (they often
    answer short questions with nothing) is taken from the description."""
    caption = " ".join(_ask(cfg, "Describe this image.", jpeg, max_tokens=120).split())
    listed = _ask(cfg, "List the objects you can see in this image, separated by commas.", jpeg, max_tokens=80)
    scene = _ask(cfg, "Is this photo taken indoors or outdoors?", jpeg, max_tokens=40)
    people = _ask(cfg, "Are there any people in this image?", jpeg, max_tokens=40)
    objects = _objects_from_list(listed)
    text = f"{caption} {' '.join(objects)}"
    return {
        "description": caption[:500],
        "objects": objects,
        "people": min(_people_from(people, caption), 99),
        "scene": _scene_from(scene, text),
        "place": "",
        "text": "",
    }


def _template_copied(data: dict) -> bool:
    """The model echoed the prompt's placeholders instead of answering."""
    blob = json.dumps(data).lower()
    return "<" in blob and (">" in blob or "lowercase english" in blob)


def describe(cfg: Config, jpeg: bytes) -> dict:
    if cfg.model.lower().startswith(SIMPLE_MODELS):
        return _describe_simple(cfg, jpeg)
    try:
        data = json.loads(_ask(cfg, PROMPT, jpeg, json_mode=True))
    except (json.JSONDecodeError, TypeError):
        return _describe_simple(cfg, jpeg)
    if not isinstance(data, dict) or _template_copied(data):
        return _describe_simple(cfg, jpeg)
    objects = data.get("objects") or []
    if isinstance(objects, str):
        objects = _objects_from_list(objects)
    return {
        "description": str(data.get("description") or "")[:500],
        "objects": sorted({str(o).strip().lower() for o in objects if str(o).strip()})[:60],
        "people": int(data.get("people") or 0) if str(data.get("people") or "0").isdigit() else 0,
        "scene": str(data.get("scene") or "")[:20].lower(),
        "place": str(data.get("place") or "")[:60].lower(),
        "text": str(data.get("text") or "")[:300],
    }


# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------


def read_progress(cfg: Config) -> dict:
    with contextlib.suppress(Exception):
        return json.loads(cfg.progress_file.read_text(encoding="utf-8"))
    return {}


def is_running(cfg: Config) -> bool:
    p = read_progress(cfg)
    return bool(p.get("running")) and time.time() - float(p.get("updated", 0)) < STALE


def cmd_index(cfg: Config) -> int:
    if is_running(cfg):
        print("indexing is already running", file=sys.stderr)
        return 0
    cfg.db_dir.mkdir(parents=True, exist_ok=True)
    cfg.thumbs.mkdir(exist_ok=True)
    cfg.stop_file.unlink(missing_ok=True)
    state = {"running": True, "done": 0, "total": 0, "current": "", "error": "", "started": time.time()}

    def save() -> None:
        state["updated"] = time.time()
        tmp = cfg.progress_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(state), encoding="utf-8")
        tmp.replace(cfg.progress_file)

    stop_beat = threading.Event()

    def beat() -> None:  # the first image may wait minutes for the model to load
        while not stop_beat.wait(HEARTBEAT):
            # A virus scanner or the settings page reading progress.json can make
            # the replace fail for a moment; the heartbeat must keep going, or a
            # second indexer would start after STALE seconds.
            with contextlib.suppress(OSError):
                save()

    save()
    threading.Thread(target=beat, daemon=True).start()
    try:
        problem = check_model(cfg)
        if problem:
            state["error"] = problem
            return 3
        db = connect(cfg)
        found = scan(cfg.folders)
        known = {
            row[0]: (row[1], row[2], row[3] or "", row[4] or 0)
            for row in db.execute("SELECT path, mtime, size, error, tries FROM photos")
        }
        # Forget photos that are gone or outside the chosen folders – but not those
        # of a folder that is just not reachable right now (USB drive, NAS, VPN).
        offline = [f for f in cfg.folders if not f.is_dir()]
        for path in set(known) - set(found):
            if offline and in_folders(Path(path), offline):
                continue
            db.execute("DELETE FROM photos WHERE path = ?", (path,))
            (cfg.thumbs / f"{path_key(path)}.jpg").unlink(missing_ok=True)
        db.commit()

        def unchanged(p: str) -> bool:
            return p in known and known[p][0] == found[p][0] and known[p][1] == found[p][1]

        todo = [p for p in found if not unchanged(p) or retry_later(known[p][2], known[p][3])]
        todo.sort(key=lambda p: -found[p][0])  # newest photos first
        state["total"] = len(todo)
        http_errors = 0
        for path in todo:
            if cfg.stop_file.exists():
                state["stopped"] = True
                break
            state["current"] = path
            mtime, size = found[path]
            row = {"description": "", "objects": [], "people": 0, "scene": "", "place": "", "text": ""}
            error, taken, width, height = "", "", 0, 0
            try:
                img, taken = _open_image(path)
                width, height = img.size
                if min(width, height) < MIN_EDGE:
                    error = f"{SKIPPED} {width}x{height} px"
                else:
                    (cfg.thumbs / f"{path_key(path)}.jpg").write_bytes(_jpeg(img, THUMB_EDGE, 80))
                    row = describe(cfg, _model_jpeg(img))
                    http_errors = 0
            except urllib.error.HTTPError as exc:
                # The server answered with an error (HTTPError is a URLError, but the
                # server is reachable): this photo failed, try it again later.
                error = f"Ollama HTTP {exc.code}: {exc.reason}"[:300]
                http_errors += 1
                if http_errors >= MAX_HTTP_ERRORS:
                    state["error"] = error
                    break
            except urllib.error.URLError as exc:
                state["error"] = f"Ollama: {exc}"
                break
            except Exception as exc:  # noqa: BLE001 - one bad file must not stop the run
                error = f"{type(exc).__name__}: {exc}"[:300]
            if cfg.stop_file.exists():  # e.g. its folder was removed meanwhile (prune)
                state["stopped"] = True
                break
            tries = 0
            if error and not error.startswith(SKIPPED):
                tries = (known[path][3] if unchanged(path) else 0) + 1
            db.execute(
                "INSERT OR REPLACE INTO photos (path, mtime, size, taken, width, height, description, objects,"
                " people, scene, place, text, model, indexed_at, error, tries)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    path, mtime, size, taken or time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(mtime)),
                    width, height, row["description"], json.dumps(row["objects"]), row["people"],
                    row["scene"], row["place"], row["text"], cfg.model, time.time(), error, tries,
                ),
            )
            db.commit()
            state["done"] += 1
        return 0 if not state["error"] else 4
    finally:
        stop_beat.set()
        state["running"] = False
        state["current"] = ""
        state["finished"] = time.time()
        save()


def prune(cfg: Config) -> int:
    """Forget everything outside the chosen folders (descriptions + thumbnails),
    e.g. right after the user removed a folder. A running indexing run is
    stopped first so it cannot add entries of the removed folder again."""
    if is_running(cfg):
        cfg.db_dir.mkdir(parents=True, exist_ok=True)
        cfg.stop_file.write_text("stop")
    db = connect(cfg)
    removed = 0
    for (path,) in db.execute("SELECT path FROM photos").fetchall():
        if cfg.folders and in_folders(Path(path), cfg.folders):
            continue
        db.execute("DELETE FROM photos WHERE path = ?", (path,))
        (cfg.thumbs / f"{path_key(path)}.jpg").unlink(missing_ok=True)
        removed += 1
    db.commit()
    return removed


def spawn_index(cfg: Config) -> bool:
    """Start indexing in the background (survives this process). False if it runs already."""
    if is_running(cfg):
        return False
    flags = 0
    if os.name == "nt":
        flags = 0x00000008 | 0x00000200 | 0x08000000  # DETACHED | NEW_PROCESS_GROUP | NO_WINDOW
    subprocess.Popen(
        [sys.executable, "-m", "aar_desktop.photos", "index"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=flags,
        close_fds=True,
        # POSIX: own session, so stopping aar (or the widget) does not end it.
        start_new_session=os.name != "nt",
    )
    return True


# ---------------------------------------------------------------------------
# Status and search
# ---------------------------------------------------------------------------


def status(cfg: Config) -> dict:
    db = connect(cfg)
    found = scan(cfg.folders)
    rows = {
        r[0]: ((r[1], r[2]), r[3] or "", r[4] or 0)
        for r in db.execute("SELECT path, mtime, size, error, tries FROM photos")
    }
    # Failed photos that the next run tries again still count as pending.
    indexed = sum(
        1 for p, v in found.items() if p in rows and rows[p][0] == v and not retry_later(rows[p][1], rows[p][2])
    )
    errors = db.execute("SELECT COUNT(*) FROM photos WHERE error != '' AND error NOT LIKE 'skipped:%'").fetchone()[0]
    skipped = db.execute("SELECT COUNT(*) FROM photos WHERE error LIKE 'skipped:%'").fetchone()[0]
    folders = []
    for f in cfg.folders:
        # With a separator: "D:\Fotos" must not count "D:\Fotos 2024\…".
        prefix = str(f).rstrip("\\/").lower()
        n = sum(1 for p in found if p.lower().startswith((prefix + "\\", prefix + "/")))
        folders.append({"path": str(f), "exists": f.is_dir(), "photos": n})
    prog = read_progress(cfg)
    return {
        "ok": True,
        "folders": folders,
        "photos": len(found),
        "indexed": indexed,
        "pending": len(found) - indexed,
        "errors": errors,
        "skipped": skipped,
        "running": is_running(cfg),
        "progress": {k: prog.get(k) for k in ("done", "total", "current", "error", "stopped", "finished")},
        "model": cfg.model,
        "modelProblem": None,
    }


_WORD = re.compile(r"[a-z0-9]+")


def _forms(term: str) -> set[str]:
    t = term.strip().lower()
    forms = {t}
    if t.endswith("ies"):
        forms.add(t[:-3] + "y")
    elif t.endswith("es"):
        forms.update({t[:-2], t[:-1]})
    elif t.endswith("s"):
        forms.add(t[:-1])
    else:
        forms.update({t + "s", t + "es"})
    return {f for f in forms if f}


def search(
    cfg: Config,
    terms: list[str],
    match_all: bool = False,
    min_people: int | None = None,
    max_people: int | None = None,
    scene: str = "",
    text: str = "",
    year: int | None = None,
    limit: int = 30,
) -> tuple[list[dict], int]:
    """Matching photos (best first) and the total number of matches."""
    db = connect(cfg)
    wanted = [_forms(t) for t in terms if t and t.strip()]
    hits = []
    for path, taken, desc, objects, people, sc, place, txt in db.execute(
        "SELECT path, taken, description, objects, people, scene, place, text FROM photos WHERE error = ''"
    ):
        if cfg.folders and not in_folders(Path(path), cfg.folders):
            continue
        if min_people is not None and people < min_people:
            continue
        if max_people is not None and people > max_people:
            continue
        if scene and sc != scene.lower():
            continue
        if text and text.lower() not in (txt or "").lower():
            continue
        if year and not (taken or "").startswith(str(year)):
            continue
        objs = set(json.loads(objects or "[]"))
        obj_words = {w for o in objs for w in _WORD.findall(o)} | objs
        desc_words = set(_WORD.findall(f"{desc} {place}".lower()))
        score, matched = 0, 0
        for forms in wanted:
            if forms & objs:  # a whole object ("table") beats a part of one ("picnic table")
                score, matched = score + 3, matched + 1
            elif forms & obj_words:
                score, matched = score + 2, matched + 1
            elif forms & desc_words:
                score, matched = score + 1, matched + 1
        if wanted and (matched == 0 or (match_all and matched < len(wanted))):
            continue
        hits.append({"path": path, "taken": taken, "description": desc, "score": score, "people": people})
    hits.sort(key=lambda h: h["taken"] or "", reverse=True)  # newest first …
    hits.sort(key=lambda h: -h["score"])  # … within the same score (stable sort)
    return hits[:limit], len(hits)


# ---------------------------------------------------------------------------
# MCP server
# ---------------------------------------------------------------------------


def serve(cfg: Config) -> None:
    from mcp.server.fastmcp import FastMCP, Image

    mcp = FastMCP(
        "photos",
        instructions=(
            "Search the user's photos by what is on them. The photos were described in English by a local "
            "vision model, so pass English singular nouns to photo_search (add synonyms, e.g. table, desk). "
            "Show the found photos to the user by listing the paths exactly as returned. If photos are not "
            "indexed yet, say so and offer photo_index_update. Use photo_view to look at one photo closely."
        ),
    )

    @mcp.tool()
    def photo_search(
        terms: list[str],
        match_all: bool = False,
        min_people: int | None = None,
        max_people: int | None = None,
        scene: str = "",
        text: str = "",
        year: int | None = None,
        limit: int = 30,
    ) -> str:
        """Find photos by content. terms: English nouns of things on the photo (any of them matches,
        or all with match_all). Optional filters: number of people, scene 'indoor'/'outdoor',
        visible text, year taken."""
        if not cfg.folders:
            return "No photo folders are set up. The user can choose them under Settings → Photos."
        hits, total = search(cfg, terms, match_all, min_people, max_people, scene, text, year, max(1, min(limit, 100)))
        st = status(cfg)
        lines = [f"Found {total} photo(s) for {', '.join(terms) or 'all'}" + (f", showing {len(hits)}" if total > len(hits) else "") + ":"]
        for i, h in enumerate(hits, 1):
            lines.append(f"{i}. {h['path']} — {h['taken'][:10]} — {h['description']}")
        if st["pending"]:
            lines.append(
                f"Note: {st['pending']} of {st['photos']} photos are not indexed yet"
                + (" (indexing is running)." if st["running"] else "; photo_index_update indexes them.")
            )
        return "\n".join(lines)

    @mcp.tool()
    def photo_index_status() -> str:
        """How many photos are indexed, which folders are searched, whether indexing runs."""
        st = status(cfg)
        folders = ", ".join(f["path"] for f in st["folders"]) or "none (Settings → Photos)"
        run = " Indexing is running ({done}/{total}).".format(**st["progress"]) if st["running"] else ""
        return f"Folders: {folders}. Photos: {st['photos']}, indexed: {st['indexed']}, not indexed: {st['pending']}.{run}"

    @mcp.tool()
    def photo_index_update() -> str:
        """Index new or changed photos in the background (takes a few seconds per photo)."""
        if not cfg.folders:
            return "No photo folders are set up (Settings → Photos)."
        problem = check_model(cfg)
        if problem:
            return f"Cannot index: {problem}."
        started = spawn_index(cfg)
        st = status(cfg)
        minutes = max(1, round(st["pending"] * 5 / 60))
        return ("Indexing started" if started else "Indexing is already running") + (
            f": {st['pending']} photo(s), roughly {minutes} minute(s)."
        )

    @mcp.tool()
    def photo_view(path: str):
        """Look at one photo from the photo folders (reduced size)."""
        p = Path(path)
        if not in_folders(p, cfg.folders) or p.suffix.lower() not in EXTENSIONS or not p.is_file():
            return "Only photos inside the photo folders can be viewed."
        img, _ = _open_image(str(p))
        return Image(data=_jpeg(img, MODEL_EDGE, 85), format="jpeg")

    mcp.run()


def main(argv: list[str]) -> int:
    cfg = Config.from_env()
    cmd = argv[0] if argv else ""
    if cmd == "index":
        return cmd_index(cfg)
    if cmd == "prune":
        print("@@JSON " + json.dumps({"ok": True, "removed": prune(cfg)}), flush=True)
        return 0
    if cmd == "status":
        st = status(cfg)
        st["modelProblem"] = check_model(cfg) if "--check-model" in argv else None
        print("@@JSON " + json.dumps(st, ensure_ascii=False), flush=True)
        return 0
    if cmd == "serve":
        serve(cfg)
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
