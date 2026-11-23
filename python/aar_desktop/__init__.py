"""Helpers that Aar Desktop runs with the bundled Python runtime.

* ``python -m aar_desktop.boot acp …``  – start aar with the user's extensions
* ``python -m aar_desktop.ext list|install|uninstall``  – manage aar extensions
* ``python -m aar_desktop.mcp install|run``  – install / start MCP servers

Installed add-ons live outside the program folder (it is replaced on every
update), in directories passed by the app through environment variables:

* ``AAR_DESKTOP_EXT_DIR``  pip ``--prefix`` for extensions (shares aar's packages)
* ``AAR_DESKTOP_MCP_DIR``  one self-contained ``pip --target`` dir per MCP server
"""
