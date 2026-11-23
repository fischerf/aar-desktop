"""Start the bundled Windows desktop MCP server over stdio and list its tools.

Run with the bundled runtime: python.exe mcp_probe.py  -> prints tool names, exit 0.
"""

import asyncio
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main() -> int:
    params = StdioServerParameters(command=sys.executable, args=["-m", "windows_mcp.server"])
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = (await session.list_tools()).tools
            for t in tools:
                ro = t.annotations.readOnlyHint if t.annotations else None
                print(f"{t.name} readOnly={ro}")
            return 0 if len(tools) >= 10 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
