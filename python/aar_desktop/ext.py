"""Manage aar extensions for Aar Desktop.

    python -m aar_desktop.ext list
        JSON (last line, prefixed with ``@@JSON ``): installed extensions and
        what each one hooks into (events, tools, slash-commands, prompt text),
        so the app can warn about extensions that change how aar works.
    python -m aar_desktop.ext install <dist-name> <source-url>
        ``pip install --prefix $AAR_DESKTOP_EXT_DIR`` without aar itself as a
        dependency (the registry packages depend on ``aar-agent``/``aar``, which
        are not on PyPI – ``aar`` there is an unrelated project).
    python -m aar_desktop.ext uninstall <dist-name>
        Only removes packages that live in ``$AAR_DESKTOP_EXT_DIR``.
"""

from __future__ import annotations

import asyncio
import contextlib
import importlib
import importlib.metadata as md
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from aar_desktop._site import add_ext_site, build_isolation_args, ext_prefix, ext_site, is_within, pip_main

#: Never installed as a dependency of an extension: aar comes with the app.
AAR_DISTS = {"aar", "aar-agent"}
LOAD_TIMEOUT = 20.0
PROMPT_PREVIEW = 600


def canonical(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def emit(data: Any) -> None:
    sys.stdout.write("@@JSON " + json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# list
# ---------------------------------------------------------------------------


def _entry_points() -> list[dict]:
    out = []
    for ep in md.entry_points(group="aar_extensions"):
        dist = getattr(ep, "dist", None)
        location = ""
        if dist is not None:
            with contextlib.suppress(Exception):
                location = str(dist.locate_file(""))
        out.append(
            {
                "name": ep.name,
                "source": "entrypoint",
                "path": ep.value,
                "dist": dist.metadata["Name"] if dist is not None else "",
                "version": dist.version if dist is not None else "",
                "managed": is_within(location, ext_site()) if location else False,
            }
        )
    return out


def _user_dir_extensions() -> list[dict]:
    from agent.extensions import loader

    out = []
    for info in loader._discover_directory(loader._DEFAULT_USER_DIR, "user"):
        out.append(
            {"name": info.name, "source": "user", "path": info.path, "dist": "", "version": "", "managed": False}
        )
    return out


def _side_effects(spec: Any) -> list[str]:
    effects = []
    for e in getattr(spec, "side_effects", None) or []:
        value = getattr(e, "value", e)
        if value and value != "none":
            effects.append(str(value))
    return effects


async def _inspect(entry: dict) -> None:
    from agent.extensions.loader import ExtensionInfo, load_extension

    info = ExtensionInfo(name=entry["name"], source=entry["source"], path=entry["path"])
    try:
        # Extensions may print while registering; keep stdout clean for the JSON.
        with contextlib.redirect_stdout(sys.stderr):
            api = await asyncio.wait_for(load_extension(info), LOAD_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 - reported to the user
        entry["error"] = str(exc) or type(exc).__name__
        return
    entry["hooks"] = sorted(k for k, v in api._event_handlers.items() if v)
    entry["tools"] = [
        {
            "name": t.name,
            "description": (t.description or "").strip()[:300],
            "sideEffects": _side_effects(t),
            "requiresApproval": bool(getattr(t, "requires_approval", False)),
        }
        for t in api._tools
    ]
    entry["commands"] = sorted(api._commands)
    prompt = "\n\n".join(p.strip() for p in api._system_prompt_parts if p and p.strip())
    entry["prompt"] = prompt[:PROMPT_PREVIEW] + ("…" if len(prompt) > PROMPT_PREVIEW else "")


def cmd_list() -> int:
    add_ext_site()
    try:
        from agent.extensions import loader
    except Exception as exc:  # noqa: BLE001
        emit({"ok": False, "error": f"aar not importable: {exc}"})
        return 1
    try:
        aar_version = md.version("aar-agent")
    except md.PackageNotFoundError:
        aar_version = ""
    entries = _entry_points() + _user_dir_extensions()
    for entry in entries:
        entry.update(hooks=[], tools=[], commands=[], prompt="", error=None)
        asyncio.run(_inspect(entry))
    emit(
        {
            "ok": True,
            "aarVersion": aar_version,
            "supportsDisable": hasattr(loader, "disabled_extension_names"),
            "extensions": entries,
        }
    )
    return 0


# ---------------------------------------------------------------------------
# install / uninstall
# ---------------------------------------------------------------------------


def _pip(args: list[str]) -> int:
    """pip in a child process that sees the extension dir (so already installed
    dependencies count as installed)."""
    cmd = [sys.executable, "-m", "aar_desktop.ext", "pip", *args]
    return subprocess.call(cmd)


def _common_args(prefix: Path) -> list[str]:
    return [
        "install",
        "--prefix",
        str(prefix),
        "--disable-pip-version-check",
        "--no-warn-script-location",
        "--progress-bar",
        "off",
    ]


def _find_dist(name: str) -> md.Distribution | None:
    importlib.invalidate_caches()
    want = canonical(name)
    for dist in md.distributions():
        if canonical(dist.metadata["Name"] or "") == want:
            return dist
    return None


def _missing_requirements(dist: md.Distribution) -> list[str]:
    from pip._vendor.packaging.requirements import Requirement

    missing = []
    for line in dist.requires or []:
        try:
            req = Requirement(line)
        except Exception:  # noqa: BLE001
            continue
        if canonical(req.name) in AAR_DISTS:
            continue
        if req.marker is not None and not req.marker.evaluate({"extra": ""}):
            continue
        try:
            have = md.version(req.name)
        except md.PackageNotFoundError:
            have = None
        if have is not None and (not req.specifier or req.specifier.contains(have, prereleases=True)):
            continue
        missing.append(str(req).split(";")[0].strip())
    return missing


def cmd_install(name: str, source: str) -> int:
    prefix = ext_prefix()
    if prefix is None:
        print("AAR_DESKTOP_EXT_DIR is not set", file=sys.stderr)
        return 2
    prefix.mkdir(parents=True, exist_ok=True)
    add_ext_site()
    print(f"@@STEP download {name}", flush=True)
    # The registry packages build with hatchling (bundled). Build isolation does
    # not work with the embeddable Python (it ignores PYTHONPATH).
    code = _pip([*_common_args(prefix), "--upgrade", "--no-deps", *build_isolation_args(), source])
    if code:
        return code
    dist = _find_dist(name)
    if dist is None:
        print(f"{name} was installed but cannot be found", file=sys.stderr)
        return 3
    missing = _missing_requirements(dist)
    if missing:
        print(f"@@STEP deps {' '.join(missing)}", flush=True)
        code = _pip([*_common_args(prefix), "--prefer-binary", *build_isolation_args(), *missing])
        if code:
            return code
    eps = [ep.name for ep in dist.entry_points if ep.group == "aar_extensions"]
    emit({"ok": True, "dist": dist.metadata["Name"], "version": dist.version, "entryPoints": eps})
    return 0


def cmd_uninstall(name: str) -> int:
    add_ext_site()
    dist = _find_dist(name)
    if dist is None:
        emit({"ok": True, "removed": False})
        return 0
    if not is_within(str(dist.locate_file("")), ext_site()):
        print(f"{name} is part of the app and cannot be removed", file=sys.stderr)
        return 4
    code = _pip(["uninstall", "-y", "--disable-pip-version-check", dist.metadata["Name"]])
    if code == 0:
        emit({"ok": True, "removed": True})
    return code


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    cmd, args = argv[0], argv[1:]
    if cmd == "list":
        return cmd_list()
    if cmd == "install" and len(args) == 2:
        return cmd_install(args[0], args[1])
    if cmd == "uninstall" and len(args) == 1:
        return cmd_uninstall(args[0])
    if cmd == "pip":
        add_ext_site()
        return pip_main(args)
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
