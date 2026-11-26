//! Add-ons managed under Settings: aar extensions from the extension registry
//! and MCP tool servers. The heavy lifting (pip, inspecting extensions) is done
//! by `python -m aar_desktop.{ext,mcp}` with the bundled runtime.
//!
//! Installed add-ons live in `%LOCALAPPDATA%\de.aar.ui\` (the program folder is
//! replaced on every update):
//!   `extensions\`   pip `--prefix` for extensions (shares aar's packages)
//!   `mcp\<id>\`     one self-contained `pip --target` dir per MCP server

use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::i18n::tr;
use crate::settings::valid_server_id;

pub const EXT_DIR_ENV: &str = "AAR_DESKTOP_EXT_DIR";
pub const MCP_DIR_ENV: &str = "AAR_DESKTOP_MCP_DIR";
pub const NODE_DIR_ENV: &str = "AAR_DESKTOP_NODE_DIR";

/// The extension registry (source of truth for installable extensions).
pub const REGISTRY_INDEX: &str = "https://raw.githubusercontent.com/fischerf/aar-extensions-registry/main/extensions.json";
/// Source archive: the packages are not on PyPI, pip builds them from here
/// (no git needed on the user's PC).
pub const REGISTRY_ARCHIVE: &str = "https://github.com/fischerf/aar-extensions-registry/archive/refs/heads/main.zip";

pub fn ext_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("extensions"))
}

pub fn mcp_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("mcp"))
}

/// Data of MCP servers that must survive a reinstall (`{state}` placeholder).
pub fn mcp_state_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("mcp-data"))
}

/// Portable Node.js for npm-based MCP servers (downloaded on first use).
pub fn node_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("node"))
}

/// npm package spec: `name`, `@scope/name`, optional `@version`/tag – no URLs,
/// git, paths or npm options.
pub fn valid_npm_spec(spec: &str) -> bool {
    let s = spec.trim();
    !s.is_empty()
        && s.len() <= 100
        && !s.starts_with('-')
        && !s.contains("..")
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"-_.@/^~".contains(&b))
        && s.matches('/').count() <= 1
        && (s.starts_with('@') || !s.contains('/'))
}

/// Installed browsers that MCP servers can drive (`{edge}` / `{chrome}`).
#[derive(Serialize, Default)]
pub struct Browsers {
    pub edge: Option<String>,
    pub chrome: Option<String>,
}

#[cfg(windows)]
pub fn browsers() -> Browsers {
    let find = |rel: &str| -> Option<String> {
        ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
            .iter()
            .filter_map(|v| std::env::var_os(v))
            .map(|base| PathBuf::from(base).join(rel))
            .find(|p| p.is_file())
            .map(|p| p.to_string_lossy().into_owned())
    };
    Browsers {
        edge: find(r"Microsoft\Edge\Application\msedge.exe"),
        chrome: find(r"Google\Chrome\Application\chrome.exe"),
    }
}

/// Linux: the first browser of each family on PATH (`{chrome}` may also be
/// Chromium – both speak the DevTools protocol).
#[cfg(not(windows))]
pub fn browsers() -> Browsers {
    let find = |names: &[&str]| -> Option<String> {
        names
            .iter()
            .find_map(|n| crate::agent_process::resolve_program(n).ok())
            .map(|p| p.to_string_lossy().into_owned())
    };
    Browsers {
        edge: find(&["microsoft-edge-stable", "microsoft-edge"]),
        chrome: find(&["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]),
    }
}

/// Registry package names: `aar-ext-<slug>` (registry schema).
pub fn valid_dist_name(name: &str) -> bool {
    name.len() <= 64
        && name.strip_prefix("aar-ext-").is_some_and(|rest| {
            !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

/// pip requirement for a catalog MCP server: a plain project name with an
/// optional version pin – no URLs, paths or pip options.
pub fn valid_requirement(req: &str) -> bool {
    let req = req.trim();
    !req.is_empty()
        && req.len() <= 100
        && !req.starts_with('-')
        && req.chars().all(|c| c.is_ascii_alphanumeric() || "-_.=<>!~[],".contains(c))
}

fn registry_source(dist: &str) -> String {
    format!("{REGISTRY_ARCHIVE}#subdirectory=packages/{dist}")
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryResult {
    /// The registry JSON (`{"extensions": [...]}`), live or from the cache.
    pub data: Option<Value>,
    /// Loaded from the last successful download (offline).
    pub cached: bool,
    pub error: Option<String>,
}

pub fn fetch_registry(app: &AppHandle) -> RegistryResult {
    let cache = app.path().app_local_data_dir().ok().map(|d| d.join("registry.json"));
    let live = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .build()
        .get(REGISTRY_INDEX)
        .call()
        .map_err(|e| e.to_string())
        .and_then(|r| r.into_string().map_err(|e| e.to_string()))
        .and_then(|text| serde_json::from_str::<Value>(&text).map(|v| (text, v)).map_err(|e| e.to_string()));
    match live {
        Ok((text, v)) => {
            if let Some(c) = &cache {
                let _ = c.parent().map(std::fs::create_dir_all);
                let _ = std::fs::write(c, text);
            }
            RegistryResult { data: Some(v), cached: false, error: None }
        }
        Err(e) => {
            let old = cache
                .and_then(|c| std::fs::read_to_string(c).ok())
                .and_then(|t| serde_json::from_str::<Value>(&t).ok());
            RegistryResult { cached: old.is_some(), data: old, error: Some(e) }
        }
    }
}

// ---------------------------------------------------------------------------
// Helper processes
// ---------------------------------------------------------------------------

/// Running install/uninstall (one at a time), so it can be cancelled.
static RUNNING: Mutex<Option<Arc<Mutex<Child>>>> = Mutex::new(None);
static BUSY: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize)]
struct ProgressPayload {
    line: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HelperResult {
    pub ok: bool,
    /// Last `@@JSON` line of the helper.
    pub data: Option<Value>,
    /// Last lines of output (shown as technical details when it failed).
    pub log: String,
}

/// `python -m <module> …` with the Python that runs aar (bundled runtime or
/// the user's own, see `helpers.rs`).
fn helper_command(app: &AppHandle, module: &str, args: &[String]) -> Result<Command, String> {
    let rt = crate::helpers::runtime(app, &crate::current_settings(app))?;
    let mut cmd = rt.command();
    cmd.arg("-m").arg(module).args(args);
    if let Some(d) = ext_dir(app) {
        cmd.env(EXT_DIR_ENV, d);
    }
    if let Some(d) = mcp_dir(app) {
        cmd.env(MCP_DIR_ENV, d);
    }
    if let Some(d) = node_dir(app) {
        cmd.env(NODE_DIR_ENV, d);
    }
    if let Ok(d) = app.path().app_local_data_dir() {
        let _ = std::fs::create_dir_all(&d);
        cmd.current_dir(d);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(cmd)
}

/// Run a helper, forward its output lines as `addons://progress` (when
/// `progress`), return its JSON result. Waits at most `timeout`.
fn run_helper(app: &AppHandle, module: &str, args: &[String], progress: bool, timeout: Duration) -> Result<HelperResult, String> {
    let _busy = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    let mut cmd = helper_command(app, module, args)?;
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let child = Arc::new(Mutex::new(child));
    *RUNNING.lock().unwrap() = Some(child.clone());

    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let reader_app = app.clone();
    let out_thread = std::thread::spawn(move || {
        let mut data = None;
        let mut tail: Vec<String> = vec![];
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(json) = line.strip_prefix("@@JSON ") {
                data = serde_json::from_str::<Value>(json).ok();
                continue;
            }
            let line = line.trim_end().to_string();
            if line.is_empty() {
                continue;
            }
            if progress {
                let _ = reader_app.emit("addons://progress", ProgressPayload { line: line.clone() });
            }
            tail.push(line);
            if tail.len() > 40 {
                tail.remove(0);
            }
        }
        (data, tail)
    });

    let started = std::time::Instant::now();
    let status = loop {
        if let Some(st) = child.lock().unwrap().try_wait().map_err(|e| e.to_string())? {
            break Some(st);
        }
        if started.elapsed() > timeout {
            let _ = child.lock().unwrap().kill();
            break None;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    *RUNNING.lock().unwrap() = None;
    let (data, tail) = out_thread.join().unwrap_or_default();
    let err = err_thread.join().unwrap_or_default();
    let mut log = tail.join("\n");
    let err_tail: Vec<&str> = err.lines().filter(|l| !l.trim().is_empty()).collect();
    if !err_tail.is_empty() {
        log.push_str("\n");
        log.push_str(&err_tail[err_tail.len().saturating_sub(20)..].join("\n"));
    }
    let Some(status) = status else {
        return Ok(HelperResult {
            ok: false,
            data,
            log: format!("{}\n{log}", tr("Zeitüberschreitung", "Timed out", "超时")),
        });
    };
    Ok(HelperResult { ok: status.success(), data, log: log.trim().to_string() })
}

pub fn cancel() {
    if let Some(child) = RUNNING.lock().unwrap().as_ref() {
        let _ = child.lock().unwrap().kill();
    }
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

pub fn ext_list(app: &AppHandle) -> Result<HelperResult, String> {
    run_helper(app, "aar_desktop.ext", &["list".into()], false, Duration::from_secs(120))
}

pub fn ext_install(app: &AppHandle, dist: &str) -> Result<HelperResult, String> {
    if !valid_dist_name(dist) {
        return Err(format!("invalid package name: {dist}"));
    }
    let args = vec!["install".into(), dist.into(), registry_source(dist)];
    run_helper(app, "aar_desktop.ext", &args, true, Duration::from_secs(900))
}

pub fn ext_uninstall(app: &AppHandle, dist: &str) -> Result<HelperResult, String> {
    if !valid_dist_name(dist) {
        return Err(format!("invalid package name: {dist}"));
    }
    run_helper(app, "aar_desktop.ext", &["uninstall".into(), dist.into()], true, Duration::from_secs(300))
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

fn server_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_server_id(id) {
        return Err(format!("invalid server id: {id}"));
    }
    mcp_dir(app).map(|d| d.join(id)).ok_or_else(|| "no data dir".into())
}

/// Install a catalog server: `runtime` "python" (pip) or "node" (npm, with the
/// portable Node.js downloaded first if needed; `bin` picks the executable).
pub fn mcp_install(app: &AppHandle, id: &str, requirement: &str, runtime: &str, bin: &str) -> Result<HelperResult, String> {
    let dir = server_dir(app, id)?;
    let (module, ok) = match runtime {
        "node" => ("aar_desktop.node", valid_npm_spec(requirement) && (bin.is_empty() || valid_npm_spec(bin))),
        _ => ("aar_desktop.mcp", valid_requirement(requirement)),
    };
    if !ok {
        return Err(format!("invalid package: {requirement}"));
    }
    // Fresh install: a half-finished earlier attempt must not linger.
    remove_dir(&dir)?;
    let mut args = vec!["install".into(), dir.to_string_lossy().into_owned(), requirement.trim().into()];
    if runtime == "node" && !bin.is_empty() {
        args.push(bin.into());
    }
    let r = run_helper(app, module, &args, true, Duration::from_secs(1800))?;
    if !r.ok {
        let _ = remove_dir(&dir);
    }
    Ok(r)
}

/// Remove an installed server together with its data (`{state}`, e.g. the
/// memory server's knowledge graph).
pub fn mcp_remove(app: &AppHandle, id: &str) -> Result<(), String> {
    remove_dir(&server_dir(app, id)?)?;
    if let Some(state) = mcp_state_dir(app) {
        remove_dir(&state.join(id))?;
    }
    Ok(())
}

/// Ids of the package servers that are installed.
pub fn mcp_installed(app: &AppHandle) -> Vec<String> {
    let Some(root) = mcp_dir(app) else { return vec![] };
    let Ok(entries) = std::fs::read_dir(root) else { return vec![] };
    entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .filter(|id| valid_server_id(id))
        .collect()
}

fn remove_dir(dir: &Path) -> Result<(), String> {
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_registry_package_names() {
        assert!(valid_dist_name("aar-ext-permission-gate"));
        for bad in ["aar-ext-", "permission-gate", "aar-ext-x/../y", "aar-ext-X", "aar-ext-a b", "aar-ext-a#b"] {
            assert!(!valid_dist_name(bad), "{bad}");
        }
        assert_eq!(
            registry_source("aar-ext-inspect"),
            "https://github.com/fischerf/aar-extensions-registry/archive/refs/heads/main.zip#subdirectory=packages/aar-ext-inspect"
        );
    }

    #[test]
    fn only_plain_npm_specs() {
        for ok in ["chrome-devtools-mcp@latest", "@playwright/mcp@latest", "@modelcontextprotocol/server-memory", "x@^1.2.3"] {
            assert!(valid_npm_spec(ok), "{ok}");
        }
        for bad in ["", "--registry=http://x", "git+https://x/y", "../x", "a/b", "file:x", "https://x/y.tgz", "@a/b/c", "X"] {
            assert!(!valid_npm_spec(bad), "{bad}");
        }
    }

    #[test]
    fn only_plain_requirements() {
        for ok in ["mcp-server-fetch", "markitdown-mcp==0.0.1a8", "pkg[extra]>=1,<2"] {
            assert!(valid_requirement(ok), "{ok}");
        }
        for bad in ["", "--index-url=http://x", "https://evil/x.whl", "C:\\x.whl", "a b", "-e ."] {
            assert!(!valid_requirement(bad), "{bad}");
        }
    }
}
