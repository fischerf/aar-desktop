"""List requirements that only apply on Windows and are missing from a target dir.

`pip install --platform win_amd64` (run on Linux) evaluates environment markers
against the *running* Linux interpreter, so Windows-only dependencies such as
`pywin32; sys_platform == "win32"` are silently skipped. This script reads the
installed `*.dist-info/METADATA` files in TARGET, evaluates every Requires-Dist
marker for a Windows CPython environment and prints the requirements that are
needed on Windows but not installed yet (one per line).

Usage: python3 win_markers.py TARGET PY_VERSION [ROOT_NAME EXTRAS]
       e.g. win_markers.py site-packages 3.13 aar-agent acp,mcp,windows

Requirements gated on `extra == ...` are only considered for ROOT_NAME and the
EXTRAS that were requested for it (e.g. `uiautomation; sys_platform ==
"win32" and extra == "windows"`); optional extras of other packages are not
part of the runtime.
"""

from __future__ import annotations

import sys
from email.parser import Parser
from pathlib import Path

try:
    from packaging.markers import Marker
    from packaging.requirements import Requirement
    from packaging.utils import canonicalize_name
except ImportError:  # pip vendors packaging
    from pip._vendor.packaging.markers import Marker  # type: ignore
    from pip._vendor.packaging.requirements import Requirement  # type: ignore
    from pip._vendor.packaging.utils import canonicalize_name  # type: ignore


def windows_env(py: str) -> dict[str, str]:
    return {
        "implementation_name": "cpython",
        "implementation_version": py + ".0",
        "os_name": "nt",
        "platform_machine": "AMD64",
        "platform_python_implementation": "CPython",
        "platform_release": "10",
        "platform_system": "Windows",
        "platform_version": "10.0.26100",
        "python_full_version": py + ".0",
        "python_version": py,
        "sys_platform": "win32",
        "extra": "",
    }


def main() -> None:
    target, py = Path(sys.argv[1]), sys.argv[2]
    root = canonicalize_name(sys.argv[3]) if len(sys.argv) > 3 else ""
    root_extras = [e for e in (sys.argv[4].split(",") if len(sys.argv) > 4 else []) if e]
    env = windows_env(py)
    installed: set[str] = set()
    metas = list(target.glob("*.dist-info/METADATA"))
    for meta in metas:
        name = Parser().parsestr(meta.read_text(encoding="utf-8", errors="replace")).get("Name", "")
        installed.add(canonicalize_name(name))

    missing: dict[str, str] = {}
    for meta in metas:
        msg = Parser().parsestr(meta.read_text(encoding="utf-8", errors="replace"))
        is_root = canonicalize_name(msg.get("Name", "")) == root
        for raw in msg.get_all("Requires-Dist") or []:
            req = Requirement(raw)
            if req.marker is None:
                continue
            marker_text = str(req.marker)
            if "extra" in marker_text:
                # Optional extras only count for the root package's requested extras.
                if not is_root or not any(
                    Marker(marker_text).evaluate({**env, "extra": e}) for e in root_extras
                ):
                    continue
            elif not Marker(marker_text).evaluate(env):
                continue
            key = canonicalize_name(req.name)
            if key not in installed:
                req.marker = None
                missing[key] = str(req)
    for line in sorted(missing.values()):
        print(line)


if __name__ == "__main__":
    main()
