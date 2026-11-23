"""Start an MCP server installed by Aar Desktop (``aar_desktop.mcp run``) over
stdio and list its tools – the same command line the widget hands to aar.

    python.exe mcp_user_probe.py <server dir> <console script> <expected tool>
"""

import asyncio
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main(target: str, script: str, expected: str) -> int:
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "aar_desktop.mcp", "run", target, script],
        env={"PYTHONNOUSERSITE": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            tools = [t.name for t in (await session.list_tools()).tools]
            print(f"server={init.serverInfo.name} tools={tools}")
            return 0 if expected in tools else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(asyncio.wait_for(main(*sys.argv[1:4]), 120)))
