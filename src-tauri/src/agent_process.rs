//! Child process running `aar acp`.
//!
//! The Rust side is a dumb pipe: every stdout line (one JSON-RPC message) is
//! forwarded to the webview as an `agent://message` event and every
//! `agent_send` call writes one line to stdin. All protocol logic lives in the
//! frontend (`src/acp.ts`).

use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

use crate::agent_log::{log_path, AgentLog};
use crate::settings::{valid_server_id, Settings, UserMcpServer};

const STDERR_TAIL: usize = 200;

#[derive(Default)]
pub struct AgentProcess {
    child: Mutex<Option<Arc<Mutex<Child>>>>,
    stdin: Mutex<Option<ChildStdin>>,
    generation: AtomicU64,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
    log: Arc<AgentLog>,
}

#[derive(Clone, Serialize)]
struct MessagePayload {
    generation: u64,
    line: String,
}

#[derive(Clone, Serialize)]
struct ExitPayload {
    generation: u64,
    code: Option<i32>,
    stderr: String,
}

/// Python runtime shipped with the installer (`<install dir>/python/python.exe`).
pub fn bundled_python(resource_dir: &Path) -> Option<PathBuf> {
    let exe = resource_dir.join("python").join(if cfg!(windows) { "python.exe" } else { "bin/python3" });
    exe.is_file().then_some(exe)
}

/// An MCP server the widget hands to aar in ACP `session/new` (stdio transport).
#[derive(Debug, Clone, Serialize)]
pub struct McpServer {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<EnvVar>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnvVar {
    pub name: String,
    pub value: String,
}

/// ACP `HttpMcpServer` (`type: "http"`).
#[derive(Debug, Clone, Serialize)]
pub struct HttpMcpServer {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub name: String,
    pub url: String,
    pub headers: Vec<EnvVar>,
}

/// One entry of ACP `mcpServers`.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum AcpMcpServer {
    Stdio(McpServer),
    Http(HttpMcpServer),
}

/// Aar Desktop's Python helpers next to the bundled runtime
/// (`python/aar-tools/aar_desktop`, see `python/aar_desktop` in the repo).
pub fn bundled_helpers(resource_dir: &Path) -> bool {
    resource_dir.join("python").join("aar-tools").join("aar_desktop").join("boot.py").is_file()
}

fn python_env() -> Vec<EnvVar> {
    vec![
        EnvVar { name: "PYTHONNOUSERSITE".into(), value: "1".into() },
        EnvVar { name: "PYTHONIOENCODING".into(), value: "utf-8".into() },
        EnvVar { name: "PYTHONUTF8".into(), value: "1".into() },
    ]
}

/// Where installed MCP servers, their data and the portable Node.js live.
pub struct McpDirs {
    pub root: PathBuf,
    pub state: PathBuf,
    pub node: PathBuf,
    pub browsers: crate::addons::Browsers,
}

impl McpDirs {
    /// `{edge}`, `{chrome}`, `{state}` in an argument or env value. Unknown
    /// browsers stay as they are (the server then reports a clear error).
    fn expand(&self, id: &str, value: &str) -> String {
        let mut v = value.to_string();
        if v.contains("{state}") {
            let dir = self.state.join(id);
            let _ = std::fs::create_dir_all(&dir);
            v = v.replace("{state}", &dir.to_string_lossy());
        }
        for (key, path) in [("{edge}", &self.browsers.edge), ("{chrome}", &self.browsers.chrome)] {
            if let Some(p) = path {
                v = v.replace(key, p);
            }
        }
        v
    }

    fn node_exe(&self) -> PathBuf {
        self.node.join(if cfg!(windows) { "node.exe" } else { "bin/node" })
    }
}

/// Entry file of an npm-installed server (`launch.json` written by `aar_desktop.node`).
fn node_launch(dir: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(dir.join("launch.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let bin = dir.join(v.get("bin")?.as_str()?);
    bin.is_file().then_some(bin)
}

/// MCP servers the user added in the settings. Package servers that are not
/// installed (yet) are left out; aar reports servers that fail to start.
pub fn user_mcp_servers(py_rt: Option<&crate::helpers::PyRuntime>, dirs: &McpDirs, servers: &[UserMcpServer]) -> Vec<AcpMcpServer> {
    let mcp_root = &dirs.root;
    let mut out = vec![];
    for s in servers.iter().filter(|s| s.enabled && valid_server_id(&s.id)) {
        let user_env: Vec<EnvVar> = s
            .env
            .iter()
            .filter(|e| !e.name.trim().is_empty())
            .map(|e| EnvVar { name: e.name.trim().into(), value: dirs.expand(&s.id, &e.value) })
            .collect();
        let user_args: Vec<String> = s.args.iter().map(|a| dirs.expand(&s.id, a)).collect();
        match s.kind.as_str() {
            "node" => {
                let Some(bin) = node_launch(&mcp_root.join(&s.id)) else { continue };
                let node = dirs.node_exe();
                if !node.is_file() {
                    continue;
                }
                out.push(AcpMcpServer::Stdio(McpServer {
                    name: s.id.clone(),
                    command: node.to_string_lossy().into_owned(),
                    args: std::iter::once(bin.to_string_lossy().into_owned()).chain(user_args).collect(),
                    env: user_env,
                }));
            }
            "package" => {
                let Some(rt) = py_rt else { continue };
                let dir = mcp_root.join(&s.id);
                if !dir.is_dir() || s.script.trim().is_empty() {
                    continue;
                }
                let mut args: Vec<String> = vec!["-m".into(), "aar_desktop.mcp".into(), "run".into()];
                args.push(dir.to_string_lossy().into_owned());
                args.push(s.script.trim().into());
                args.extend(user_args.iter().cloned());
                out.push(AcpMcpServer::Stdio(McpServer {
                    name: s.id.clone(),
                    command: rt.python.to_string_lossy().into_owned(),
                    args,
                    env: rt.env().into_iter().map(|(name, value)| EnvVar { name, value }).chain(user_env).collect(),
                }));
            }
            "command" => {
                let cmd = s.command.trim();
                if cmd.is_empty() {
                    continue;
                }
                // `npx` is `npx.cmd` on Windows: hand aar the full path.
                let program = resolve_program(cmd)
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| cmd.into());
                out.push(AcpMcpServer::Stdio(McpServer {
                    name: s.id.clone(),
                    command: program,
                    args: user_args,
                    env: user_env,
                }));
            }
            "http" => {
                let url = s.url.trim();
                if !(url.starts_with("http://") || url.starts_with("https://")) {
                    continue;
                }
                out.push(AcpMcpServer::Http(HttpMcpServer {
                    kind: "http",
                    name: s.id.clone(),
                    url: url.into(),
                    headers: s
                        .headers
                        .iter()
                        .filter(|h| !h.name.trim().is_empty())
                        .map(|h| EnvVar { name: h.name.trim().into(), value: h.value.clone() })
                        .collect(),
                }));
            }
            _ => {}
        }
    }
    out
}

/// MCP servers shipped with the bundled runtime (currently: Windows desktop
/// automation in `python/aar-tools/windows_mcp`).
pub fn bundled_mcp_servers(resource_dir: &Path) -> Vec<McpServer> {
    let Some(py) = bundled_python(resource_dir) else { return vec![] };
    let server = resource_dir.join("python").join("aar-tools").join("windows_mcp").join("server.py");
    if !cfg!(windows) || !server.is_file() {
        return vec![];
    }
    vec![McpServer {
        name: "windows".into(),
        command: py.to_string_lossy().into_owned(),
        args: vec!["-m".into(), "windows_mcp.server".into()],
        env: python_env(),
    }]
}

/// Decide how to launch aar. Empty/`auto` command = bundled runtime if present,
/// else `aar` from PATH. Returns the program and arguments that precede the
/// user's `agent_args` (e.g. `-m agent.transports.cli` for the bundled Python).
pub fn resolve_agent(app: &AppHandle, command: &str) -> Result<(PathBuf, Vec<String>), String> {
    let command = command.trim();
    if command.is_empty() || command.eq_ignore_ascii_case("auto") {
        let bundled = app.path().resource_dir().ok().and_then(|d| bundled_python(&d));
        if let Some(py) = bundled {
            // boot = aar's CLI plus the extensions installed via the settings.
            let module = match app.path().resource_dir() {
                Ok(d) if bundled_helpers(&d) => "aar_desktop.boot",
                _ => "agent.transports.cli",
            };
            return Ok((py, vec!["-m".into(), module.into()]));
        }
        return resolve_program("aar").map(|p| (p, vec![]));
    }
    resolve_program(command).map(|p| (p, vec![]))
}

/// Find the agent executable ourselves instead of leaving it to `CreateProcess`.
///
/// Windows searches the *calling program's directory* before `PATH`, so a bare
/// `aar` could resolve to this widget's own exe (that is exactly what happened
/// when the widget was named `Aar.exe`). We search `PATH` with `PATHEXT` and
/// skip our own executable.
pub fn resolve_program(command: &str) -> Result<PathBuf, String> {
    let command = command.trim();
    let path = Path::new(command);
    if path.is_absolute() || path.components().count() > 1 {
        return if path.is_file() {
            Ok(path.to_path_buf())
        } else {
            Err(trf!(
                "Agent-Programm '{command}' existiert nicht",
                "Agent program '{command}' does not exist",
                "代理程序“{command}”不存在"
            ))
        };
    }
    let own_exe = std::env::current_exe().ok().and_then(|p| p.canonicalize().ok());
    let extensions: Vec<String> = if cfg!(windows) && path.extension().is_none() {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|e| !e.is_empty())
            .map(|e| e.to_ascii_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };
    let search = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&search) {
        for ext in &extensions {
            let candidate = dir.join(format!("{command}{ext}"));
            if !candidate.is_file() {
                continue;
            }
            let is_self = match (&own_exe, candidate.canonicalize()) {
                (Some(own), Ok(c)) => own == &c,
                _ => false,
            };
            if !is_self {
                return Ok(candidate);
            }
        }
    }
    Err(trf!(
        "'{command}' wurde nicht gefunden. Ist aar installiert (pip install \"aar-agent[acp]\") und im PATH?",
        "'{command}' was not found. Is aar installed (pip install \"aar-agent[acp]\") and on the PATH?",
        "找不到“{command}”。aar 是否已安装（pip install \"aar-agent[acp]\"）并在 PATH 中？"
    ))
}

impl AgentProcess {
    /// Start (or restart) the agent. Returns the new generation id.
    pub fn start(&self, app: &AppHandle, settings: &Settings) -> Result<u64, String> {
        self.stop();
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let cwd = settings.resolved_working_dir(app);

        let (program, prefix) = resolve_agent(app, &settings.agent_command)?;
        let mut cmd = Command::new(&program);
        cmd.args(&prefix)
            .args(settings.effective_args())
            // Bundled runtime: never pick up packages from the user's own Python.
            .env("PYTHONNOUSERSITE", "1")
            .current_dir(&cwd)
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .env("AAR_LAUNCHED_BY", "aar-ui")
            // Extensions switched off in the settings (aar >= disabled_extensions).
            .env("AAR_DISABLED_EXTENSIONS", settings.disabled_extensions.join(","))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Cloud provider chosen in the settings: its API key (aar reads it from the environment).
        let profiles: Vec<String> = crate::llm_config::read_aar_config(&settings.aar_config_file(app))
            .profiles
            .into_iter()
            .map(|p| p.key)
            .collect();
        if let Some((var, key)) = settings.api_key_env(&profiles) {
            cmd.env(var, key);
        }

        if let Some(dir) = crate::addons::ext_dir(app) {
            // Bundled runtime: aar_desktop.boot adds it. Own Python: via PYTHONPATH.
            if prefix.first().map(String::as_str) != Some("-m") {
                let site = dir.join("Lib").join("site-packages");
                let rest = std::env::var_os("PYTHONPATH");
                let mut parts = vec![site];
                if let Some(r) = rest {
                    parts.extend(std::env::split_paths(&r));
                }
                if let Ok(p) = std::env::join_paths(parts) {
                    cmd.env("PYTHONPATH", p);
                }
            }
            cmd.env(crate::addons::EXT_DIR_ENV, dir);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        if let Some(path) = log_path(app) {
            self.log.open(&path);
        }
        self.log.line(&format!(
            "=== Aar Desktop {}: Agent starten: {} {} (Ordner {})",
            app.package_info().version,
            program.display(),
            prefix.iter().chain(settings.effective_args().iter()).cloned().collect::<Vec<_>>().join(" "),
            cwd.display()
        ));
        let mut child = cmd.spawn().map_err(|e| {
            let msg = trf!(
                "Konnte '{}' nicht starten: {e}",
                "Could not start '{}': {e}",
                "无法启动“{}”：{e}",
                program.display()
            );
            self.log.line(&msg);
            msg
        })?;

        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let child = Arc::new(Mutex::new(child));

        *self.stdin.lock().unwrap() = Some(stdin);
        *self.child.lock().unwrap() = Some(child.clone());
        self.stderr_tail.lock().unwrap().clear();

        // stderr -> ring buffer (shown to the user when the agent dies).
        let tail = self.stderr_tail.clone();
        let log = self.log.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log.line(&line);
                let mut t = tail.lock().unwrap();
                if t.len() >= STDERR_TAIL {
                    t.pop_front();
                }
                t.push_back(line);
            }
        });

        // stdout -> webview, then report the exit.
        let app = app.clone();
        let tail = self.stderr_tail.clone();
        let log = self.log.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.split(b'\n').map_while(Result::ok) {
                let line = String::from_utf8_lossy(&line).trim().to_string();
                if line.is_empty() {
                    continue;
                }
                let _ = app.emit("agent://message", MessagePayload { generation, line });
            }
            // Poll instead of a blocking wait() so stop() can still take the lock and kill.
            let code = loop {
                match child.lock().unwrap().try_wait() {
                    Ok(Some(status)) => break status.code(),
                    Ok(None) => {}
                    Err(_) => break None,
                }
                thread::sleep(std::time::Duration::from_millis(100));
            };
            let stderr = {
                let t = tail.lock().unwrap();
                t.iter().rev().take(20).rev().cloned().collect::<Vec<_>>().join("\n")
            };
            log.line(&format!("=== Agent beendet (Code {})", code.map_or("?".into(), |c| c.to_string())));
            let _ = app.emit("agent://exit", ExitPayload { generation, code, stderr });
        });

        Ok(generation)
    }

    pub fn send(&self, line: &str) -> Result<(), String> {
        let mut guard = self.stdin.lock().unwrap();
        let stdin = guard
            .as_mut()
            .ok_or_else(|| crate::i18n::tr("Agent läuft nicht", "The agent is not running", "代理未运行").to_string())?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|e| trf!("Senden fehlgeschlagen: {e}", "Sending failed: {e}", "发送失败：{e}"))
    }

    pub fn stop(&self) {
        // Closing stdin lets aar shut down cleanly; kill as a fallback.
        self.stdin.lock().unwrap().take();
        if let Some(child) = self.child.lock().unwrap().take() {
            if let Ok(mut c) = child.lock() {
                let _ = c.kill();
            }
        }
    }

    pub fn stderr_tail(&self) -> String {
        self.stderr_tail.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_servers_start_their_bin_with_placeholders() {
        let base = std::env::temp_dir().join(format!("aar-ui-node-{}", std::process::id()));
        let dirs = McpDirs {
            root: base.join("mcp"),
            state: base.join("mcp-data"),
            node: base.join("node"),
            browsers: crate::addons::Browsers { edge: Some("C:/Edge/msedge.exe".into()), chrome: None },
        };
        let server_dir = dirs.root.join("browser");
        std::fs::create_dir_all(server_dir.join("pkg")).unwrap();
        std::fs::write(server_dir.join("pkg").join("cli.js"), "x").unwrap();
        std::fs::write(server_dir.join("launch.json"), r#"{"bin": "pkg/cli.js"}"#).unwrap();
        let node = dirs.node_exe();
        std::fs::create_dir_all(node.parent().unwrap()).unwrap();
        std::fs::write(&node, "x").unwrap();

        let server = |id: &str| UserMcpServer {
            id: id.into(),
            kind: "node".into(),
            enabled: true,
            args: vec!["--executablePath".into(), "{edge}".into(), "--chrome={chrome}".into()],
            env: vec![crate::settings::KeyValue { name: "MEMORY_FILE_PATH".into(), value: "{state}/m.jsonl".into() }],
            ..Default::default()
        };
        // "missing" is not installed (no launch.json) -> left out.
        let out = user_mcp_servers(None, &dirs, &[server("browser"), server("missing")]);
        assert_eq!(out.len(), 1);
        let AcpMcpServer::Stdio(s) = &out[0] else { panic!("stdio expected") };
        assert_eq!(s.command, node.to_string_lossy());
        assert!(s.args[0].ends_with("cli.js"));
        assert_eq!(s.args[1..], ["--executablePath", "C:/Edge/msedge.exe", "--chrome={chrome}"]);
        assert!(s.env[0].value.starts_with(&dirs.state.join("browser").to_string_lossy().into_owned()));
        assert!(dirs.state.join("browser").is_dir(), "{{state}} dir is created");
        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn resolves_programs() {
        let dir = std::env::temp_dir().join(format!("aar-ui-resolve-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let name = if cfg!(windows) { "fakeagent.exe" } else { "fakeagent" };
        let file = dir.join(name);
        std::fs::write(&file, b"x").unwrap();

        // Absolute path: used as-is when it exists.
        assert_eq!(resolve_program(file.to_str().unwrap()).unwrap(), file);
        assert!(resolve_program(dir.join("missing").to_str().unwrap()).is_err());

        // Bare name: found via PATH.
        let old = std::env::var_os("PATH");
        std::env::set_var("PATH", &dir);
        let found = resolve_program("fakeagent");
        let missing = resolve_program("definitely-not-here");
        if let Some(p) = old {
            std::env::set_var("PATH", p);
        }
        assert_eq!(found.unwrap(), file);
        assert!(missing.unwrap_err().contains("nicht gefunden"));
        std::fs::remove_dir_all(dir).ok();
    }
}
