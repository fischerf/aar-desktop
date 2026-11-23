"""Locations of user-installed add-ons and a pip runner."""

from __future__ import annotations

import os
import site
import sys
import sysconfig
from pathlib import Path

EXT_DIR_ENV = "AAR_DESKTOP_EXT_DIR"
MCP_DIR_ENV = "AAR_DESKTOP_MCP_DIR"


def ext_prefix() -> Path | None:
    value = os.environ.get(EXT_DIR_ENV, "").strip()
    return Path(value) if value else None


def prefix_site(prefix: Path) -> Path:
    """``site-packages`` of a ``pip install --prefix`` tree (``<prefix>\\Lib\\site-packages`` on Windows)."""
    return Path(sysconfig.get_path("purelib", vars={"base": str(prefix), "platbase": str(prefix)}))


def ext_site() -> Path | None:
    prefix = ext_prefix()
    return prefix_site(prefix) if prefix else None


def add_ext_site() -> Path | None:
    """Make extensions installed by Aar Desktop importable (after aar's own
    packages, so an extension can never replace one of them)."""
    path = ext_site()
    if path is None:
        return None
    path.mkdir(parents=True, exist_ok=True)
    site.addsitedir(str(path))
    return path


def add_front(path: Path) -> None:
    """Put a self-contained package dir (and its ``.pth`` entries) in front of
    everything else on ``sys.path``."""
    before = list(sys.path)
    site.addsitedir(str(path))
    added = [p for p in sys.path if p not in before]
    sys.path[:] = added + [p for p in sys.path if p not in added]


def embeddable() -> bool:
    """The bundled "embeddable" CPython (``._pth`` mode, ignores PYTHONPATH)."""
    return any(Path(sys.executable).parent.glob("python*._pth"))


def build_isolation_args() -> list[str]:
    """pip build isolation needs PYTHONPATH, which the embeddable Python ignores:
    there build with the bundled hatchling instead. A normal Python isolates."""
    return ["--no-build-isolation"] if embeddable() else []


def pip_main(args: list[str]) -> int:
    from pip._internal.cli.main import main

    return int(main(args) or 0)


def is_within(path: Path | str, root: Path | None) -> bool:
    if root is None:
        return False
    try:
        Path(os.path.realpath(path)).relative_to(os.path.realpath(root))
        return True
    except ValueError:
        return False
