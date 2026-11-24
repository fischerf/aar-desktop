//! Persistent widget settings (`%APPDATA%\de.aar.ui\settings.json`).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Executable that speaks ACP over stdio. Empty = automatic (bundled
    /// runtime next to the app, else `aar` from PATH).
    pub agent_command: String,
    /// Arguments for the executable (normally `["acp"]`).
    pub agent_args: Vec<String>,
    /// Working directory for the agent session. Empty = user profile.
    pub working_dir: String,
    /// Global hotkey that shows/hides the chat bubble.
    pub hotkey: String,
    /// LLM connection overrides, passed to `aar acp` as CLI flags.
    /// Empty = use whatever the aar config file says.
    /// Profile key from the config's `providers` (or a provider type) -> `--provider`.
    pub provider: String,
    /// Model name override -> `--model`.
    pub model: String,
    /// Server address, e.g. `http://localhost:11434` -> `--base-url`.
    pub base_url: String,
    /// Alternative aar config file -> `--config` (default `~/.aar/config.json`).
    pub config_path: String,
    /// Let aar operate Windows programs (bundled Windows desktop MCP server).
    pub desktop_control: bool,
    /// Start the widget when the user signs in to Windows (HKCU Run key).
    pub autostart: bool,
    /// Model context size in tokens -> `--context-window` (aar sends it to
    /// Ollama as `num_ctx`). 0 = leave it to the profile / Ollama's default.
    pub context_window: u32,
    /// UI language: "de" / "en" / "zh"; empty = Windows display language.
    pub language: String,
    /// Installed aar extensions that must not be loaded (passed to aar as
    /// `AAR_DISABLED_EXTENSIONS`).
    pub disabled_extensions: Vec<String>,
    /// MCP servers the user added (tool servers handed to aar per session).
    pub mcp_servers: Vec<UserMcpServer>,
    /// Folders the photo search indexes (chosen explicitly; empty = off).
    pub photo_folders: Vec<String>,
    /// Vision model for describing photos; empty = the chat model.
    pub photo_model: String,
    /// API keys per provider type (anthropic, openai, gemini, generic), used
    /// when `provider` is that type; aar gets it as the provider's environment
    /// variable (never on the command line or in the log).
    pub api_keys: std::collections::BTreeMap<String, String>,
    /// Tools the user allowed permanently ("Immer erlauben"): the widget
    /// answers aar's permission requests for them itself (raw tool names,
    /// e.g. `windows__click_element`).
    pub allowed_tools: Vec<String>,
    /// Bottom-right corner of the window (physical pixels), restored on start.
    /// The mascot sits in that corner, so the bubble grows up/left from it.
    pub anchor_right: Option<i32>,
    pub anchor_bottom: Option<i32>,
    /// Logical size of the open chat window (user-resizable).
    pub expanded_width: Option<f64>,
    pub expanded_height: Option<f64>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            // Empty = automatic: bundled runtime, else `aar` from PATH.
            agent_command: String::new(),
            agent_args: vec!["acp".into()],
            working_dir: String::new(),
            hotkey: "Ctrl+Alt+A".into(),
            provider: String::new(),
            model: String::new(),
            base_url: String::new(),
            config_path: String::new(),
            desktop_control: true,
            autostart: true,
            context_window: 0,
            language: String::new(),
            disabled_extensions: vec![],
            mcp_servers: vec![],
            photo_folders: vec![],
            photo_model: String::new(),
            api_keys: Default::default(),
            allowed_tools: vec![],
            anchor_right: None,
            anchor_bottom: None,
            expanded_width: None,
            expanded_height: None,
        }
    }
}

/// A tool server (MCP) added under Settings → Tools.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct UserMcpServer {
    /// Unique slug; also the server name aar sees (`[a-z0-9-]`, max 32).
    pub id: String,
    /// Name shown in the settings.
    pub label: String,
    /// "package" = pip package run by the bundled Python (installed by the app),
    /// "node" = npm package run by the app's portable Node.js (installed by the app),
    /// "command" = any program speaking MCP over stdio, "http" = remote server.
    pub kind: String,
    pub enabled: bool,
    /// Catalog entry it was added from ("" = added by hand).
    pub catalog: String,
    /// kind "package": pip requirement and the console script to start;
    /// kind "node": npm spec (e.g. `chrome-devtools-mcp@latest`) and bin name.
    pub package: String,
    pub script: String,
    /// kind "command" (program) / "package", "node" (extra arguments).
    /// Placeholders in args and env values: `{edge}`, `{chrome}` (browser
    /// executables), `{state}` (a data folder of this server that survives
    /// reinstalling it).
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<KeyValue>,
    /// kind "http".
    pub url: String,
    pub headers: Vec<KeyValue>,
    /// Values of the catalog entry's settings dialog (args/env are derived
    /// from them by the frontend; kept to fill the dialog again).
    pub options: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct KeyValue {
    pub name: String,
    pub value: String,
}

/// Server ids double as directory names and MCP server names.
pub fn valid_server_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !id.starts_with('-')
}

impl Settings {
    fn path(app: &AppHandle) -> Option<PathBuf> {
        app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
    }

    pub fn load(app: &AppHandle) -> Self {
        Self::path(app)
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| Self::parse(&s))
            .unwrap_or_default()
    }

    /// Tolerates a UTF-8 BOM (PowerShell 5.1 `Set-Content -Encoding UTF8`
    /// writes one, e.g. when admins provision the settings).
    fn parse(text: &str) -> Option<Self> {
        serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
    }

    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        let path = Self::path(app).ok_or("no config dir")?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| e.to_string())
    }

    /// Full argument list: user args + connection overrides as aar CLI flags.
    pub fn effective_args(&self) -> Vec<String> {
        let mut args = self.agent_args.clone();
        for (flag, value) in [
            ("--config", &self.config_path),
            ("--provider", &self.provider),
            ("--model", &self.model),
            ("--base-url", &self.base_url),
        ] {
            let v = value.trim();
            if !v.is_empty() && !args.iter().any(|a| a == flag) {
                args.push(flag.into());
                args.push(v.into());
            }
        }
        if self.context_window > 0 && !args.iter().any(|a| a == "--context-window") {
            args.push("--context-window".into());
            args.push(self.context_window.to_string());
        }
        args
    }

    /// `(variable, key)` for aar when `provider` is a cloud provider type (not
    /// a profile of the aar config, which brings its own key) with a stored key.
    pub fn api_key_env(&self, profile_keys: &[String]) -> Option<(&'static str, String)> {
        let kind = self.provider.trim();
        if !crate::llm_config::CLOUD_KINDS.contains(&kind) || profile_keys.iter().any(|k| k == kind) {
            return None;
        }
        let key = self.api_keys.get(kind).map(|k| k.trim()).unwrap_or_default();
        let var = crate::llm_config::api_key_env(kind)?;
        (!key.is_empty()).then(|| (var, key.to_string()))
    }

    /// aar config file the agent will read.
    pub fn aar_config_file(&self, app: &AppHandle) -> PathBuf {
        let p = self.config_path.trim();
        if !p.is_empty() {
            return PathBuf::from(p);
        }
        app.path()
            .home_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".aar")
            .join("config.json")
    }

    /// Where aar stores the conversations: `session_dir` from the aar config
    /// (default `.agent/sessions`), relative paths below the working folder.
    pub fn sessions_dir(&self, app: &AppHandle) -> PathBuf {
        let configured = std::fs::read_to_string(self.aar_config_file(app))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("session_dir").and_then(|d| d.as_str()).map(PathBuf::from));
        sessions_dir_from(configured, &self.resolved_working_dir(app))
    }

    /// Working directory to start the agent in.
    pub fn resolved_working_dir(&self, app: &AppHandle) -> PathBuf {
        let wd = self.working_dir.trim();
        if !wd.is_empty() {
            let p = PathBuf::from(wd);
            if p.is_dir() {
                return p;
            }
        }
        app.path().home_dir().unwrap_or_else(|_| PathBuf::from("."))
    }
}

fn sessions_dir_from(configured: Option<PathBuf>, working_dir: &std::path::Path) -> PathBuf {
    let dir = configured
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| PathBuf::from(".agent").join("sessions"));
    native_separators(if dir.is_absolute() { dir } else { working_dir.join(dir) })
}

/// aar configs write `".agent/sessions"`; joined to `C:\Users\x` that gives
/// `C:\Users\x\.agent/sessions`, which Rust accepts but Explorer does not (it
/// opens "Documents" instead). Rebuilding the path from its components uses
/// the platform separator throughout.
pub fn native_separators(p: PathBuf) -> PathBuf {
    p.components().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sessions_dir_follows_the_aar_config() {
        let wd = std::path::Path::new("/home/u");
        assert_eq!(sessions_dir_from(None, wd), wd.join(".agent").join("sessions"));
        assert_eq!(sessions_dir_from(Some("chats".into()), wd), wd.join("chats"));
        assert_eq!(sessions_dir_from(Some("/var/aar".into()), wd), PathBuf::from("/var/aar"));
        assert_eq!(sessions_dir_from(Some("".into()), wd), wd.join(".agent").join("sessions"));
    }

    #[test]
    fn sessions_dir_has_no_mixed_separators() {
        let wd = std::path::Path::new("/home/u");
        let p = sessions_dir_from(Some(".agent/sessions".into()), wd);
        assert_eq!(p, wd.join(".agent").join("sessions"));
        assert_eq!(p.components().count(), 5); // "/", home, u, .agent, sessions
        assert_eq!(sessions_dir_from(Some("./chats/".into()), wd), wd.join("chats"));
    }

    #[test]
    fn effective_args_appends_overrides() {
        let mut s = Settings::default();
        assert_eq!(s.effective_args(), vec!["acp"]);
        s.provider = "qwen354b".into();
        s.base_url = " http://localhost:11434 ".into();
        assert_eq!(
            s.effective_args(),
            vec!["acp", "--provider", "qwen354b", "--base-url", "http://localhost:11434"]
        );
        // Explicit flags in the user args win.
        s.agent_args = vec!["acp".into(), "--provider".into(), "x".into()];
        assert_eq!(
            s.effective_args(),
            vec!["acp", "--provider", "x", "--base-url", "http://localhost:11434"]
        );
        s.context_window = 16384;
        assert_eq!(
            s.effective_args()[5..],
            ["--context-window".to_string(), "16384".to_string()]
        );
    }

    #[test]
    fn api_key_only_for_provider_types() {
        let mut s = Settings::default();
        s.api_keys.insert("anthropic".into(), " sk-1 ".into());
        assert_eq!(s.api_key_env(&[]), None, "no provider chosen");
        s.provider = "anthropic".into();
        assert_eq!(s.api_key_env(&[]), Some(("ANTHROPIC_API_KEY", "sk-1".into())));
        // A profile with that name in the aar config wins (it has its own key).
        assert_eq!(s.api_key_env(&["anthropic".into()]), None);
        s.provider = "openai".into();
        assert_eq!(s.api_key_env(&[]), None, "no key stored for openai");
        s.provider = "ollama".into();
        assert_eq!(s.api_key_env(&[]), None);
        assert!(!serde_json::to_string(&s.effective_args()).unwrap().contains("sk-1"));
    }

    #[test]
    fn settings_with_bom_load() {
        let text = "\u{feff}{\"language\":\"en\",\"mcpServers\":[{\"id\":\"fetch\",\"kind\":\"package\",\"enabled\":true}]}";
        let s = Settings::parse(text).expect("BOM must not break the settings");
        assert_eq!(s.language, "en");
        assert_eq!(s.mcp_servers[0].id, "fetch");
        assert!(s.autostart);
    }

    #[test]
    fn server_ids_are_safe_directory_names() {
        assert!(valid_server_id("fetch"));
        assert!(valid_server_id("my-server-2"));
        for bad in ["", "-x", "Fetch", "a/b", "..", "a b", "x".repeat(33).as_str()] {
            assert!(!valid_server_id(bad), "{bad}");
        }
    }

    #[test]
    fn old_settings_files_load_without_context_window() {
        let s: Settings = serde_json::from_str(r#"{"provider":"ollama"}"#).unwrap();
        assert_eq!(s.context_window, 0);
        assert!(s.autostart, "existing installs get autostart like new ones");
        assert!(!s.effective_args().contains(&"--context-window".to_string()));
        assert!(s.language.is_empty() && s.disabled_extensions.is_empty() && s.mcp_servers.is_empty());
    }
}
