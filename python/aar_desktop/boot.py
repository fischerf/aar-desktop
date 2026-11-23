"""Start aar like ``python -m agent.transports.cli …``, with the extensions
installed by Aar Desktop on ``sys.path``."""

from __future__ import annotations

import runpy

from aar_desktop._site import add_ext_site


def main() -> None:
    add_ext_site()
    runpy.run_module("agent.transports.cli", run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    main()
