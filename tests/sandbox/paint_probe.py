"""Paint experiment inside Windows Sandbox (run with the bundled runtime).

  python.exe paint_probe.py <probe|script> <out_dir>

probe : start Paint, dump its UI tree with screen rectangles, try a mouse drag
script: draw a sunset through the MCP server's tools, no LLM (proves the tools suffice)
The LLM version of the task is "paint" in desktop_tasks.py.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

MODE, OUT = sys.argv[1], Path(sys.argv[2])


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with open(OUT / "log.txt", "a", encoding="utf-8") as f:
        f.write(line + "\n")


def save_shot(name: str, hwnd: int | None = None) -> None:
    from windows_mcp import uia

    png, w, h = uia.screenshot(hwnd, 1600)
    (OUT / name).write_bytes(png)
    log(f"screenshot {name} {w}x{h}")


def dump_rects(hwnd: int, path: Path) -> None:
    """Every element with type, name, automation id and screen rectangle."""
    import uiautomation as auto

    root = auto.ControlFromHandle(hwnd)
    lines: list[str] = []

    def walk(c, depth: int) -> None:
        if len(lines) > 3000 or depth > 40:
            return
        try:
            r = c.BoundingRectangle
            lines.append(
                f"{'  ' * depth}{c.ControlTypeName} \"{c.Name}\" #{c.AutomationId} "
                f"cls={c.ClassName} rect=({r.left},{r.top},{r.right},{r.bottom})"
            )
            for ch in c.GetChildren():
                walk(ch, depth + 1)
        except Exception as e:  # noqa: BLE001
            lines.append(f"{'  ' * depth}! {e}")

    walk(root, 0)
    path.write_text("\n".join(lines), encoding="utf-8")
    log(f"rects: {len(lines)} elements -> {path.name}")


def start_paint() -> int:
    from windows_mcp import uia

    log("launch: " + uia.launch("Paint", "", 30).replace("\n", " | "))
    time.sleep(3)
    for w in uia.list_windows():
        if "paint" in (w.process or "").lower() or "paint" in w.title.lower():
            log(f"paint window {w.line()}")
            return w.handle
    raise SystemExit("no Paint window")


def probe() -> int:
    import ctypes

    import uiautomation as auto
    from windows_mcp import uia

    ctypes.windll.user32.SetProcessDPIAware()
    log(f"screen {ctypes.windll.user32.GetSystemMetrics(0)}x{ctypes.windll.user32.GetSystemMetrics(1)}")
    hwnd = start_paint()
    uia.focus(hwnd)
    time.sleep(1)
    save_shot("paint-start.png")
    (OUT / "tree.txt").write_text(uia.ui_tree(hwnd, 30, 800), encoding="utf-8")
    dump_rects(hwnd, OUT / "rects.txt")
    # Raw drag in the window centre with whatever tool is active.
    r = auto.ControlFromHandle(hwnd).BoundingRectangle
    cx, cy = r.xcenter(), r.ycenter()
    auto.PressMouse(cx - 100, cy)
    for i in range(1, 21):
        auto.MoveTo(cx - 100 + i * 10, cy + (i % 5) * 8, moveSpeed=0, waitTime=0.01)
    auto.ReleaseMouse(waitTime=0.2)
    time.sleep(0.5)
    save_shot("paint-drag.png")
    return 0


# Sunset from Paint's own tools: fill bands separated by lines, an oval sun on the
# horizon, brush strokes on the sea. Canvas positions are fractions (0..1).
W_SUN = 120 / 2448  # sun radius 120 px; the default canvas is 2448x1012 px in the sandbox
H_SUN = 120 / 1012
RECIPE: list[tuple[str, dict]] = [
    ("click_element", {"element": "type=Button;name=Füllen"}),
    ("click_element", {"element": "type=ListItem;name=Lila"}),
    ("click_at", {"element": "automation_id=image", "x": 0.5, "y": 0.5}),
    ("shot", {"name": "step1-fill.png"}),
    ("click_element", {"element": "type=Button;name=Linie"}),
    ("click_element", {"element": "type=ListItem;name=Rot"}),
    ("drag", {"element": "automation_id=image", "points": [[0, 0.15], [1, 0.15]]}),
    ("click_element", {"element": "type=Button;name=Linie"}),
    ("click_element", {"element": "type=ListItem;name=Orange"}),
    ("drag", {"element": "automation_id=image", "points": [[0, 0.3], [1, 0.3]]}),
    ("click_element", {"element": "type=Button;name=Linie"}),
    ("click_element", {"element": "type=ListItem;name=Gold"}),
    ("drag", {"element": "automation_id=image", "points": [[0, 0.45], [1, 0.45]]}),
    ("click_element", {"element": "type=Button;name=Linie"}),
    ("click_element", {"element": "type=ListItem;name=Indigoblau"}),
    ("drag", {"element": "automation_id=image", "points": [[0, 0.6], [1, 0.6]]}),
    ("click_element", {"element": "type=Button;name=Oval"}),
    ("click_element", {"element": "type=ListItem;name=Gelb"}),
    ("drag", {"element": "automation_id=image",
              "points": [[0.5 - W_SUN, 0.6 - H_SUN], [0.5 + W_SUN, 0.6 + H_SUN]]}),
    ("shot", {"name": "step2-lines.png"}),
    ("click_element", {"element": "type=Button;name=Füllen"}),
    ("click_element", {"element": "type=ListItem;name=Rot"}),
    ("click_at", {"element": "automation_id=image", "x": 0.1, "y": 0.22}),
    ("click_element", {"element": "type=ListItem;name=Orange"}),
    ("click_at", {"element": "automation_id=image", "x": 0.1, "y": 0.37}),
    ("click_element", {"element": "type=ListItem;name=Gold"}),
    ("click_at", {"element": "automation_id=image", "x": 0.1, "y": 0.52}),
    ("click_element", {"element": "type=ListItem;name=Indigoblau"}),
    ("click_at", {"element": "automation_id=image", "x": 0.1, "y": 0.8}),
    ("click_element", {"element": "type=ListItem;name=Gelb"}),
    ("click_at", {"element": "automation_id=image", "x": 0.5, "y": 0.55}),
    ("click_element", {"element": "type=ListItem;name=Orange"}),
    ("click_at", {"element": "automation_id=image", "x": 0.5, "y": 0.66}),
    ("click_element", {"element": "automation_id=BrushesSplitButton"}),
    ("click_element", {"element": "type=ListItem;name=Helltürkis"}),
    *[
        ("drag", {"element": "automation_id=image",
                  "points": [[x + i * 0.02, y + (0.008 if i % 2 else 0)] for i in range(6)]})
        for x, y in ((0.15, 0.7), (0.3, 0.82), (0.65, 0.75), (0.78, 0.9), (0.4, 0.93))
    ],
    ("shot", {"name": "step3-done.png"}),
]


async def scripted() -> int:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(command=sys.executable, args=["-m", "windows_mcp.server"])
    failures = 0
    async with stdio_client(params) as (read, write), ClientSession(read, write) as s:
        await s.initialize()
        tools = [t.name for t in (await s.list_tools()).tools]
        log(f"tools: {', '.join(tools)}")
        res = await s.call_tool("launch_app", {"name_or_path": "Paint", "wait_seconds": 30})
        log("launch_app: " + res.content[0].text.replace("\n", " | "))
        await s.call_tool("focus_window", {"window": "Paint"})
        for tool, args in RECIPE:
            if tool == "shot":
                res = await s.call_tool("screenshot", {"window": "Paint", "max_width": 1600})
                import base64

                (OUT / args["name"]).write_bytes(base64.b64decode(res.content[0].data))
                log(f"shot {args['name']}")
                continue
            res = await s.call_tool(tool, {"window": "Paint", **args})
            text = " ".join(getattr(c, "text", "") for c in res.content).replace("\n", " | ")
            failures += bool(res.isError)
            log(f"{'ERR' if res.isError else 'ok '} {tool} {json.dumps(args, ensure_ascii=False)[:90]} -> {text[:160]}")
    log(f"scripted sunset: {failures} failed calls")
    return 1 if failures else 0


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    if MODE == "probe":
        return probe()
    if MODE == "script":
        import asyncio

        return asyncio.run(scripted())
    raise SystemExit(f"mode {MODE} not implemented yet")


if __name__ == "__main__":
    sys.exit(main())
