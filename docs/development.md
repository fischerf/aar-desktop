# Aar Desktop – Developer Guide

This guide covers the architecture, building, testing and the screenshots for the project website. For what the
app does from a user's point of view, see the [user manual](manual.md).

**Contents**

1. [Architecture](#1-architecture)
2. [The bundled runtime](#2-the-bundled-runtime)
3. [Building](#3-building)
4. [Testing](#4-testing)
5. [Website screenshots and GIF](#5-website-screenshots-and-gif)
6. [Project structure](#6-project-structure)
7. [Things to know](#7-things-to-know)
8. [Roadmap](#8-roadmap)

---

## 1. Architecture

Aar Desktop is a [Tauri 2](https://tauri.app/) app: a small Rust backend and a TypeScript frontend (no framework)
running in WebView2. The actual agent is [aar](https://github.com/fischerf/aar), a Python program that the app
starts as a child process.

```
aar-desktop.exe (Tauri 2)                          aar (bundled runtime, Python 3.13)
 ├─ src/ (TypeScript, WebView2) ── invoke/events ─┐   python -m aar_desktop.boot acp
 └─ src-tauri/ (Rust)          ── stdio JSON-RPC ─┴──► ACP v1 ──► MCP: Windows desktop · photos · custom servers
                                                               └──► Ollama (local) or any aar provider
```

- **The frontend is the ACP client.** `src/acp.ts` speaks the
  [Agent Client Protocol](https://agentclientprotocol.com/) (JSON-RPC over stdio) with aar. The Rust side
  (`agent_process.rs`) only starts the process and pipes the messages through.
- **Tool servers per session.** With every `session/new` or `session/load`, the frontend passes the MCP servers
  for that session in `mcpServers`: the bundled Windows desktop server (UI Automation, can be switched off with
  the setting `desktopControl`), the photo server (only when photo folders are set) and the user's tool servers.
- **Permission cards** answer `session/request_permission` with `allow_once`, `allow_always` or `reject_once`.
- **Images** from the chat are scaled to at most 1280 px JPEG in the WebView and sent as ACP image blocks.
- **The context indicator** takes the context size from the settings or the aar profile (`context_window` or
  `extra.num_ctx`) and the usage from ACP `usage_update` messages.
- **Languages**: German, English and Simplified Chinese. In TypeScript each module defines its texts with
  `strings({de, en, zh})` in `src/i18n.ts`; static HTML uses `data-i18n*` attributes; Rust uses `tr()` / `trf!`
  in `i18n.rs` (tray menu, error messages). New texts always need all three languages and should be written for
  non-technical users.

### System prompt (desktop rules)

aar builds its system prompt from layers (`agent/core/config.py`): built-in base (OS, folder, date, shell),
tool guidelines, the instructions of MCP servers (e.g. the Windows desktop server), `~/.aar/rules.md`, extra
rules, project rules. The CLI's `~/.aar/rules.md` (copied by `aar init`) is a coding-agent template, so the app
switches it off with `AAR_NO_GLOBAL_RULES=1` and passes its own rules in `AAR_EXTRA_RULES` (aar ≥ develop
e8713d3): `src-tauri/rules/desktop.md` – who Aar is for office users, how the permission cards work, the
user's real folders (`SHGetKnownFolderPath`, e.g. a Desktop in OneDrive), the UI language, how to use Edge for
the internet. `rules.rs` fills it in at every agent start and writes it to
`%LOCALAPPDATA%\de.aar.ui\rules\desktop.md`; a user's own `%APPDATA%\de.aar.ui\rules.md` is added after it.

### Language model providers

The user can pick a profile from the aar configuration or a provider type (`ollama`, `anthropic`, `openai`,
`gemini`, `generic`). The app passes `--provider`, `--base-url`, `--model` and `--config` to aar; API keys from
`settings.apiKeys` go only into environment variables (`llm_config::api_key_env`). *Test* calls
`check_provider`, which lists the provider's models. The aar configuration itself is never modified.

### Add-ons

- **Extensions** come from the [aar extension registry](https://github.com/fischerf/aar-extensions-registry).
  They are installed with pip from the GitHub archive into `%LOCALAPPDATA%\de.aar.ui\extensions`
  (`--prefix`), without `aar` as a dependency (the `aar` package on PyPI is a different project).
  Disabled extensions are passed to aar via `AAR_DISABLED_EXTENSIONS`; aar is started as
  `python -m aar_desktop.boot`, which loads the extensions.
- **MCP servers** from the catalog (`MCP_CATALOG` in `src/addons.ts`) are installed one per directory:
  Python servers with `pip --target %LOCALAPPDATA%\de.aar.ui\mcp\<id>` and started with
  `python -m aar_desktop.mcp run <dir> <script>`; Node.js servers (`kind: "node"`) with a portable Node.js from
  `%LOCALAPPDATA%\de.aar.ui\node` and `npm install --prefix`. The placeholders `{edge}`, `{chrome}` and `{state}`
  (data directory `mcp-data\<id>`, deleted on removal) are filled in by Rust at start.
- **Which Python manages add-ons** (`helpers.rs`): always the Python that runs aar – the bundled runtime, or the
  Python behind a custom agent program (`…\Scripts\aar.exe` → `…\python.exe`). For a custom aar, the Python
  helpers are embedded in the exe (`include_str!`), written to `%LOCALAPPDATA%\de.aar.ui\helpers` and put on
  `PYTHONPATH`, together with `<extensions>\Lib\site-packages`.

### Photo search

`src/photos.ts`, `src-tauri/src/photos.rs` and `python/aar_desktop/photos.py` share one index:
`index.sqlite` plus `thumbs\<FNV-1a-64 of the path>.jpg` (the hash function exists in both Rust and Python).
Folders are only those in `settings.photoFolders`; the describing model is `photoModel` or the chat model,
always via Ollama. Images with a side under 64 px are skipped (their `error` starts with `skipped:`); removing a
folder runs `photos prune`, which deletes its entries and thumbnails right away.

---

## 2. The bundled runtime

The installer contains an embeddable CPython 3.13 in `<install folder>\python\` (a Tauri resource) with the aar
wheel, the Windows wheels, pip, hatchling, Pillow, the SDKs for the cloud providers (`anthropic`, `openai`,
`google-genai`), `tools/windows_mcp` and the helpers from `python/aar_desktop/` (installed as `aar-tools/`).

If the *Agent program* setting is empty, the app uses this runtime; without it, it falls back to `aar` from the
`PATH`.

Embeddable Python ignores `PYTHONPATH` (it runs in `._pth` mode), so paths are written into `python313._pth`, and
pip cannot use build isolation there – the runtime installs with `--no-build-isolation` and the bundled
hatchling. Build isolation is only switched off for the embedded runtime; a regular Python has no hatchling.

---

## 3. Building

Building and testing happen **inside the WSL VM `Ubuntu-aarui`**. The app is cross-compiled to
`x86_64-pc-windows-msvc` with cargo-xwin, and the installer is built with NSIS. The repository on the Windows
drive is the source; the scripts sync it to `~/build/aar_ui` inside the VM.

Built programs are never run on the Windows host. Everything that has to run on Windows is tested in the
Windows Sandbox (see [Testing](#4-testing)).

```powershell
$env:WSL_UTF8 = 1      # otherwise wsl output is UTF-16

# once: install the toolchain in the VM
wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/setup-dev.sh

# build -> dist\aar-desktop.exe and dist\Aar_<version>_x64-setup.exe
wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/build.sh
#   --python  rebuild the bundled runtime (aar wheel from ../aar; needed after changes to aar or python/)
#   --debug   debug build with a console window
#   --icons   regenerate the icons from assets/app-icon.svg
```

**Shortcut:** double-click **`build.bat`** (or run it from a console). It rebuilds the aar runtime, the app and
the installer; `build.bat --fast` skips the runtime, and other options such as `--debug` are passed on to
`build.sh`. It refuses to run while Aar Desktop or an Aar installer from `dist\` is running, because Windows
locks those files and they would not be overwritten.

---

## 4. Testing

```powershell
# Rust unit tests
wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/test-rust.sh

# UI test: the real frontend in headless Chromium with a Tauri mock and a fake ACP agent (tests/e2e);
# screenshots go to dist\screenshots
wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/e2e.sh

# Installer test in a fresh Windows Sandbox (~10 min): runtime, ACP, all registry extensions, MCP servers
# (pip + npm, Edge), photo index via the host's Ollama, app start, and a "custom aar" (regular Python + aar wheel).
# -Full adds Ollama, a model download and an end-to-end LLM test.
powershell -ExecutionPolicy Bypass -File scripts\sandbox\run.ps1 [-Full] [-KeepOpen]

# Drive the real widget in the Sandbox with UI Automation (LLM = the host's Ollama)
powershell -ExecutionPolicy Bypass -File scripts\sandbox\desktop.ps1 -Mode widget -SkipPaint

# Click the four start suggestions of the empty chat and check the outcome on the machine;
# -Cpu runs the model on the processor only (num_gpu 0), without it Ollama uses the GPU
powershell -ExecutionPolicy Bypass -File scripts\sandbox\desktop.ps1 -Mode widget -Tasks sug-news,sug-paint,sug-downloads,sug-letter -Model qwen3.5:4b [-Cpu]
```

The host's Ollama detects GPUs only when it starts. If it started without one, it silently runs everything on the
processor. The Sandbox log therefore ends with `LLM loaded: <model> size=… on GPU=… GB`; check it after GPU runs.

### Start suggestions with the recommended models

Result of the last run (2026-11-24, Aar 0.1.1, aar `develop` e2ae7a1, host Ollama on an AMD Radeon RX 7900 XTX or
on the processor only). Each suggestion is clicked in the real widget and every permission card is allowed. The
outcome is checked on the machine:

- **News:** Edge was used and the answer has more than 300 characters.
- **Paint:** more than 5 % of the canvas is painted (pixel check on a screenshot).
- **Downloads:** all seven sample files are untouched and at least three are named in the answer.
- **Invitation:** a new file on the Desktop and a file card in the chat.

| Suggestion | gemma4 E4B GPU | gemma4 E4B CPU | qwen3.5 4B GPU | qwen3.5 4B CPU | qwen3.8 27B GPU |
|---|---|---|---|---|---|
| 📰 Today's news | ✅ 1 min | ✅ 4 min | ✅ 1 min | ✅ 9 min | ✅ 2 min |
| 🎨 Paint a picture | ❌ 0 % | ❌ 1 % | ✅ 28 % | ❌ 0 % | ✅ 100 %, 8 min |
| 📁 Look at my downloads | ✅ 12 s | ✅ 1.5 min | ✅ 17 s | ✅ 2 min | ✅ 11 s |
| ✉️ Write an invitation | ✅ 8 s | ✅ 1 min | ✅ 5 s | ✅ 1 min | ✅ 17 s |

- **Large model:** qwen3.8 solves all four. On the processor it is far too slow (about 30 minutes for the news task),
  so it is tested on the GPU only.
- **Small models and Paint:** Paint is luck for the small models. In the previous run gemma4 passed on the processor
  and qwen3.5 failed on the GPU. They select tools, then drag outside the canvas or stop. gemma4 sometimes claims
  success anyway. The other three suggestions work with every model; on the processor they take about 4 to 30
  times longer, depending on the task.
- **Fixes found by these runs:**
  - The Windows MCP server matches window titles without invisible characters, because Edge puts a U+200B in its
    title.
  - aar continues when a model stops in the middle of its reasoning.
  - `click_at` and `drag` without an element say that positions refer to the whole window.
  - The desktop rules ask for full paths: the phrase "my desktop" in an earlier version was used literally as a
    folder name.

Results, screenshots and session files are under `E:\Windows_Sandbox\desktop\results\<model>-gpu|cpu`.

Only one Windows Sandbox can run at a time; the scripts share a mutex. Starting a Sandbox also interrupts running
WSL sessions, so never run WSL jobs and the Sandbox in parallel.

Sandbox data lives outside the repository under `E:\Windows_Sandbox\` (`installer-test\in|out`, `ollama-models`
as a model cache, `photos` with test photos for the photo index, `pytest\<name>`).

**Testing without a language model:** use `scripts/mock_acp_agent.py` as the agent program (`python` with the
script path as argument). `scripts/probe_acp.py` prints the raw ACP messages of an agent.

---

## 5. Website screenshots and GIF

The [project page](https://fischerf.github.io/aar-desktop/) (source in the `fischerf.github.io` repository,
folder `aar-desktop`) exists in English (`index.html`), German (`de/index.html`) and Simplified Chinese
(`zh/index.html`) with a shared `site.css` and `site.js`. On the first visit the English page redirects to `de/`
or `zh/` based on the browser language; a choice in the language switcher is remembered in
`localStorage` (`aar-desktop-lang`). Always change texts on all three pages.

After UI changes, re-capture the images – one set per language. The stage `scripts/showcase/stage.html` shows a
light Windows 11 desktop (taskbar, Paint, Explorer and PDF windows, texts translated via `stage.texts()`) with the
**real frontend** in an iframe. The answers come from a scripted demo agent (`window.__shimDemo`; prompts,
answers and file names per language in `TEXT` in `scripts/showcase/capture.mjs`) running on the Tauri mock from
`tests/e2e`.

```powershell
# all scenes + GIF in en, de, zh -> dist\showcase\<lang>\*.png (1600x1200) + aar-desktop.gif (800x600),
# copied as WebP + GIF to the website (fischerf.github.io\aar-desktop\img\<lang>)
# and, for English, the GIF + four screenshots to docs\img for the README
wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/showcase.sh

# only some scenes (comma-separated, "all" = all) and/or languages:
#   paint, photo-search, vision, permission, extensions, tools, photos-settings, setup, gif
wsl -d Ubuntu-aarui -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/showcase.sh tools,gif de
```

1. **Prerequisite:** `e2e.sh` has run once (it installs Playwright). On its first run `showcase.sh` also
   downloads the font *Selawik* (a metric-compatible substitute for Segoe UI) and the CC0 sample photos
   (`fetch_photos.py` → `dist\showcase-src\photos`, credits in `credits.json`). All three languages take about
   four minutes.
2. **Check the result:** look at `dist\showcase\<lang>\*.png`, then open the page locally, e.g. in the VM
   `cd /mnt/b/Github_my/fischerf.github.io && python3 -m http.server 8765` →
   `http://localhost:8765/aar-desktop/` (and `/de/`, `/zh/`).
3. **New UI elements in a scene:** add demo answers, prompts and file names in `capture.mjs` (`TEXT`,
   `demoScript`, `scenes()`) and desktop windows in `stage.html`. Register new scenes in `publish.py` (`SCENES`)
   and include them on all three pages (section *tour*).
4. **Publish:** commit and push in the `fischerf.github.io` repository, and commit the README images in
   `docs/img` here.

`SHOWCASE_SITE=""` skips copying to the website and `SHOWCASE_README=""` skips `docs/img`.

---

## 6. Project structure

| Path | Contents |
|------|----------|
| `src/main.ts` | UI controller: chat, permission cards, attachments, settings, window, preflight checks |
| `src/acp.ts` | ACP client (JSON-RPC, sessions, prompts with images, permission requests) |
| `src/addons.ts` | Extensions (registry, warnings) and tool servers (catalog, dialogs) |
| `src/photos.ts` | Photo search: settings tab, result card with thumbnails |
| `src/setup.ts` | Setup assistant and model catalog |
| `src/permissions.ts` | Permission grants (this conversation / always), risky tools, the list in the settings |
| `src/history.ts`, `src-tauri/src/sessions.rs` | Conversation list: read saved aar sessions, continue, delete |
| `src/tools.ts`, `src/markdown.ts` | Tool calls in plain language, safe Markdown renderer (escapes first) |
| `src/mascot.ts`, `src/styles.css` | Mascot SVG and its moods, Fluent styling in light and dark |
| `src/i18n.ts` | Languages de/en/zh |
| `src-tauri/src/lib.rs` | Window, tray, hotkey, Tauri commands, command-line modes |
| `src-tauri/src/agent_process.rs` | Starting aar, `PATH` resolution, MCP servers for the session |
| `src-tauri/src/helpers.rs` | Choosing the Python for add-ons, embedded helpers |
| `src-tauri/src/addons.rs`, `photos.rs` | Registry, install/uninstall, MCP servers, photo index, folder picker |
| `src-tauri/src/settings.rs`, `llm_config.rs`, `setup.rs` | Settings, aar profiles, hardware detection and Ollama |
| `src-tauri/src/autostart.rs`, `files.rs`, `agent_log.rs` | Autostart (HKCU), opening new files, the log file |
| `src-tauri/src/i18n.rs` | `tr()` / `trf!` for texts from Rust |
| `python/aar_desktop/` | Helpers: `boot` (aar + extensions), `ext`, `mcp`, `node`, `photos` |
| `scripts/wsl/` | Setup, build, runtime bundle, tests and showcase in the WSL VM |
| `scripts/showcase/` | Stage, capture, GIF, sample photos and publishing for the website |
| `scripts/sandbox/`, `tests/sandbox/` | Tests in the Windows Sandbox |
| `tests/e2e/` | Playwright UI test with Tauri mock and fake ACP agent |

---

## 7. Things to know

- **The program must not be called `aar.exe`.** Windows looks for programs in the caller's own folder first,
  so `aar` would start the widget itself. Hence `aar-desktop.exe` and a custom `PATH`/`PATHEXT` resolution.
- **Never insert agent output as HTML.** The WebView can call into Rust; use `textContent` or
  `renderMarkdown`, which escapes first.
- **Autostart** uses a value `Aar` under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (`autostart.rs`).
  Plugins such as `tauri-plugin-autostart` write to HKLM when run as administrator, so they are not used.
  The uninstaller removes the value (`src-tauri/windows/hooks.nsh`).
- **`dragDropEnabled: false`** in `tauri.conf.json` – otherwise Tauri captures file drops and the WebView never
  sees them. The CSP only allows `data:` images, so images are converted with FileReader/Canvas.
- **MCP stdio servers** only receive a few environment variables from the MCP SDK; always pass the server
  environment explicitly.
- **Downloads from the embedded Python** find no root certificates on a fresh Windows; the helpers use
  `truststore` (or certifi), and npm runs with `NODE_USE_SYSTEM_CA=1`.
- **Silent provider errors:** aar reports provider errors only on stderr and ends the turn with `end_turn` and no
  content; the widget detects this (`reportSilentTurn`). MCP servers that fail to start are reported as an agent
  message *before* the `session/new` response, so the widget buffers updates for unknown sessions.
- **Rust tests must not call `i18n::set_lang`** – the language is process-wide and tests run in parallel.
- **The installer shows a license page** (`bundle.licenseFile` → `src-tauri/windows/license.txt`): the early
  preview warning and disclaimer in English, German and Chinese, followed by the full Apache License text. If
  `LICENSE` or the disclaimer changes, update this file too.
- **Settings files written by PowerShell 5.1** start with a UTF-8 BOM; `Settings::parse` strips it.

---

## 8. Roadmap

1. Installer signing and a public release
2. Voice input and hints about the active window
3. Photo search: optional local face recognition (opt-in only, once the model license is clarified)
