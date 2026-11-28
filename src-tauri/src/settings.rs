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
    /// Named custom providers saved in the widget settings (e.g. corporate
    /// Gemini or OpenAI-compatible gateways), referenced as `custom:<id>` in
    /// `provider`.
    pub custom_providers: Vec<CustomProvider>,
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
            custom_providers: vec![],
            allowed_tools: vec![],
            anchor_right: None,
            anchor_bottom: None,
            expanded_width: None,
            expanded_height: None,
        }
    }
}

/// A named custom provider profile saved in the widget settings (e.g. a
/// corporate Gemini or OpenAI-compatible gateway).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CustomProvider {
    /// Unique slug; referenced in `Settings.provider` as `custom:<id>`.
    pub id: String,
    /// User-chosen display name (e.g. "gemini 3.1").
    pub name: String,
    /// Underlying aar provider type: "gemini" | "openai" | "anthropic" | "generic".
    pub kind: String,
    /// Model identifier (e.g. "gemini-3.1-flash-lite").
    pub model: String,
    /// Endpoint / base URL (empty = provider default).
    pub base_url: String,
    /// API key passed to aar via environment variable (never on the CLI).
    pub api_key: String,
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

/// Text of a settings file as editors and PowerShell 5.1 write it: UTF-8 (with or
/// without BOM), UTF-16 with BOM (`Out-File`), otherwise ANSI read as Latin-1.
fn decode_text(bytes: &[u8]) -> String {
    let utf16 = |le: bool| {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) })
            .collect();
        String::from_utf16_lossy(&units)
    };
    match bytes {
        [0xFF, 0xFE, ..] => utf16(true),
        [0xFE, 0xFF, ..] => utf16(false),
        _ => match std::str::from_utf8(bytes) {
            Ok(s) => s.to_string(),
            Err(_) => bytes.iter().map(|&b| b as char).collect(),
        },
    }
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

    /// Only a missing file means "defaults". A file that cannot be read as a whole
    /// keeps every field that still fits (API keys, servers, …); whenever something
    /// is dropped, the original is copied to `settings.json.<time>.bad` first,
    /// because the next save rewrites the file.
    pub fn load(app: &AppHandle) -> Self {
        let Some(path) = Self::path(app) else { return Self::default() };
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Self::default(),
            Err(e) => {
                // Locked or unreadable right now: do not touch the file.
                eprintln!("settings: cannot read {}: {e}", path.display());
                return Self::default();
            }
        };
        let text = decode_text(&bytes);
        if let Some(s) = Self::parse(&text) {
            return s;
        }
        let (settings, dropped) = Self::parse_lenient(&text).unwrap_or_else(|| (Self::default(), vec!["*".into()]));
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let backup = path.with_file_name(format!("settings.json.{stamp}.bad"));
        let moved = std::fs::copy(&path, &backup).is_ok();
        eprintln!(
            "settings: {} could not be read completely (dropped: {}); original {}",
            path.display(),
            dropped.join(", "),
            if moved { format!("kept as {}", backup.display()) } else { "could not be copied".into() }
        );
        settings
    }

    /// Tolerates a UTF-8 BOM (PowerShell 5.1 `Set-Content -Encoding UTF8`
    /// writes one, e.g. when admins provision the settings).
    fn parse(text: &str) -> Option<Self> {
        serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
    }

    /// Valid JSON with a field of the wrong type: keep all fields that fit.
    /// Returns the settings and the names of the fields that were dropped.
    fn parse_lenient(text: &str) -> Option<(Self, Vec<String>)> {
        let value: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
        let fields = value.as_object()?;
        let mut acc = serde_json::to_value(Self::default()).ok()?;
        let mut dropped = vec![];
        for (key, val) in fields {
            let mut trial = acc.clone();
            trial.as_object_mut()?.insert(key.clone(), val.clone());
            if serde_json::from_value::<Self>(trial.clone()).is_ok() {
                acc = trial;
            } else {
                dropped.push(key.clone());
            }
        }
        Some((serde_json::from_value(acc).ok()?, dropped))
    }

    /// Write to a temporary file and rename it over the old one, so a crash or
    /// a full disk never leaves a half-written settings.json behind.
    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        let path = Self::path(app).ok_or("no config dir")?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        let tmp = path.with_file_name("settings.json.tmp");
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            e.to_string()
        })
    }

    /// The active custom provider when `provider` is `custom:<id>`.
    pub fn selected_custom_provider(&self) -> Option<&CustomProvider> {
        let id = self.provider.trim().strip_prefix("custom:")?;
        self.custom_providers.iter().find(|p| p.id == id)
    }

    /// Full argument list: user args + connection overrides as aar CLI flags.
    pub fn effective_args(&self) -> Vec<String> {
        let mut args = self.agent_args.clone();
        let (provider, model, base_url) = match self.selected_custom_provider() {
            Some(cp) => (cp.kind.as_str(), cp.model.as_str(), cp.base_url.as_str()),
            None => (self.provider.as_str(), self.model.as_str(), self.base_url.as_str()),
        };
        for (flag, value) in [
            ("--config", self.config_path.as_str()),
            ("--provider", provider),
            ("--model", model),
            ("--base-url", base_url),
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

    /// `(variable, key)` for aar when `provider` is a custom provider or a
    /// cloud provider type (not a profile of the aar config, which brings its
    /// own key) with a stored key.
    pub fn api_key_env(&self, profile_keys: &[String]) -> Option<(&'static str, String)> {
        if let Some(cp) = self.selected_custom_provider() {
            let key = cp.api_key.trim();
            let var = crate::llm_config::api_key_env(cp.kind.trim())?;
            return (!key.is_empty()).then(|| (var, key.to_string()));
        }
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
    fn settings_in_utf16_or_ansi_load() {
        let json = "{\"language\":\"en\",\"workingDir\":\"C:\\\\Users\\\\Jörg\"}";
        let mut utf16 = vec![0xFF, 0xFE];
        utf16.extend(json.encode_utf16().flat_map(|u| u.to_le_bytes()));
        let s = Settings::parse(&decode_text(&utf16)).expect("UTF-16 (Out-File) must load");
        assert_eq!(s.language, "en");
        assert_eq!(s.working_dir, "C:\\Users\\Jörg");
        let ansi: Vec<u8> = json.chars().map(|c| c as u32 as u8).collect();
        let s = Settings::parse(&decode_text(&ansi)).expect("ANSI must load");
        assert_eq!(s.working_dir, "C:\\Users\\Jörg");
    }

    #[test]
    fn one_bad_field_keeps_the_others() {
        let text = r#"{"language":"en","autostart":"yes","apiKeys":{"anthropic":"sk-1"},"allowedTools":["click"]}"#;
        assert!(Settings::parse(text).is_none(), "strict parse rejects the wrong type");
        let (s, dropped) = Settings::parse_lenient(text).expect("valid JSON");
        assert_eq!(dropped, vec!["autostart".to_string()]);
        assert_eq!(s.language, "en");
        assert!(s.autostart, "dropped field falls back to its default");
        assert_eq!(s.api_keys.get("anthropic").map(String::as_str), Some("sk-1"));
        assert_eq!(s.allowed_tools, vec!["click".to_string()]);
        assert!(Settings::parse_lenient("{\"language\":").is_none());
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
    fn custom_provider_args_and_api_key() {
        let mut s = Settings::default();
        s.custom_providers.push(CustomProvider {
            id: "gemini-3-1".into(),
            name: "gemini 3.1".into(),
            kind: "gemini".into(),
            model: "gemini-3.1-flash-lite".into(),
            base_url: "https://gateway.example/gemini/gemini-3.x-flash-lite".into(),
            api_key: "secret-key".into(),
        });
        s.provider = "custom:gemini-3-1".into();
        assert_eq!(
            s.effective_args(),
            vec![
                "acp",
                "--provider",
                "gemini",
                "--model",
                "gemini-3.1-flash-lite",
                "--base-url",
                "https://gateway.example/gemini/gemini-3.x-flash-lite",
            ]
        );
        // Key goes to GEMINI_API_KEY even if the aar config has a "gemini" profile, and never on CLI.
        assert_eq!(s.api_key_env(&["gemini".into()]), Some(("GEMINI_API_KEY", "secret-key".into())));
        assert!(!serde_json::to_string(&s.effective_args()).unwrap().contains("secret-key"));
    }

    #[test]
    fn old_settings_files_load_without_context_window() {
        let s: Settings = serde_json::from_str(r#"{"provider":"ollama"}"#).unwrap();
        assert_eq!(s.context_window, 0);
        assert!(s.autostart, "existing installs get autostart like new ones");
        assert!(!s.effective_args().contains(&"--context-window".to_string()));
        assert!(s.language.is_empty() && s.disabled_extensions.is_empty() && s.mcp_servers.is_empty() && s.custom_providers.is_empty());
    }
}
