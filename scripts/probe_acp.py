"""Dev helper: talk raw ACP JSON-RPC to `aar acp` and print every frame.

Usage:  python scripts/probe_acp.py ["prompt text"]

Useful to check the wire format the widget has to handle (initialize,
session/new, session/update notifications, session/request_permission).
Permission requests are answered with "reject_once" so nothing is executed.
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time

PROMPT = sys.argv[1] if len(sys.argv) > 1 else "Sag kurz hallo."

import os
import shlex

# Extra flags for `aar acp`, e.g. AAR_ACP_ARGS="--provider qwen3.8 --base-url http://localhost:11434"
EXTRA = shlex.split(os.environ.get("AAR_ACP_ARGS", ""))

# Agent command, e.g. AAR_ACP_CMD="dist/runtime/python.exe -m agent.transports.cli"
BASE = [t.strip('"') for t in shlex.split(os.environ.get("AAR_ACP_CMD", "aar"), posix=False)]

proc = subprocess.Popen(
    [*BASE, "acp", *EXTRA],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    encoding="utf-8",
    bufsize=1,
)

_next_id = 0
_pending: dict[int, threading.Event] = {}
_results: dict[int, dict] = {}


def send(obj: dict) -> None:
    line = json.dumps(obj)
    print(">>>", line[:400], flush=True)
    assert proc.stdin
    proc.stdin.write(line + "\n")
    proc.stdin.flush()


def request(method: str, params: dict, timeout: float = 120) -> dict:
    global _next_id
    _next_id += 1
    rid = _next_id
    ev = threading.Event()
    _pending[rid] = ev
    send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
    ev.wait(timeout)
    return _results.get(rid, {})


def reader() -> None:
    assert proc.stdout
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        print("<<<", line[:1200], flush=True)
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "id" in msg and "method" in msg:  # request from agent -> client
            if msg["method"] == "session/request_permission":
                send({"jsonrpc": "2.0", "id": msg["id"],
                      "result": {"outcome": {"outcome": "selected", "optionId": "reject_once"}}})
            else:
                send({"jsonrpc": "2.0", "id": msg["id"],
                      "error": {"code": -32601, "message": "not supported"}})
        elif "id" in msg:
            _results[msg["id"]] = msg
            if ev := _pending.get(msg["id"]):
                ev.set()


def stderr_reader() -> None:
    assert proc.stderr
    for line in proc.stderr:
        print("ERR", line.rstrip()[:300], flush=True)


threading.Thread(target=reader, daemon=True).start()
threading.Thread(target=stderr_reader, daemon=True).start()

request("initialize", {
    "protocolVersion": 1,
    "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}, "terminal": False},
    "clientInfo": {"name": "aar-ui-probe", "version": "0.0.1"},
})
new = request("session/new", {"cwd": str(__import__("pathlib").Path.home()), "mcpServers": []})
sid = new.get("result", {}).get("sessionId")
if sid and PROMPT != "-":
    request("session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": PROMPT}]}, timeout=300)
time.sleep(0.5)
proc.terminate()
