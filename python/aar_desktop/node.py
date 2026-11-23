"""Node.js-based MCP servers for Aar Desktop.

Office PCs rarely have Node.js, so the app keeps a portable Node LTS in
``$AAR_DESKTOP_NODE_DIR`` (downloaded once from nodejs.org, SHA-256 checked).

    python -m aar_desktop.node ensure
        Download/unpack the portable Node.js if it is missing.
    python -m aar_desktop.node install <dir> <npm spec> [bin name]
        ``npm install --prefix <dir> <spec>`` and write ``<dir>/launch.json``
        with the JavaScript file to start (from the package's ``bin``).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

NODE_DIR_ENV = "AAR_DESKTOP_NODE_DIR"
DIST = "https://nodejs.org/dist"
#: memory server needs >= 24; chrome-devtools-mcp ^20.19 || ^22.12 || >= 23.
MIN_MAJOR = 24
USER_AGENT = "aar-desktop"


def node_dir() -> Path:
    value = os.environ.get(NODE_DIR_ENV, "").strip()
    if not value:
        raise SystemExit(f"{NODE_DIR_ENV} is not set")
    return Path(value)


def node_exe(root: Path) -> Path:
    return root / ("node.exe" if os.name == "nt" else "bin/node")


def npm_cli(root: Path) -> Path:
    base = root if os.name == "nt" else root / "lib"
    return base / "node_modules" / "npm" / "bin" / "npm-cli.js"


def _ssl_context() -> ssl.SSLContext:
    """Verify against the Windows certificate store (like pip): the embeddable
    Python finds no root certificates on a fresh Windows, and company proxies
    with their own CA are only trusted there. Fallback: certifi."""
    try:
        from pip._vendor import truststore

        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:  # noqa: BLE001
        pass
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001
        return ssl.create_default_context()


_CTX: ssl.SSLContext | None = None


def _open(url: str):
    global _CTX
    if _CTX is None:
        _CTX = _ssl_context()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(req, timeout=60, context=_CTX)


def _get(url: str) -> bytes:
    with _open(url) as r:
        return r.read()


def _platform() -> tuple[str, str]:
    """(index.json file tag, archive suffix)."""
    if os.name == "nt":
        return "win-x64-zip", "win-x64.zip"
    return "linux-x64", "linux-x64.tar.xz"  # only for tests on Linux


def installed_version(root: Path) -> str | None:
    exe = node_exe(root)
    if not exe.is_file():
        return None
    try:
        out = subprocess.run([str(exe), "--version"], capture_output=True, text=True, timeout=30)
    except OSError:
        return None
    return out.stdout.strip() or None


def latest_lts() -> str:
    tag, _ = _platform()
    for entry in json.loads(_get(f"{DIST}/index.json")):
        major = int(entry["version"].lstrip("v").split(".")[0])
        if entry.get("lts") and tag in entry.get("files", []) and major >= MIN_MAJOR:
            return entry["version"]
    raise RuntimeError("no suitable Node.js LTS found")


def _download(url: str, dest: Path) -> None:
    with _open(url) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = last = 0
        while chunk := r.read(1 << 16):
            f.write(chunk)
            done += len(chunk)
            pct = done * 100 // total if total else 0
            if pct >= last + 10:
                last = pct
                print(f"Node.js {pct}% ({done >> 20} MB)", flush=True)


def ensure() -> Path:
    root = node_dir()
    have = installed_version(root)
    if have and int(have.lstrip("v").split(".")[0]) >= MIN_MAJOR:
        return root
    version = latest_lts()
    _, suffix = _platform()
    name = f"node-{version}-{suffix}"
    print(f"@@STEP node {version}", flush=True)
    sums = _get(f"{DIST}/{version}/SHASUMS256.txt").decode()
    m = re.search(rf"^([0-9a-f]{{64}})\s+{re.escape(name)}$", sums, re.M)
    if not m:
        raise RuntimeError(f"no checksum for {name}")
    tmp = Path(tempfile.mkdtemp(prefix="aar-node-"))
    try:
        archive = tmp / name
        _download(f"{DIST}/{version}/{name}", archive)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        if digest != m.group(1):
            raise RuntimeError(f"checksum mismatch for {name}")
        unpacked = tmp / "x"
        if name.endswith(".zip"):
            with zipfile.ZipFile(archive) as z:
                z.extractall(unpacked)
        else:
            shutil.unpack_archive(str(archive), str(unpacked))
        inner = next(unpacked.iterdir())
        if root.exists():
            shutil.rmtree(root)
        root.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(inner), str(root))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"Node.js {installed_version(root)}", flush=True)
    return root


def package_name(spec: str) -> str:
    """``@playwright/mcp@latest`` -> ``@playwright/mcp``, ``x@1.2`` -> ``x``."""
    at = spec.find("@", 1)
    return spec if at < 0 else spec[:at]


def resolve_bin(target: Path, spec: str, bin_name: str = "") -> Path:
    pkg = package_name(spec)
    pkg_dir = target / "node_modules" / Path(*pkg.split("/"))
    meta = json.loads((pkg_dir / "package.json").read_text(encoding="utf-8"))
    bins = meta.get("bin")
    if isinstance(bins, str):
        rel = bins
    elif isinstance(bins, dict) and bins:
        rel = bins.get(bin_name) or bins.get(pkg.split("/")[-1]) or next(iter(bins.values()))
    else:
        raise RuntimeError(f"{pkg} has no executable (bin)")
    return (pkg_dir / rel).resolve()


def install(target: Path, spec: str, bin_name: str = "") -> int:
    root = ensure()
    target.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["PATH"] = str(node_exe(root).parent) + os.pathsep + env.get("PATH", "")
    env.setdefault("npm_config_update_notifier", "false")
    env.setdefault("npm_config_fund", "false")
    env.setdefault("npm_config_audit", "false")
    # Also trust the Windows certificate store (company proxies with their own CA).
    env.setdefault("NODE_USE_SYSTEM_CA", "1")
    print(f"@@STEP npm {spec}", flush=True)
    code = subprocess.call(
        [str(node_exe(root)), str(npm_cli(root)), "install", "--prefix", str(target), "--omit=dev", "--no-save", spec],
        env=env,
    )
    if code:
        return code
    bin_path = resolve_bin(target, spec, bin_name)
    (target / "launch.json").write_text(
        json.dumps({"bin": str(bin_path.relative_to(target.resolve())), "spec": spec}), encoding="utf-8"
    )
    print(f"@@JSON {json.dumps({'ok': True, 'bin': str(bin_path)})}", flush=True)
    return 0


def main(argv: list[str]) -> int:
    if argv[:1] == ["ensure"]:
        ensure()
        return 0
    if len(argv) >= 3 and argv[0] == "install":
        return install(Path(argv[1]), argv[2], argv[3] if len(argv) > 3 else "")
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001 - shown to the user as details
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
