"""Install and start MCP servers for Aar Desktop.

    python -m aar_desktop.mcp install <dir> <requirement>
        ``pip install --target <dir>``: every server gets its own complete set
        of packages (servers often need other versions than aar, e.g. mcp 2.x).
    python -m aar_desktop.mcp run <dir> <console-script> [args…]
        Start the server's console script with only <dir> in front of sys.path.
"""

from __future__ import annotations

import importlib.metadata as md
import sys
from pathlib import Path

from aar_desktop._site import PY_TAG, add_front, build_isolation_args, other_py_tag, pip_main, write_py_tag


def cmd_install(target: Path, requirement: str) -> int:
    target.mkdir(parents=True, exist_ok=True)
    code = pip_main(
        [
            "install",
            "--target",
            str(target),
            "--upgrade",
            "--prefer-binary",
            *build_isolation_args(),
            "--disable-pip-version-check",
            "--no-warn-script-location",
            "--progress-bar",
            "off",
            requirement,
        ]
    )
    if code == 0:
        write_py_tag(target)
    return code


def cmd_run(target: Path, script: str, args: list[str]) -> int:
    if not target.is_dir():
        print(f"MCP server not installed: {target}", file=sys.stderr)
        return 2
    other = other_py_tag(target)
    if other:
        # Would fail later with an obscure import error (e.g. pydantic_core).
        print(
            f"MCP server in {target} was installed for Python {other}, aar now runs {PY_TAG}: "
            "remove the server under Settings -> Tools and add it again.",
            file=sys.stderr,
        )
        return 4
    add_front(target)
    for dist in md.distributions(path=[str(target)]):
        for ep in dist.entry_points:
            if ep.group == "console_scripts" and ep.name == script:
                sys.argv = [script, *args]
                return int(ep.load()() or 0)
    print(f"{script!r} not found in {target}", file=sys.stderr)
    return 3


def main(argv: list[str]) -> int:
    if len(argv) >= 3 and argv[0] == "install":
        return cmd_install(Path(argv[1]), argv[2])
    if len(argv) >= 3 and argv[0] == "run":
        return cmd_run(Path(argv[1]), argv[2], argv[3:])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
