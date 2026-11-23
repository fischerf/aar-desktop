"""End-to-end check inside Windows Sandbox: LLM -> aar (ACP) -> Windows MCP -> real program.

Talks ACP to the bundled aar exactly like the widget does (session/new with the
bundled Windows MCP server), asks the model to open a program, approves every
permission request and records what happened.

Usage (bundled runtime):
  python.exe e2e_agent.py <out.json> <model> [prompt]
Exit code 0 = the model called launch_app successfully and the window is open.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

OUT = Path(sys.argv[1])
MODEL = sys.argv[2]
PROMPT = (
    sys.argv[3]
    if len(sys.argv) > 3
    else "Öffne bitte das Windows-Programm Systeminformationen (msinfo32). "
    "Benutze dafür das Werkzeug launch_app. Antworte danach kurz auf Deutsch."
)
TIMEOUT_S = int(os.environ.get("AAR_E2E_TIMEOUT", "900"))
BASE_URL = os.environ.get("AAR_E2E_BASE_URL", "http://127.0.0.1:11434")
PY = sys.executable
TOOLS = str(Path(PY).parent / "aar-tools")

cmd = [PY, "-m", "agent.transports.cli", "acp", "--provider", "ollama", "--model", MODEL,
       "--base-url", BASE_URL]
proc = subprocess.Popen(
    cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    cwd=os.path.expanduser("~"),
    env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONNOUSERSITE": "1"},
)

lock = threading.Lock()
pending: dict[int, threading.Event] = {}
results: dict[int, dict] = {}
events: list[dict] = []
stderr_tail: list[str] = []
next_id = 0


def send(obj: dict) -> None:
    data = (json.dumps(obj) + "\n").encode("utf-8")
    with lock:
        assert proc.stdin
        proc.stdin.write(data)
        proc.stdin.flush()


def request(method: str, params: dict, timeout: float) -> dict:
    global next_id
    next_id += 1
    rid = next_id
    ev = threading.Event()
    pending[rid] = ev
    send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
    if not ev.wait(timeout):
        raise TimeoutError(f"{method} timed out after {timeout}s")
    return results.pop(rid)


def reader() -> None:
    assert proc.stdout
    for raw in proc.stdout:
        line = raw.decode("utf-8", "replace").strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "id" in msg and "method" in msg:
            if msg["method"] == "session/request_permission":
                tc = msg["params"].get("toolCall", {})
                events.append({"permission": tc.get("title"), "input": tc.get("rawInput")})
                send({"jsonrpc": "2.0", "id": msg["id"],
                      "result": {"outcome": {"outcome": "selected", "optionId": "allow_once"}}})
            else:
                send({"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "n/a"}})
        elif "id" in msg:
            results[msg["id"]] = msg
            if ev := pending.pop(msg["id"], None):
                ev.set()
        elif msg.get("method") == "session/update":
            u = msg["params"]["update"]
            kind = u.get("sessionUpdate")
            if kind in ("tool_call", "tool_call_update"):
                text = " ".join(
                    c.get("content", {}).get("text", "")
                    for c in (u.get("content") or [])
                    if isinstance(c, dict) and c.get("type") == "content"
                )
                events.append({kind: u.get("title") or u.get("toolCallId"), "status": u.get("status"),
                               "input": u.get("rawInput"), "text": text[:400]})
            elif kind == "agent_message_chunk":
                t = u.get("content", {}).get("text", "")
                if events and "answer" in events[-1]:
                    events[-1]["answer"] += t
                else:
                    events.append({"answer": t})


def err_reader() -> None:
    assert proc.stderr
    for raw in proc.stderr:
        stderr_tail.append(raw.decode("utf-8", "replace").rstrip())
        del stderr_tail[:-60]


threading.Thread(target=reader, daemon=True).start()
threading.Thread(target=err_reader, daemon=True).start()

report: dict = {"model": MODEL, "prompt": PROMPT}
ok = False
started = time.time()
try:
    request("initialize", {"protocolVersion": 1, "clientCapabilities": {},
                           "clientInfo": {"name": "aar-ui-e2e", "version": "0"}}, 120)
    windows_mcp = {"name": "windows", "command": PY, "args": ["-m", "windows_mcp.server"],
                   "env": [{"name": "PYTHONNOUSERSITE", "value": "1"}]}
    sess = request("session/new", {"cwd": os.path.expanduser("~"), "mcpServers": [windows_mcp]}, 180)
    sid = sess["result"]["sessionId"]
    resp = request("session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": PROMPT}]},
                   TIMEOUT_S)
    report["stopReason"] = resp.get("result", {}).get("stopReason")
    report["error"] = resp.get("error")
except Exception as e:  # noqa: BLE001
    report["error"] = repr(e)
finally:
    report["seconds"] = round(time.time() - started)
    report["events"] = events
    report["stderr_tail"] = stderr_tail[-25:]
    # tool_call carries the title; later updates usually only the id.
    launched = any("launch_app" in str(e.get("tool_call") or e.get("permission") or "") for e in events)
    tasks = subprocess.run(["tasklist", "/FI", "IMAGENAME eq msinfo32.exe"], capture_output=True)
    window_open = b"msinfo32.exe" in tasks.stdout.lower()
    report["launch_app_called"] = launched
    report["approval_asked"] = any("permission" in e for e in events)
    report["msinfo32_running"] = window_open
    ok = launched and window_open
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    proc.terminate()

sys.exit(0 if ok else 1)
