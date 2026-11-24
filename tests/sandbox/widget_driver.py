"""Drive the real Aar Desktop widget like a user (inside Windows Sandbox, bundled runtime).

  python.exe widget_driver.py <out_dir> <aar-desktop.exe> <task,task,...|all>

Starts aar-desktop.exe, opens the chat by clicking the mascot, types each
task's prompt into the chat box, presses "Senden", answers every permission
card with "Erlauben" and waits until the send button is back from "Abbrechen".
Then the answer is read from the chat, the outcome is checked (e.g. which page
Edge shows) and widget + target window are saved as screenshots.
Results: <out_dir>/widget.json. Everything goes through UI Automation of the
WebView2 window, i.e. what a screen reader would see.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import uiautomation as auto
from windows_mcp import uia

OUT, EXE = Path(sys.argv[1]), sys.argv[2]
SELECTED = sys.argv[3] if len(sys.argv) > 3 else "all"
TURN_TIMEOUT = 1800


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with open(OUT / "log.txt", "a", encoding="utf-8") as f:
        f.write(line + "\n")


def edge_titles() -> list[str]:
    return [w.title for w in uia.list_windows() if (w.process or "").lower() == "msedge.exe"]


@dataclass
class Task:
    prompt: str
    check: Callable[[str], tuple[bool, str]]
    window: str = "msedge.exe"
    # Start suggestion to click instead of typing the prompt (its button text).
    chip: str = ""
    reset: Callable[[], None] | None = None


def check_wiki(answer: str) -> tuple[bool, str]:
    titles = edge_titles()
    page = any("Sonnenuntergang" in t for t in titles)
    said = bool(re.search(r"Horizont|oberer Rand|Sonnenscheibe", answer))
    return page and said, f"edge={titles} answer_has_first_sentence={said}"


def check_weather(answer: str) -> tuple[bool, str]:
    titles = edge_titles()
    temp = re.search(r"-?\d+\s*(°|Grad)", answer)
    return bool(titles) and bool(temp), f"edge={titles} temperature={temp and temp.group(0)}"


HOME = Path.home()
_started: dict[str, float] = {}


def new_files(folder: Path, suffix: str) -> list[Path]:
    since = _started.get("t", 0)
    return sorted(p for p in folder.glob(f"*{suffix}") if p.stat().st_mtime >= since - 1)


def keep(paths: list[Path]) -> None:
    for p in paths:
        (OUT / f"report-{p.name}").write_bytes(p.read_bytes())


def browsed(chat: str) -> str:
    """Did the model look things up (pages read in Edge) or answer from memory?"""
    return f"pages_read={chat.count('Text lesen')} edge={edge_titles()}"


def check_report_md(answer: str) -> tuple[bool, str]:
    files = new_files(HOME / "Desktop", ".md")
    keep(files)
    text = files[-1].read_text(encoding="utf-8", errors="replace") if files else ""
    ok = len(text) > 800 and "balkonkraftwerk" in text.lower()
    return ok, f"files={[p.name for p in files]} chars={len(text)} {browsed(answer)}"


def check_report_pdf(answer: str) -> tuple[bool, str]:
    files = new_files(HOME / "Documents", ".pdf")
    keep(files + new_files(HOME / "Documents", ".html") + new_files(HOME / "Documents", ".md"))
    data = files[-1].read_bytes() if files else b""
    ok = data.startswith(b"%PDF") and len(data) > 5000
    return ok, f"files={[p.name for p in files]} bytes={len(data)} {browsed(answer)}"


def check_date(answer: str) -> tuple[bool, str]:
    today = time.localtime()
    forms = {time.strftime("%d.%m.%Y", today), time.strftime("%Y-%m-%d", today),
             f"{today.tm_mday}.{today.tm_mon}.{today.tm_year}"}
    return any(f in answer for f in forms), f"expected one of {sorted(forms)}"


# --- start suggestions (the chips in an empty conversation) --------------------

DOWNLOADS = HOME / "Downloads"
SAMPLE_DOWNLOADS = ["Rechnung_Maerz.pdf", "Rechnung_April.pdf", "Urlaub_001.jpg", "Urlaub_002.jpg",
                    "OllamaSetup.exe", "Notizen.txt", "Lebenslauf.docx"]


def fill_downloads() -> None:
    DOWNLOADS.mkdir(exist_ok=True)
    for name in SAMPLE_DOWNLOADS:
        (DOWNLOADS / name).write_bytes(b"sample " + name.encode() * 20)


def check_news(answer: str) -> tuple[bool, str]:
    # Looked something up (Edge page text or a web tool) and wrote a summary.
    looked = answer.count("Text lesen") + answer.count("Webseite lesen") + answer.count("Webseite öffnen")
    points = len(re.findall(r"(?m)^\s*(?:[-•*]|\d+[.)])\s+\S", answer))
    ok = looked >= 1 and len(answer) > 300
    return ok, f"lookups={looked} list_points={points} chars={len(answer)} edge={edge_titles()}"


def painted_share(hwnd: int) -> float:
    """Share of non-white pixels in the middle of the Paint window (the canvas)."""
    import io

    from PIL import Image

    png, _, _ = uia.screenshot(hwnd, 1600)
    img = Image.open(io.BytesIO(png)).convert("RGB")
    w, h = img.size
    canvas = img.crop((int(w * 0.2), int(h * 0.3), int(w * 0.8), int(h * 0.85))).resize((120, 80))
    pixels = list(canvas.getdata())
    return sum(1 for r, g, b in pixels if min(r, g, b) < 225) / len(pixels)


def check_paint_chip(answer: str) -> tuple[bool, str]:
    wins = [w for w in uia.list_windows() if (w.process or "").lower() == "mspaint.exe"]
    share = painted_share(wins[0].handle) if wins else 0.0
    return share > 0.05, f"paint={[w.title for w in wins]} painted={share:.0%} (picture: screenshot)"


def check_downloads(answer: str) -> tuple[bool, str]:
    left = [n for n in SAMPLE_DOWNLOADS if (DOWNLOADS / n).is_file()]
    named = [n for n in SAMPLE_DOWNLOADS if n.split(".")[0].lower() in answer.lower()]
    ok = len(left) == len(SAMPLE_DOWNLOADS) and len(named) >= 3
    return ok, f"untouched={len(left)}/{len(SAMPLE_DOWNLOADS)} named={named}"


def check_letter(answer: str) -> tuple[bool, str]:
    files = [p for p in new_files(HOME / "Desktop", "") if p.is_file()]
    keep(files)
    text = ""
    for p in files:
        if p.suffix.lower() in (".txt", ".md", ".html", ".rtf"):
            text += p.read_text(encoding="utf-8", errors="replace")
    ok = bool(files) and (not text or bool(re.search(r"Freitag|Frühstück|9[:.]?00|9 Uhr", text)))
    return ok, f"files={[p.name for p in files]} chars={len(text)}"


TASKS = {
    "sug-news": Task("", check_news, chip="Nachrichten von heute"),
    "sug-paint": Task("", check_paint_chip, "mspaint.exe", chip="In Paint malen"),
    "sug-downloads": Task("", check_downloads, "", chip="Download-Ordner ansehen", reset=fill_downloads),
    "sug-letter": Task("", check_letter, "", chip="Einladung schreiben"),
    "date": Task("Welches Datum haben wir heute? Antworte nur mit dem Datum.", check_date, ""),
    "edge-wiki": Task("Öffne bitte in Edge die Wikipedia-Seite über den Sonnenuntergang und "
                      "sag mir, was im ersten Satz steht.", check_wiki),
    "edge-weather": Task("Wie ist das Wetter gerade in Berlin? Schau bitte in Edge nach.",
                         check_weather),
    "report-md": Task("Recherchiere bitte im Internet zum Thema Balkonkraftwerk und schreib mir "
                      "einen kurzen Bericht als Markdown-Datei auf meinen Desktop.",
                      check_report_md),
    "report-pdf": Task("Recherchiere im Internet, was eine Wärmepumpe ist und was sie ungefähr "
                       "kostet, und speichere mir einen kurzen Bericht als PDF in meinen "
                       "Dokumenten.", check_report_pdf),
}


# --- UI Automation helpers ----------------------------------------------------


def walk(control: auto.Control, depth: int = 0, max_depth: int = 40):
    yield control
    if depth >= max_depth:
        return
    for child in uia._children(control):  # noqa: SLF001 - same walker as the MCP server
        yield from walk(child, depth + 1, max_depth)


def find_all(root: auto.Control, pred: Callable[[auto.Control], bool]) -> list[auto.Control]:
    out = []
    for c in walk(root):
        try:
            if pred(c):
                out.append(c)
        except Exception:  # noqa: BLE001 - element vanished while walking
            pass
    return out


def wait_for(fn: Callable[[], object], timeout: float, what: str, step: float = 0.5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if r := fn():
                return r
        except Exception:  # noqa: BLE001
            pass
        time.sleep(step)
    raise TimeoutError(f"timed out waiting for {what}")


def button(root: auto.Control, name: str) -> auto.Control | None:
    hits = find_all(root, lambda c: c.ControlTypeName == "ButtonControl" and c.Name == name)
    return hits[0] if hits else None


def press(c: auto.Control) -> None:
    try:
        c.GetInvokePattern().Invoke()
    except Exception:  # noqa: BLE001
        c.Click(simulateMove=False)


def widget_window(pid: int) -> int:
    def find():
        for w in uia.list_windows():
            if w.pid == pid and w.title == "Aar":
                return w.handle
        return None

    return wait_for(find, 60, "the Aar window")


def chat_text(hwnd: int) -> str:
    return uia._document_text(hwnd) or ""  # noqa: SLF001


def shot(hwnd: int, name: str) -> None:
    png, _, _ = uia.screenshot(hwnd, 1600)
    (OUT / name).write_bytes(png)


# --- one task -----------------------------------------------------------------


def run(hwnd: int, name: str, task: Task) -> dict:
    root = auto.ControlFromHandle(hwnd)
    for proc in {"msedge.exe", task.window} - {""}:
        subprocess.run(["taskkill", "/F", "/IM", proc], capture_output=True)
    if task.reset:
        task.reset()
    time.sleep(2)
    # Fresh conversation for every task.
    if new := button(root, "Neues Gespräch"):
        press(new)
        time.sleep(3)
    box = wait_for(lambda: next(iter(find_all(
        root, lambda c: c.ControlTypeName == "EditControl" and c.IsEnabled
        and c.AutomationId == "input")), None), 180, "an enabled chat input")
    before = chat_text(hwnd)
    _started["t"] = time.time()
    if task.chip:
        # Start suggestion: the chip sends its prompt itself.
        chip = wait_for(lambda: next(iter(find_all(root, lambda c: c.ControlTypeName == "ButtonControl"
                                                   and (c.Name or "").endswith(task.chip))), None),
                        30, f"the suggestion '{task.chip}'")
        log(f"[{name}] suggestion: {chip.Name}")
        press(chip)
    else:
        log(f"[{name}] prompt: {task.prompt}")
        box.GetValuePattern().SetValue(task.prompt)
        time.sleep(0.3)
        press(wait_for(lambda: button(root, "Senden"), 10, "the send button"))
    t0 = time.time()
    wait_for(lambda: button(root, "Abbrechen"), 20, "the turn to start")

    approvals, seen = 0, set()
    while time.time() - t0 < TURN_TIMEOUT:
        try:
            for b in find_all(root, lambda c: c.ControlTypeName == "ButtonControl"
                              and c.Name == "Erlauben"):
                rid = tuple(b.GetRuntimeId())
                if rid in seen:
                    continue
                seen.add(rid)
                approvals += 1
                press(b)
                log(f"[{name}] permission #{approvals} allowed")
            if button(root, "Senden") and not button(root, "Abbrechen"):
                break
        except Exception as e:  # noqa: BLE001 - UIA hiccups while the page re-renders
            log(f"[{name}] (UIA: {e!r}, retrying)")
        time.sleep(1)
    seconds = round(time.time() - t0)
    time.sleep(2)
    full = chat_text(hwnd)
    answer = full[len(before):] if full.startswith(before[:200]) else full
    ok, detail = task.check(answer)
    if name.startswith("report") or name == "sug-letter":
        ok_card, card = check_file_card(root)
        ok, detail = ok and ok_card, f"{detail} card={card}"
    shot(hwnd, f"widget-{name}.png")
    for w in uia.list_windows():
        if (w.process or "").lower() == task.window:
            shot(w.handle, f"widget-{name}-target.png")
            break
    log(f"[{name}] {'PASS' if ok else 'FAIL'} {seconds}s approvals={approvals} {detail}")
    log(f"[{name}] chat: {answer.strip()[-600:]!r}")
    return {"task": name, "ok": ok, "detail": detail, "seconds": seconds,
            "approvals": approvals, "chat": answer.strip()[-3000:]}


def check_file_card(root: auto.Control) -> tuple[bool, str]:
    """The "Neue Datei" card under the answer: 'Im Ordner zeigen' opens Explorer."""
    try:
        reveal = wait_for(lambda: button(root, "Im Ordner zeigen"), 15, "the new-file card")
    except TimeoutError:
        return False, "no card"
    before = {w.handle for w in uia.list_windows()}
    press(reveal)
    try:
        win = wait_for(lambda: next((w for w in uia.list_windows() if w.handle not in before
                                     and (w.process or "").lower() == "explorer.exe"), None),
                       15, "an Explorer window")
    except TimeoutError:
        return False, "card shown, Explorer did not open"
    shot(win.handle, "widget-file-card-explorer.png")
    return True, f"Explorer '{win.title}'"


def run_entry() -> str:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Run") as k:
            return str(winreg.QueryValueEx(k, "Aar")[0])
    except OSError:
        return ""


def check_uninstall(install_dir: Path) -> dict:
    """Silent uninstall removes the autostart value (NSIS hook)."""
    time.sleep(3)
    before = run_entry()
    uninstaller = install_dir / "uninstall.exe"
    subprocess.run([str(uninstaller), "/S"], capture_output=True)
    deadline = time.time() + 60
    while time.time() < deadline and run_entry():
        time.sleep(2)
    after = run_entry()
    ok = bool(before) and not after
    detail = f"before={before!r} after={after!r} uninstaller={uninstaller.exists()}"
    log(f"[uninstall] {'PASS' if ok else 'FAIL'} {detail}")
    return {"task": "uninstall", "ok": ok, "detail": detail}


def explorer_folders() -> list[str]:
    """Folders the open Explorer windows show (Shell.Application)."""
    ps = ("(New-Object -ComObject Shell.Application).Windows() | ForEach-Object { "
          "try { $_.Document.Folder.Self.Path } catch {} }")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
    return [line.strip() for line in r.stdout.splitlines() if line.strip()]


def run_context(hwnd: int) -> dict:
    """Header: context meter next to "Neues Gespräch" shows used / size after a turn
    (role=meter: UIA sees its aria-label, e.g. "Kontext: 5.120 von 16.384 Tokens belegt …")."""
    root = auto.ControlFromHandle(hwnd)

    def meter():
        hits = find_all(root, lambda c: c.AutomationId == "ctx-meter" or (c.Name or "").startswith("Kontext"))
        return next((h.Name for h in hits if re.search(r"Kontext: [\d.]+ von [\d.]+ Tokens", h.Name or "")), None)

    label = wait_for(meter, 30, "the context meter")
    m = re.search(r"Kontext: ([\d.]+) von ([\d.]+) Tokens", label)
    used, size = (int(g.replace(".", "")) for g in m.groups())
    ok = 0 < used < size
    shot(hwnd, "widget-context.png")
    detail = f"used={used} size={size} label={label[:80]!r}"
    log(f"[context] {'PASS' if ok else 'FAIL'} {detail}")
    return {"task": "context", "ok": ok, "detail": detail}


def run_diag(hwnd: int) -> dict:
    """Settings -> Fehlersuche: both links open Explorer at the right place, log has content."""
    root = auto.ControlFromHandle(hwnd)
    press(wait_for(lambda: button(root, "Einstellungen"), 10, "the settings button"))
    paths = wait_for(lambda: next(iter(find_all(
        root, lambda c: c.AutomationId == "diag-paths" and "Protokoll:" in (c.Name or ""))), None)
        or next(iter(find_all(root, lambda c: (c.Name or "").startswith("Gespräche: "))), None),
        10, "the diagnostic paths")
    shot(hwnd, "widget-settings.png")
    log_file = Path(os.environ["LOCALAPPDATA"]) / "de.aar.ui" / "logs" / "aar.log"
    log_text = log_file.read_text(encoding="utf-8", errors="replace") if log_file.is_file() else ""
    (OUT / "widget-aar.log").write_text(log_text, encoding="utf-8")
    before = {w.handle for w in uia.list_windows()}
    opened = {}
    for label, want in (("Protokoll anzeigen", "logs"), ("Gesprächsverläufe anzeigen", "sessions")):
        press(wait_for(lambda label=label: button(root, label), 10, label))
        win = wait_for(lambda want=want: next((w for w in uia.list_windows()
                       if w.handle not in before and want in w.title.lower()), None),
                       15, f"an Explorer window '{want}'")
        time.sleep(2)
        folders = explorer_folders()
        # The real folder, not "Documents" (Explorer rejects paths with mixed / and \).
        opened[want] = (win.title, [f for f in folders if f.lower().endswith(want if want == "logs" else "\\.agent\\sessions")])
        before.add(win.handle)
        shot(win.handle, f"widget-explorer-{want}.png")
    hint = next(iter(find_all(root, lambda c: c.AutomationId == "autostart-problem")), None)
    problem = hint.Name if hint else ""
    version = next(iter(find_all(root, lambda c: (c.Name or "").startswith("Aar Desktop "))), None)
    version_text = version.Name if version else ""
    import winreg

    run_entry = ""
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Run") as k:
            i = 0
            while True:
                name, value, _ = winreg.EnumValue(k, i)
                if "aar-desktop" in str(value).lower():
                    run_entry = f"{name}={value}"
                i += 1
    except OSError:
        pass
    ok = ("Agent starten" in log_text and len(opened) == 2 and all(v[1] for v in opened.values())
          and version_text.startswith("Aar Desktop") and " aar " in f" {version_text} "
          and "aar-desktop.exe" in run_entry.lower())
    detail = (f"paths={paths.Name!r} log_bytes={len(log_text)} explorer={opened} "
              f"version={version_text!r} autostart={run_entry!r} hint={problem!r}")
    log(f"[diag] {'PASS' if ok else 'FAIL'} {detail}")
    return {"task": "diag", "ok": ok, "detail": detail}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    app = subprocess.Popen([EXE])
    hwnd = widget_window(app.pid)
    log(f"widget window {hwnd}")
    time.sleep(3)
    shot(hwnd, "widget-start.png")
    root = auto.ControlFromHandle(hwnd)
    mascot = wait_for(lambda: next(iter(find_all(
        root, lambda c: c.Name.startswith("Aar – klicken"))), None), 30, "the mascot")
    press(mascot)  # UIA Invoke, like a screen reader
    time.sleep(3)

    def chat_open():
        return find_all(root, lambda c: c.ControlTypeName == "EditControl"
                        and c.AutomationId == "input")

    if chat_open():
        log("mascot: Invoke opened the chat")
    else:
        uia.focus(hwnd)
        mascot.Click(simulateMove=False)  # real mouse click
        wait_for(chat_open, 10, "the chat to open")
        log("mascot: Invoke did nothing, a real click opened the chat")
    shot(hwnd, "widget-open.png")
    rules = Path(os.environ["LOCALAPPDATA"]) / "de.aar.ui" / "rules" / "desktop.md"
    if rules.is_file():
        (OUT / "desktop-rules.md").write_bytes(rules.read_bytes())
    log(f"desktop rules for aar: {rules} exists={rules.is_file()}")
    names = list(TASKS) if SELECTED == "all" else SELECTED.split(",")
    results = []
    for name in names:
        try:
            if name == "diag":
                results.append(run_diag(hwnd))
            elif name == "context":
                results.append(run_context(hwnd))
            else:
                results.append(run(hwnd, name, TASKS[name]))
        except Exception as e:  # noqa: BLE001
            log(f"[{name}] ERROR {e!r}")
            shot(hwnd, f"widget-{name}-error.png")
            results.append({"task": name, "ok": False, "detail": repr(e)})
        (OUT / "widget.json").write_text(json.dumps(results, ensure_ascii=False, indent=2),
                                         encoding="utf-8")
    app.terminate()
    log_file = Path(os.environ["LOCALAPPDATA"]) / "de.aar.ui" / "logs" / "aar.log"
    if log_file.is_file():
        (OUT / "widget-aar.log").write_bytes(log_file.read_bytes())
    # Conversations with every tool call and result (why did a step fail?).
    sessions = HOME / ".agent" / "sessions"
    for f in sessions.glob("*.jsonl") if sessions.is_dir() else []:
        (OUT / "sessions").mkdir(exist_ok=True)
        (OUT / "sessions" / f.name).write_bytes(f.read_bytes())
    if "diag" in names:
        results.append(check_uninstall(Path(EXE).parent))
    log(f"widget: {sum(r['ok'] for r in results)}/{len(results)} passed")
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
