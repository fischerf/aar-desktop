// Browser stand-in for the Tauri runtime + a scripted fake ACP agent.
// Injected before the app loads (Playwright addInitScript), so the real
// frontend code runs unchanged in plain Chromium.
(() => {
  const callbacks = new Map();
  const listeners = []; // {id, event, handler}
  let listenerId = 0;
  let cbId = 1;
  let generation = 0;
  const calls = [];
  window.__shim = { calls, sent: [] };

  const emit = (event, payload) => {
    for (const l of listeners) {
      if (l.event === event) callbacks.get(l.handler)?.({ event, id: 0, payload });
    }
  };
  const agentSay = (obj) =>
    setTimeout(() => emit("agent://message", { generation, line: JSON.stringify(obj) }), 0);
  const update = (sessionId, upd) =>
    agentSay({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: upd } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- fake agent ---------------------------------------------------------
  let reqId = 5000;
  let stderr = "INFO starting\n";
  const waiting = new Map();
  let cancelled = false;
  let usedTokens = 9000;
  const configOptions = [
    { id: "model", name: "Model", type: "select", currentValue: "mock",
      options: [{ value: "mock", name: "mock/demo" }, { value: "fast", name: "mock/fast" }] },
    { id: "mode", name: "Mode", type: "select", currentValue: "review",
      options: [{ value: "auto", name: "Auto" }, { value: "review", name: "Review" }, { value: "read-only", name: "Read-only" }] },
  ];

  async function stream(sid, kind, text, ms = 15) {
    for (const w of text.split(" ")) {
      if (cancelled) return;
      update(sid, { sessionUpdate: kind, content: { type: "text", text: w + " " } });
      await sleep(ms);
    }
  }

  function askClient(method, params) {
    const id = ++reqId;
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      agentSay({ jsonrpc: "2.0", id, method, params });
    });
  }

  async function runPrompt(id, sid, text) {
    cancelled = false;
    const low = text.toLowerCase();
    // Scripted demo turns (scripts/showcase): return the final answer text.
    if (window.__shimDemo) {
      const answer = await window.__shimDemo({ text, sid, update, stream, sleep, askClient });
      if (typeof answer === "string") {
        await stream(sid, "agent_message_chunk", answer, window.__shimDemoTyping ?? 25);
        return agentSay({ jsonrpc: "2.0", id, result: { stopReason: cancelled ? "cancelled" : "end_turn" } });
      }
    }
    if (low.includes("offline")) {
      // Like aar when Ollama is unreachable: error only on stderr, turn ends "normally".
      stderr += "WARNING agent.core.loop.loop: Provider error at step 1: Provider returned an error: All connection attempts failed\n";
      return agentSay({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
    }
    await stream(sid, "agent_thought_chunk", "Ich überlege, wie ich helfen kann.");
    let answer;
    if (low.includes("tischen")) {
      // Photo search (bundled photos MCP server): thumbnails card.
      update(sid, { sessionUpdate: "tool_call", toolCallId: "call_photos", title: "photos__photo_search", kind: "search",
        status: "pending", rawInput: { terms: ["table", "desk"] } });
      await sleep(30);
      update(sid, { sessionUpdate: "tool_call_update", toolCallId: "call_photos", status: "completed",
        content: [{ type: "content", content: { type: "text", text:
          "Found 2 photo(s) for table, desk:\n1. C:\\Users\\Demo\\Pictures\\esszimmer.jpg — 2024-05-03 — A wooden dining table with six chairs.\n2. C:\\Users\\Demo\\Pictures\\Urlaub\\meeting.jpg — 2023-01-10 — Three men at a table." } }] });
      answer = "Ich habe 2 Fotos mit Tischen gefunden.";
    } else if (window.__shim.lastPromptImages?.length && low.includes("darauf")) {
      answer = "Ich sehe ein Bild.";
    } else if (low.includes("webseite")) {
      // Catalog MCP server tool (Playwright): plain-language chip.
      update(sid, { sessionUpdate: "tool_call", toolCallId: "call_web", title: "playwright__browser_navigate", kind: "fetch",
        status: "pending", rawInput: { url: "https://example.com" } });
      await sleep(30);
      update(sid, { sessionUpdate: "tool_call_update", toolCallId: "call_web", status: "completed",
        content: [{ type: "content", content: { type: "text", text: "Page title: Example Domain" } }] });
      answer = "Die Seite heißt Example Domain.";
    } else if (low.includes("bildschirm")) {
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      update(sid, { sessionUpdate: "tool_call", toolCallId: "call_shot", title: "screenshot", kind: "read", status: "pending", rawInput: {} });
      await sleep(50);
      update(sid, { sessionUpdate: "tool_call_update", toolCallId: "call_shot", status: "completed",
        content: [
          { type: "content", content: { type: "text", text: "[image: image/png, 1 KB]" } },
          { type: "content", content: { type: "image", mimeType: "image/png", data: png } },
          { type: "content", content: { type: "image", mimeType: "image/svg+xml", data: "PHN2Zz48L3N2Zz4=" } },
        ] });
      answer = "Ich sehe den Desktop.";
    } else if (low.includes("paint")) {
      // Desktop tools address windows by handle and controls by id; the chips
      // must show the window title / control name learnt from earlier results.
      const text = (t) => [{ type: "content", content: { type: "text", text: t } }];
      update(sid, { sessionUpdate: "tool_call", toolCallId: "p1", title: "windows__get_ui_tree", kind: "read",
        status: "pending", rawInput: { window: "262714" } });
      update(sid, { sessionUpdate: "tool_call_update", toolCallId: "p1", status: "completed",
        content: text('262714  mspaint.exe  pid=6240  "Unbenannt - Paint"\nWindow "Unbenannt - Paint"\ne1 MenuBar\n  e22 Button "Bleistift" #PencilTool [off]\ne150 Group "Zeichenbereich" #image') });
      update(sid, { sessionUpdate: "tool_call", toolCallId: "p2", title: "windows__click_element", kind: "execute",
        status: "completed", rawInput: { window: "262714", element: "e22" } });
      update(sid, { sessionUpdate: "tool_call", toolCallId: "p3", title: "windows__drag", kind: "execute",
        status: "completed", rawInput: { window: "262714", element: "e150", points: [[0, 0.5], [1, 0.5]] } });
      answer = "Gemalt.";
    } else if (low.includes("programm")) {
      const tc = { toolCallId: "call_app", title: "launch_app", kind: "execute", status: "pending", rawInput: { name_or_path: "excel" } };
      update(sid, { sessionUpdate: "tool_call", ...tc });
      const resp = await askClient("session/request_permission", {
        sessionId: sid, toolCall: tc,
        options: [
          { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
          { optionId: "reject_once", kind: "reject_once", name: "Deny" },
        ],
      });
      window.__shim.permissionOutcome = resp.result?.outcome;
      update(sid, { sessionUpdate: "tool_call_update", toolCallId: "call_app", status: "completed",
        content: [{ type: "content", content: { type: "text", text: "Excel gestartet" } }] });
      answer = "Excel ist offen.";
    } else if (low.includes("datei") || low.includes("fehler")) {
      const failing = low.includes("fehler");
      const tc = {
        toolCallId: "call_1", title: failing ? "bash" : "write_file", kind: failing ? "execute" : "edit",
        status: "pending",
        rawInput: failing ? { command: "start excel.exe" } : { path: "C:/Users/Demo/Desktop/notiz.txt", content: "Hallo" },
      };
      update(sid, { sessionUpdate: "tool_call", ...tc });
      const resp = await askClient("session/request_permission", {
        sessionId: sid, toolCall: tc,
        options: [
          { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
          { optionId: "allow_always", kind: "allow_always", name: "Allow always" },
          { optionId: "reject_once", kind: "reject_once", name: "Deny" },
          { optionId: "reject_always", kind: "reject_always", name: "Deny always" },
        ],
      });
      window.__shim.permissionOutcome = resp.result?.outcome;
      if (cancelled) return agentSay({ jsonrpc: "2.0", id, result: { stopReason: "cancelled" } });
      const allowed = resp.result?.outcome?.outcome === "selected" && resp.result.outcome.optionId.startsWith("allow");
      await sleep(300);
      const ok = allowed && !failing;
      const msg = ok ? "Datei geschrieben (5 Bytes)." : allowed ? "Fehler: excel.exe nicht gefunden" : "Vom Nutzer abgelehnt";
      update(sid, { sessionUpdate: "tool_call_update", toolCallId: "call_1", status: ok ? "completed" : "failed",
        content: [{ type: "content", content: { type: "text", text: msg } }] });
      answer = ok ? "Erledigt! Die **Notiz** liegt unter `C:\\Users\\Demo\\Desktop\\notiz.txt`." : `Das hat nicht geklappt: ${msg}.`;
    } else {
      answer = "Gern! Ich kann:\n\n- Fragen beantworten\n- Dateien lesen und schreiben\n\nProbier `datei`. <b>kein HTML</b>";
    }
    // Like aar: prompt tokens of the model call vs. the context window.
    usedTokens += 3500;
    update(sid, { sessionUpdate: "usage_update", size: 65536, used: usedTokens, cost: { amount: 0, currency: "usd" } });
    await stream(sid, "agent_message_chunk", answer);
    agentSay({ jsonrpc: "2.0", id, result: { stopReason: cancelled ? "cancelled" : "end_turn" } });
  }

  function agentReceive(line) {
    const msg = JSON.parse(line);
    window.__shim.sent.push(msg);
    const { id, method, params } = msg;
    if (method === undefined) {
      waiting.get(id)?.(msg);
      waiting.delete(id);
      return;
    }
    switch (method) {
      case "initialize":
        return agentSay({ jsonrpc: "2.0", id, result: { protocolVersion: 1, agentCapabilities: {} } });
      case "session/new": {
        const sid = "s-" + Date.now();
        // Like aar: a tool server that cannot start is reported as an agent
        // message *before* the session/new response arrives.
        const broken = (params.mcpServers ?? []).filter((m) => m.name.startsWith("broken"));
        if (broken.length) {
          update(sid, { sessionUpdate: "agent_message_chunk", content: { type: "text",
            text: broken.map((m) => `MCP server '${m.name}' unavailable (could not start: [WinError 2] not found)`).join("; ") } });
        }
        return setTimeout(() => agentSay({ jsonrpc: "2.0", id, result: { sessionId: sid, configOptions } }), 5);
      }
      case "session/load":
        // Like aar for unknown sessions: `{}` instead of null.
        window.__shim.loads = (window.__shim.loads ?? 0) + 1;
        return agentSay({ jsonrpc: "2.0", id, result: {} });
      case "session/prompt":
        window.__shim.lastPromptImages = params.prompt.filter((b) => b.type === "image");
        return void runPrompt(id, params.sessionId, params.prompt.map((b) => b.text).join(" "));
      case "session/cancel":
        cancelled = true;
        return;
      case "session/set_config_option":
        for (const o of configOptions) if (o.id === params.configId) o.currentValue = params.value;
        return agentSay({ jsonrpc: "2.0", id, result: { configOptions } });
      default:
        return agentSay({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
    }
  }

  // ---- Tauri internals ------------------------------------------------------
  const settings = {
    agentCommand: "aar", agentArgs: ["acp"], workingDir: "", hotkey: "Ctrl+Alt+A",
    provider: "", model: "", baseUrl: "", configPath: "", desktopControl: true, autostart: true,
    language: window.__shimLang ?? "de", disabledExtensions: [], mcpServers: [],
    ...(window.__shimSettings ?? {}),
  };
  window.__shim.settings = settings;
  // Add-ons: registry, installed extensions, MCP servers.
  const registry = {
    version: "1.0.0",
    extensions: [
      { name: "permission-gate", pypi: "aar-ext-permission-gate", description: "Confirm before dangerous bash commands", tags: ["safety"], author: "Aar Team", status: "published" },
      { name: "git-checkpoint", pypi: "aar-ext-git-checkpoint", description: "Auto-commit at turn boundaries", tags: ["git"], author: "Aar Team", status: "published" },
      { name: "brand-new", pypi: "aar-ext-brand-new", description: "Something nobody has described yet", tags: ["tool"], author: "X", status: "published" },
      { name: "laya", pypi: "aar-ext-laya", description: "Local CPU decision tools", tags: ["tool"], author: "Aar Team", status: "planned" },
      { name: "companion", pypi: "aar-ext-companion", description: "Living digital AI companion", tags: ["ui"], author: "Aar Team", status: "builtin" },
    ],
  };
  const installedExt = [
    { name: "permission_gate", source: "entrypoint", path: "aar_ext_permission_gate:register", dist: "aar-ext-permission-gate",
      version: "0.1.0", managed: true, hooks: ["session_start", "tool_call"], tools: [], commands: [],
      prompt: "Dangerous shell commands are blocked.", error: null },
  ];
  const mcpInstalled = new Set(window.__shimMcpInstalled ?? []);
  if (window.__shimRegistry) registry.extensions = window.__shimRegistry;
  if (window.__shimInstalled) installedExt.splice(0, installedExt.length, ...window.__shimInstalled);
  window.__shim.uiLangs = [];
  window.__shim.starts = [];
  const aarConfig = {
    path: "C:/Users/Demo/.aar/config.json", found: true, error: null,
    defaultProfile: "qwen3.8", defaultInline: null,
    profiles: [
      { key: "qwen3.8", kind: "ollama", model: "qwen3.8:latest", baseUrl: "http://localhost:11434", contextWindow: 65536 },
      { key: "remote", kind: "ollama", model: "qwen3.5:9b", baseUrl: "http://127.0.0.1:11435", contextWindow: 32768 },
      { key: "gemma", kind: "ollama", model: "gemma4:e4b", baseUrl: "http://localhost:11434", contextWindow: 0 },
    ],
    contextWindow: 0,
  };
  // Models on this PC's Ollama (a pull adds to it).
  const ollamaModels = ["qwen3.8:latest", "qwen3.5:4b"];
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback(cb, once) {
      const id = cbId++;
      callbacks.set(id, (p) => { if (once) callbacks.delete(id); cb(p); });
      return id;
    },
    unregisterCallback(id) { callbacks.delete(id); },
    convertFileSrc: (p) => p,
    async invoke(cmd, args = {}) {
      calls.push([cmd, args]);
      switch (cmd) {
        case "plugin:event|listen":
          listeners.push({ id: ++listenerId, event: args.event, handler: args.handler });
          return listenerId;
        case "plugin:event|unlisten": {
          const i = listeners.findIndex((l) => l.id === args.eventId);
          if (i >= 0) listeners.splice(i, 1);
          return null;
        }
        case "agent_start":
          generation += 1;
          window.__shim.starts.push({ ...settings });
          return generation;
        case "aar_config_info":
          return window.__shimFirstRun
            ? { path: aarConfig.path, found: false, error: "Konfiguration nicht lesbar", defaultProfile: "", defaultInline: null, profiles: [] }
            : aarConfig;
        case "setup_system_info":
          return window.__shim.sys ?? {
            ramMb: 65536, cpuThreads: 32,
            gpus: [
              { name: "AMD Radeon RX 7900 XTX", vendor: "amd", vramMb: 24560 },
              { name: "Intel(R) UHD Graphics", vendor: "intel", vramMb: 128 },
            ],
          };
        case "setup_ollama_status":
          return window.__shim.ollama ?? {
            installed: true, exe: "C:/ollama.exe", running: true, version: "0.34.2",
            models: [...ollamaModels],
          };
        case "setup_ollama_install":
        case "setup_ollama_start":
          for (const done of [0, 5e8, 1e9]) {
            emit("setup://progress", { phase: "download", message: "Lade Ollama herunter …", done, total: 1e9 });
            await sleep(window.__shim.slow ?? 30);
          }
          window.__shim.ollamaInstalled = cmd;
          return { installed: true, exe: "C:/ollama.exe", running: true, version: "0.34.2", models: [] };
        case "setup_ollama_pull":
          for (const done of [0, 3e9, 6.6e9]) {
            emit("setup://progress", { phase: "pull", message: "Lade Modell herunter …", done, total: 6.6e9 });
            await sleep(window.__shim.slow ?? 30);
          }
          window.__shim.pulled = args.model;
          ollamaModels.push(args.model);
          return null;
        case "setup_cancel":
          return null;
        case "check_endpoint":
          return args.url.includes("11435")
            ? { reachable: false, message: "127.0.0.1:11435 ist nicht erreichbar (läuft der Server?)", models: [] }
            : { reachable: true, message: "Ollama auf localhost:11434 erreichbar", models: ["qwen3.8:latest", "qwen3.5:4b"] };
        case "check_provider":
          window.__shim.providerChecks = [...(window.__shim.providerChecks ?? []), args];
          return args.apiKey === "sk-bad"
            ? { reachable: false, message: "Der API-Schlüssel wurde abgelehnt. Bitte prüfe ihn.", models: [] }
            : { reachable: true, message: "Verbunden – der Schlüssel funktioniert (2 Modelle).", models: ["claude-sonnet-4-6", "claude-haiku-4-5"] };
        case "agent_send":
          agentReceive(args.line);
          return null;
        case "agent_stop":
          return null;
        case "agent_stderr":
          return stderr;
        case "agent_mcp_servers": {
          const out = settings.desktopControl
            ? [{ name: "windows", command: "C:/Aar/python/python.exe", args: ["-m", "windows_mcp.server"], env: [] }]
            : [];
          for (const m of settings.mcpServers.filter((m) => m.enabled)) {
            if (m.kind === "http") out.push({ type: "http", name: m.id, url: m.url, headers: m.headers });
            else if (m.kind === "command") out.push({ name: m.id, command: m.command, args: m.args, env: m.env });
            else if (mcpInstalled.has(m.id)) out.push({ name: m.id, command: "C:/Aar/python/python.exe", args: ["-m", "aar_desktop.mcp", "run", m.id, m.script], env: [] });
          }
          return out;
        }
        case "registry_fetch":
          return window.__shim.offline ? { data: null, cached: false, error: "offline" } : { data: registry, cached: false, error: null };
        case "ext_list":
          return { ok: true, data: { ok: true, aarVersion: "0.4.1", supportsDisable: true, extensions: installedExt }, log: "" };
        case "ext_install": {
          for (const line of ["Collecting aar-ext-git-checkpoint", "Building wheel for aar-ext-git-checkpoint", "Successfully installed"]) {
            emit("addons://progress", { line });
            await sleep(window.__shim.slow ?? 30);
          }
          window.__shim.extInstalled = args.dist;
          installedExt.push({ name: "git_checkpoint", source: "entrypoint", path: "aar_ext_git_checkpoint:register",
            dist: args.dist, version: "0.2.0", managed: true, hooks: ["after_turn", "session_start"],
            tools: [{ name: "git_rollback", description: "Roll back to a checkpoint", sideEffects: ["write", "execute"], requiresApproval: true }],
            commands: [], prompt: "You can roll back with git_rollback.", error: null });
          return { ok: true, data: { ok: true, dist: args.dist, version: "0.2.0", entryPoints: ["git_checkpoint"] }, log: "" };
        }
        case "ext_uninstall": {
          const i = installedExt.findIndex((x) => x.dist === args.dist);
          if (i >= 0) installedExt.splice(i, 1);
          window.__shim.extRemoved = args.dist;
          return { ok: true, data: { ok: true, removed: true }, log: "" };
        }
        case "set_disabled_extensions":
          settings.disabledExtensions = args.names;
          return null;
        case "set_mcp_servers":
          settings.mcpServers = args.servers;
          return null;
        case "mcp_installed":
          return [...mcpInstalled];
        case "mcp_install":
          emit("addons://progress", { line: `Collecting ${args.requirement}` });
          await sleep(window.__shim.slow ?? 30);
          mcpInstalled.add(args.id);
          window.__shim.mcpInstalledReq = args.requirement;
          window.__shim.mcpInstallArgs = args;
          return { ok: true, data: null, log: "" };
        case "mcp_browsers":
          return { edge: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", chrome: null };
        case "mcp_remove":
          mcpInstalled.delete(args.id);
          return null;
        case "photos_status": {
          const f = settings.photoFolders ?? [];
          window.__shim.photoStatusCalls = (window.__shim.photoStatusCalls ?? 0) + 1;
          return { ok: true, folders: f.map((p) => ({ path: p, exists: true, photos: 40 })), photos: f.length ? 40 : 0,
            indexed: f.length ? 12 : 0, pending: f.length ? 28 : 0, errors: 0, skipped: f.length ? 5 : 0, running: !!window.__shim.photoIndexing,
            progress: { done: 3, total: 28, current: "C:\\Users\\Demo\\Pictures\\a.jpg" }, model: "qwen3.8:latest", modelProblem: null };
        }
        case "photo_models":
          return { models: ["qwen3.8:latest", "gemma4:latest"], error: null };
        case "set_photo_settings": {
          // Like Rust: removing a folder deletes its index entries right away.
          const removed = (settings.photoFolders ?? []).some((f) => !args.folders.includes(f)) ? 12 : 0;
          settings.photoFolders = args.folders;
          settings.photoModel = args.model;
          return removed;
        }
        case "pick_folder":
          return "C:\\Users\\Demo\\Pictures";
        case "photos_index_start":
          window.__shim.photoIndexing = true;
          return null;
        case "photos_index_stop":
          window.__shim.photoIndexing = false;
          return null;
        case "photo_thumb":
          if (window.__shimThumbs?.[args.path]) return window.__shimThumbs[args.path];
          return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
        case "set_ui_language":
          window.__shim.uiLangs.push(args.lang);
          return null;
        case "agent_working_dir":
          return "C:\\Users\\Demo";
        case "app_version":
          return "0.1.0";
        case "turn_files": {
          if (window.__shimTurnFiles) return window.__shimTurnFiles;
          // Like Rust: only files that exist and changed during the turn.
          window.__shim.turnCandidates = args.candidates;
          const written = window.__shim.permissionOutcome?.optionId === "allow_once";
          const note = args.candidates.find((c) => /notiz\.txt$/i.test(c));
          return written && note ? [{ path: "C:/Users/Demo/Desktop/notiz.txt", name: "notiz.txt", openable: true }] : [];
        }
        case "open_file":
          window.__shim.openedFile = { path: args.path, reveal: args.reveal };
          return null;
        case "diagnostic_paths":
          return { sessions: "C:\\Users\\Demo\\.agent\\sessions", log: "C:\\Users\\Demo\\AppData\\Local\\de.aar.ui\\logs\\aar.log" };
        case "open_path":
          window.__shim.opened = args.what;
          if (args.what === "sessions") throw "Es gibt noch keine gespeicherten Gespräche (C:\\Users\\Demo\\.agent\\sessions).";
          return null;
        case "get_settings":
          return { ...settings };
        case "save_settings": {
          // Like Rust: add-on lists are owned by their own commands.
          const { disabledExtensions, mcpServers, photoFolders, photoModel } = settings;
          Object.assign(settings, args.settings, { disabledExtensions, mcpServers, photoFolders, photoModel });
          return null;
        }
        default:
          return null; // set_expanded, start_dragging, …
      }
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
})();
