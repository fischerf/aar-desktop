"""Everyday desktop tasks for the LLM inside Windows Sandbox (bundled runtime).

  python.exe desktop_tasks.py <out_dir> <llm_url> <model> <task,task,...|all> [num_ctx]

Each task is a prompt a user could type into the widget. It runs through aar
(ACP, every permission answered "allow once") with the bundled Windows MCP
server, exactly like e2e_agent.py; afterwards the outcome is checked on the
machine (file, registry, clipboard, window title, answer text) and the target
window is saved as a screenshot. Results: <out_dir>/tasks.json.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import winreg
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

OUT, URL, MODEL = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
SELECTED = sys.argv[4] if len(sys.argv) > 4 else "all"
NUM_CTX = int(sys.argv[5]) if len(sys.argv) > 5 else 32768
# Further Ollama options from desktop_inside.ps1, e.g. {"num_gpu": 0} for -Cpu.
LLM_EXTRA = {**json.loads(os.environ.get("AAR_TEST_LLM_EXTRA") or "{}"), "num_ctx": NUM_CTX}
HOME = Path.home()


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with open(OUT / "log.txt", "a", encoding="utf-8") as f:
        f.write(line + "\n")


def ps(command: str) -> str:
    r = subprocess.run(["powershell", "-NoProfile", "-Command", command],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.stdout.strip()


def window_titles(process: str) -> list[str]:
    from windows_mcp import uia

    return [w.title for w in uia.list_windows() if (w.process or "").lower() == process]


@dataclass
class Task:
    prompt: str
    check: Callable[[str], tuple[bool, str]]
    window: str = ""  # process whose window is saved as a screenshot
    kill: list[str] = field(default_factory=list)
    reset: Callable[[], None] | None = None


def _light_theme() -> int:
    key = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as k:
            return int(winreg.QueryValueEx(k, "AppsUseLightTheme")[0])
    except OSError:
        return 1


def _set_light_theme() -> None:
    key = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key) as k:
        for name in ("AppsUseLightTheme", "SystemUsesLightTheme"):
            winreg.SetValueEx(k, name, 0, winreg.REG_DWORD, 1)


def _ram_gb() -> float:
    return int(ps("(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory")) / 2**30


def check_paint(answer: str) -> tuple[bool, str]:
    titles = window_titles("mspaint.exe")
    return bool(titles), f"Paint open: {titles} (picture: see screenshot)"


def check_wiki(answer: str) -> tuple[bool, str]:
    titles = window_titles("msedge.exe")
    on_page = any("Sonnenuntergang" in t for t in titles)
    said = bool(re.search(r"Horizont|Sonne", answer))
    return on_page and said, f"edge titles={titles} answer_mentions_sun={said}"


def check_search(answer: str) -> tuple[bool, str]:
    titles = window_titles("msedge.exe")
    temp = re.search(r"-?\d+\s*(°|Grad)", answer)
    return bool(titles) and bool(temp), f"edge titles={titles} temperature={temp and temp.group(0)}"


FOLDER = HOME / "Documents" / "Urlaub 2026"


def check_folder(answer: str) -> tuple[bool, str]:
    return FOLDER.is_dir(), f"{FOLDER} exists={FOLDER.is_dir()}"


def check_dark(answer: str) -> tuple[bool, str]:
    v = _light_theme()
    return v == 0, f"AppsUseLightTheme={v}"


def check_ram(answer: str) -> tuple[bool, str]:
    gb = _ram_gb()
    nums = [float(n.replace(",", ".")) for n in re.findall(r"\d+(?:[.,]\d+)?", answer)]
    ok = any(abs(n - gb) <= 0.6 for n in nums) or any(abs(n - gb * 1024) <= 600 for n in nums)
    return ok, f"real={gb:.1f} GB, numbers in answer={nums[:8]}"


def check_charmap(answer: str) -> tuple[bool, str]:
    clip = ps("Get-Clipboard -Raw")
    return "©" in clip, f"clipboard={clip[:40]!r}"


TASKS: dict[str, Task] = {
    "paint": Task("Male bitte einen Sonnenuntergang in Paint.", check_paint, "mspaint.exe",
                  ["mspaint.exe"]),
    "edge-wiki": Task(
        "Öffne in Microsoft Edge die Wikipedia-Seite über den Sonnenuntergang "
        "(de.wikipedia.org/wiki/Sonnenuntergang) und sag mir, was im ersten Satz steht.",
        check_wiki, "msedge.exe", ["msedge.exe"]),
    "edge-search": Task("Suche bitte in Edge nach dem Wetter in Berlin und sag mir die aktuelle "
                        "Temperatur.", check_search, "msedge.exe", ["msedge.exe"]),
    "explorer": Task("Lege bitte im Explorer in meinem Ordner Dokumente einen neuen Ordner mit "
                     "dem Namen \"Urlaub 2026\" an.", check_folder, "explorer.exe",
                     reset=lambda: FOLDER.is_dir() and FOLDER.rmdir()),
    "settings": Task("Stell Windows bitte auf den dunklen Modus um.", check_dark,
                     "SystemSettings.exe", ["SystemSettings.exe"], _set_light_theme),
    "taskmgr": Task("Schau bitte im Task-Manager nach, wie viel Arbeitsspeicher dieser "
                    "Computer hat.", check_ram, "Taskmgr.exe", ["Taskmgr.exe"]),
    "charmap": Task("Such bitte in der Zeichentabelle das Copyright-Zeichen heraus und kopiere "
                    "es in die Zwischenablage.", check_charmap, "charmap.exe", ["charmap.exe"],
                    lambda: ps("Set-Clipboard -Value 'leer'") and None),
}


def tool_counts(events: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for e in events:
        if "tool_call" in e:
            name = str(e["tool_call"]).split("__")[-1].split(" ")[0]
            counts[name] = counts.get(name, 0) + 1
    return counts


def run(name: str, task: Task) -> dict:
    from windows_mcp import uia

    for proc in task.kill:
        subprocess.run(["taskkill", "/F", "/IM", proc], capture_output=True)
    if task.reset:
        task.reset()
    time.sleep(1)
    log(f"[{name}] {task.prompt}")
    report_file = OUT / f"task-{name}.json"
    env = {**os.environ, "AAR_E2E_BASE_URL": URL, "AAR_E2E_TIMEOUT": "1500"}
    t0 = time.time()
    with open(OUT / f"task-{name}.log", "wb") as f:
        subprocess.run([sys.executable, str(Path(__file__).with_name("e2e_agent.py")),
                        str(report_file), MODEL, task.prompt], env=env, stdout=f,
                       stderr=subprocess.STDOUT)
    seconds = round(time.time() - t0)
    report = json.loads(report_file.read_text(encoding="utf-8"))
    answer = "".join(e.get("answer", "") for e in report["events"])
    tools = tool_counts(report["events"])
    try:
        ok, detail = task.check(answer)
    except Exception as e:  # noqa: BLE001
        ok, detail = False, f"check failed: {e!r}"
    for w in uia.list_windows():
        if task.window and (w.process or "").lower() == task.window.lower():
            png, _, _ = uia.screenshot(w.handle, 1600)
            (OUT / f"task-{name}.png").write_bytes(png)
            break
    result = {"task": name, "ok": ok, "detail": detail, "seconds": seconds, "tools": tools,
              "error": report.get("error"), "answer": answer.strip()[-500:]}
    log(f"[{name}] {'PASS' if ok else 'FAIL'} {seconds}s tools={tools} {detail}")
    log(f"[{name}] answer: {answer.strip()[-300:]!r}")
    return result


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    cfg = HOME / ".aar" / "config.json"
    cfg.parent.mkdir(exist_ok=True)
    cfg.write_text(json.dumps({"provider": {"name": "ollama", "model": MODEL, "base_url": URL,
                                            "extra": LLM_EXTRA}}), encoding="utf-8")
    names = list(TASKS) if SELECTED == "all" else SELECTED.split(",")
    log(f"model {MODEL} via {URL}, options={LLM_EXTRA}, tasks: {', '.join(names)}")
    results = []
    for name in names:
        results.append(run(name, TASKS[name]))
        (OUT / "tasks.json").write_text(json.dumps(results, ensure_ascii=False, indent=2),
                                        encoding="utf-8")
    log(f"{sum(r['ok'] for r in results)}/{len(results)} tasks passed")
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
