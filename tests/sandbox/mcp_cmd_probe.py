"""Start any stdio MCP server, list its tools and optionally call one.

    python.exe mcp_cmd_probe.py <expected tool> <call tool|-> <call args JSON> -- <command> [args…]

Prints ``tools=[…]`` and ``call=<text>``; exit 0 when the expected tool exists
and the call (if any) did not fail.
"""

import asyncio
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main(expected: str, call: str, call_args: str, command: list[str]) -> int:
    # Full environment: the SDK passes only a few variables by default.
    params = StdioServerParameters(command=command[0], args=command[1:], env=dict(os.environ))
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            tools = {t.name: t for t in (await session.list_tools()).tools}
            print(f"server={init.serverInfo.name} count={len(tools)} tools={sorted(tools)}", flush=True)
            if expected not in tools:
                return 1
            if call == "-":
                return 0
            print(f"schema={json.dumps(tools[call].inputSchema)[:400]}", flush=True)
            result = await session.call_tool(call, json.loads(call_args))
            text = " ".join(getattr(c, "text", "") for c in result.content)
            print(f"call_error={result.isError} call={text[:600]!r}", flush=True)
            return 1 if result.isError else 0


if __name__ == "__main__":
    sep = sys.argv.index("--")
    expected, call, call_args = sys.argv[1:4]
    sys.exit(asyncio.run(asyncio.wait_for(main(expected, call, call_args, sys.argv[sep + 1 :]), 240)))
