"""Fake ACP agent for UI development without an LLM.

Speaks just enough ACP (wire version 1) over stdio to exercise every widget
state: thinking, streaming text, tool calls, permission requests, errors.

Use it from the widget settings (Erweitert):
    Agent-Programm: python
    Argumente:      B:/Github_my/aar_ui/scripts/mock_acp_agent.py

Prompt keywords:  "datei" -> tool call with permission request
                  "fehler" -> failed tool call
                  anything else -> plain streamed answer
"""

from __future__ import annotations

import json
import sys
import threading
import time
import uuid

_lock = threading.Lock()
_next_id = 1000
_waiting: dict[int, dict] = {}
_events: dict[int, threading.Event] = {}
_cancel = threading.Event()


def write(obj: dict) -> None:
    with _lock:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def update(sid: str, upd: dict) -> None:
    write({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": sid, "update": upd}})


def ask(method: str, params: dict) -> dict:
    global _next_id
    _next_id += 1
    rid = _next_id
    ev = threading.Event()
    _events[rid] = ev
    write({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
    ev.wait()
    return _waiting.pop(rid, {})


def stream(sid: str, kind: str, text: str, delay: float = 0.03) -> None:
    for word in text.split(" "):
        if _cancel.is_set():
            return
        update(sid, {"sessionUpdate": kind, "content": {"type": "text", "text": word + " "}})
        time.sleep(delay)


CONFIG_OPTIONS = [
    {"id": "model", "name": "Model", "category": "model", "type": "select", "currentValue": "mock",
     "options": [{"value": "mock", "name": "mock/demo"}, {"value": "mock-fast", "name": "mock/fast"}]},
    {"id": "mode", "name": "Mode", "category": "mode", "type": "select", "currentValue": "review",
     "options": [{"value": "auto", "name": "Auto"}, {"value": "review", "name": "Review"},
                 {"value": "read-only", "name": "Read-only"}]},
]


def run_prompt(rid: int, sid: str, text: str) -> None:
    _cancel.clear()
    low = text.lower()
    stream(sid, "agent_thought_chunk", "Der Nutzer möchte etwas wissen. Ich überlege kurz, wie ich am besten helfe.", 0.05)
    if "datei" in low or "fehler" in low:
        tcid = "call_" + uuid.uuid4().hex[:8]
        failing = "fehler" in low
        name = "write_file" if not failing else "bash"
        raw = ({"path": "C:/Users/Demo/Desktop/notiz.txt", "content": "Hallo von Aar"}
               if not failing else {"command": "start excel.exe"})
        update(sid, {"sessionUpdate": "tool_call", "toolCallId": tcid, "title": name,
                     "kind": "edit" if not failing else "execute", "status": "pending", "rawInput": raw})
        resp = ask("session/request_permission", {
            "sessionId": sid,
            "toolCall": {"toolCallId": tcid, "title": name, "kind": "edit", "status": "pending", "rawInput": raw},
            "options": [
                {"optionId": "allow_once", "kind": "allow_once", "name": "Allow once"},
                {"optionId": "allow_always", "kind": "allow_always", "name": "Allow always"},
                {"optionId": "reject_once", "kind": "reject_once", "name": "Deny"},
                {"optionId": "reject_always", "kind": "reject_always", "name": "Deny always"},
            ],
        })
        outcome = resp.get("result", {}).get("outcome", {})
        allowed = outcome.get("outcome") == "selected" and str(outcome.get("optionId", "")).startswith("allow")
        if _cancel.is_set():
            write({"jsonrpc": "2.0", "id": rid, "result": {"stopReason": "cancelled"}})
            return
        update(sid, {"sessionUpdate": "tool_call_update", "toolCallId": tcid, "status": "in_progress"})
        time.sleep(1.2)
        ok = allowed and not failing
        msg = "Datei geschrieben (13 Bytes)." if ok else ("Fehler: excel.exe nicht gefunden" if allowed else "Vom Nutzer abgelehnt")
        update(sid, {"sessionUpdate": "tool_call_update", "toolCallId": tcid,
                     "status": "completed" if ok else "failed",
                     "content": [{"type": "content", "content": {"type": "text", "text": msg}}]})
        answer = ("Erledigt! Ich habe die **Notiz** auf deinem Desktop gespeichert." if ok
                  else "Das hat leider nicht geklappt. " + msg + ".")
    else:
        answer = ("Gern! Hier ein paar Dinge, die ich kann:\n\n"
                  "- Fragen beantworten\n- Dateien lesen und schreiben\n- Programme bedienen *(bald)*\n\n"
                  "Sag einfach `datei`, um eine Erlaubnis-Anfrage zu testen.")
    stream(sid, "agent_message_chunk", answer)
    write({"jsonrpc": "2.0", "id": rid,
           "result": {"stopReason": "cancelled" if _cancel.is_set() else "end_turn"}})


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        msg = json.loads(line)
        method, rid, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
        if method is None and rid is not None:  # response to our request
            _waiting[rid] = msg
            if ev := _events.pop(rid, None):
                ev.set()
        elif method == "initialize":
            write({"jsonrpc": "2.0", "id": rid, "result": {
                "protocolVersion": 1, "agentCapabilities": {"loadSession": False},
                "agentInfo": {"name": "mock", "title": "Mock Agent", "version": "0"}}})
        elif method == "session/new":
            write({"jsonrpc": "2.0", "id": rid, "result": {
                "sessionId": "mock-" + uuid.uuid4().hex[:8], "configOptions": CONFIG_OPTIONS}})
        elif method == "session/load":
            write({"jsonrpc": "2.0", "id": rid, "result": None})
        elif method == "session/prompt":
            text = " ".join(b.get("text", "") for b in params.get("prompt", []) if b.get("type") == "text")
            threading.Thread(target=run_prompt, args=(rid, params["sessionId"], text), daemon=True).start()
        elif method == "session/cancel":
            _cancel.set()
        elif method == "session/set_config_option":
            for o in CONFIG_OPTIONS:
                if o["id"] == params.get("configId"):
                    o["currentValue"] = params.get("value")
            write({"jsonrpc": "2.0", "id": rid, "result": {"configOptions": CONFIG_OPTIONS}})
        elif rid is not None:
            write({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"unknown {method}"}})


if __name__ == "__main__":
    main()
