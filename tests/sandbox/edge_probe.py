"""Edge through the Windows MCP server, no LLM (run with the bundled runtime in the sandbox).

  python.exe edge_probe.py <out_dir>

Does what a model would do - launch Edge, find the address bar in the tree,
open a page with set_text(press_enter), read the page, search via the address
bar - and saves every tool result to <out_dir>/edge-*.txt (the model's view).
"""

from __future__ import annotations

import asyncio
import base64
import sys
import time
from pathlib import Path

OUT = Path(sys.argv[1])


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with open(OUT / "log.txt", "a", encoding="utf-8") as f:
        f.write(line + "\n")


async def main() -> int:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(command=sys.executable, args=["-m", "windows_mcp.server"])
    failures = 0
    async with stdio_client(params) as (read, write), ClientSession(read, write) as s:
        await s.initialize()
        step = 0

        async def call(tool: str, **args) -> str:
            nonlocal step, failures
            step += 1
            t0 = time.time()
            res = await s.call_tool(tool, args)
            text = "\n".join(getattr(c, "text", "") for c in res.content)
            for c in res.content:
                if getattr(c, "type", "") == "image":
                    (OUT / f"edge-{step:02d}.png").write_bytes(base64.b64decode(c.data))
            (OUT / f"edge-{step:02d}-{tool}.txt").write_text(
                f"{tool} {args}\nerror={res.isError} {time.time() - t0:.1f}s\n\n{text}", encoding="utf-8")
            failures += bool(res.isError)
            first = text.replace("\n", " | ")[:200]
            log(f"{step:02d} {'ERR' if res.isError else 'ok '} {tool} {args} ({time.time() - t0:.1f}s, "
                f"{len(text)} chars) -> {first}")
            return text

        def check(name: str, ok: bool) -> None:
            nonlocal failures
            failures += not ok
            log(f"{'PASS' if ok else 'FAIL'} {name}")

        await call("launch_app", name_or_path="Microsoft Edge", wait_seconds=30)
        await asyncio.sleep(5)
        tree = await call("get_ui_tree", window="Edge")
        addr = next((ln.split()[0] for ln in tree.splitlines()
                     if " Edit " in f" {ln.strip()} " and ("Adress" in ln or "address" in ln.lower())), None)
        check(f"address bar in tree ({addr})", addr is not None)
        addr = addr or "type=Edit"

        await call("set_text", window="Edge", element=addr, press_enter=True,
                   text="de.wikipedia.org/wiki/Sonnenuntergang")
        await asyncio.sleep(6)
        titles = await call("list_windows")
        check("page opened", "Sonnenuntergang" in titles)
        page = await call("read_text", window="Edge")
        check("read_text has the first sentence", "Sonnenuntergang ist der Moment" in page)

        tree = await call("get_ui_tree", window="Edge")
        addr = next((ln.split()[0] for ln in tree.splitlines()
                     if " Edit " in f" {ln.strip()} " and ("Adress" in ln or "address" in ln.lower())), addr)
        await call("set_text", window="Edge", element=addr, press_enter=True, text="Wetter Berlin")
        await asyncio.sleep(6)
        titles = await call("list_windows")
        check("search opened", "Wetter Berlin" in titles)
        page = await call("read_text", window="Edge")
        check("search results readable", "°" in page)
        await call("screenshot", window="Edge")
    log(f"edge probe: {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    sys.exit(asyncio.run(main()))
