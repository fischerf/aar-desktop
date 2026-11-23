//! Read-only helpers around the aar LLM configuration:
//! list the provider profiles from the aar config file and check whether a
//! model server is reachable. The widget never writes the aar config.

use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::Duration;

use crate::i18n::tr;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Key in `providers` (what `--provider` expects).
    pub key: String,
    /// Provider type (ollama, anthropic, openai, generic, …).
    pub kind: String,
    pub model: String,
    pub base_url: String,
    /// Context size in tokens (`context_window`, else Ollama's `extra.num_ctx`; 0 = unknown).
    pub context_window: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AarConfigInfo {
    pub path: String,
    pub found: bool,
    pub error: Option<String>,
    /// Profile key used when no `--provider` is given (empty if inline/unknown).
    pub default_profile: String,
    /// Inline default provider (when `provider` is an object, not a key).
    pub default_inline: Option<Profile>,
    pub profiles: Vec<Profile>,
    /// Top-level `context_window` (used when a profile has none; 0 = unset).
    pub context_window: u64,
}

fn profile_from(key: &str, v: &Value) -> Profile {
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let context_window = v
        .get("context_window")
        .and_then(Value::as_u64)
        .filter(|n| *n > 0)
        .or_else(|| v.get("extra").and_then(|e| e.get("num_ctx")).and_then(Value::as_u64))
        .unwrap_or(0);
    Profile { key: key.to_string(), kind: s("name"), model: s("model"), base_url: s("base_url"), context_window }
}

pub fn read_aar_config(path: &Path) -> AarConfigInfo {
    let mut info = AarConfigInfo { path: path.to_string_lossy().into_owned(), ..Default::default() };
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            info.error = Some(trf!(
                "Konfiguration nicht lesbar: {e}",
                "Cannot read the configuration: {e}",
                "无法读取配置：{e}"
            ));
            return info;
        }
    };
    info.found = true;
    let json: Value = match serde_json::from_str(&text) {
        Ok(j) => j,
        Err(e) => {
            info.error = Some(trf!(
                "Konfiguration ist kein gültiges JSON: {e}",
                "The configuration is not valid JSON: {e}",
                "配置不是有效的 JSON：{e}"
            ));
            return info;
        }
    };
    if let Some(map) = json.get("providers").and_then(Value::as_object) {
        info.profiles = map.iter().map(|(k, v)| profile_from(k, v)).collect();
    }
    info.context_window = json.get("context_window").and_then(Value::as_u64).unwrap_or(0);
    match json.get("provider") {
        Some(Value::String(key)) => info.default_profile = key.clone(),
        Some(obj @ Value::Object(_)) => info.default_inline = Some(profile_from("", obj)),
        _ => {}
    }
    info
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointCheck {
    pub reachable: bool,
    pub message: String,
    /// Models reported by an Ollama server (`/api/tags`), if available.
    pub models: Vec<String>,
}

/// Split `http://host:port/path` into (scheme, host, port).
fn parse_url(url: &str) -> Result<(String, String, u16), String> {
    let url = url.trim();
    let (scheme, rest) = match url.split_once("://") {
        Some((s, r)) => (s.to_ascii_lowercase(), r),
        None => ("http".to_string(), url),
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let authority = authority.rsplit('@').next().unwrap_or_default();
    if authority.is_empty() {
        return Err(tr("Keine Adresse angegeben", "No address given", "未填写地址").into());
    }
    let default_port = if scheme == "https" { 443 } else { 80 };
    // IPv6 literal: [::1]:11434
    let (host, port) = if let Some(stripped) = authority.strip_prefix('[') {
        let (h, after) = stripped
            .split_once(']')
            .ok_or(tr("Ungültige IPv6-Adresse", "Invalid IPv6 address", "无效的 IPv6 地址"))?;
        let port = after
            .strip_prefix(':')
            .map(str::parse)
            .transpose()
            .map_err(|_| tr("Ungültiger Port", "Invalid port", "无效的端口"))?;
        (h.to_string(), port.unwrap_or(default_port))
    } else if let Some((h, p)) = authority.rsplit_once(':') {
        (
            h.to_string(),
            p.parse().map_err(|_| trf!("Ungültiger Port '{p}'", "Invalid port '{p}'", "无效的端口“{p}”"))?,
        )
    } else {
        (authority.to_string(), default_port)
    };
    Ok((scheme, host, port))
}

pub fn check_endpoint(url: &str) -> EndpointCheck {
    let fail = |m: String| EndpointCheck { reachable: false, message: m, models: vec![] };
    let (scheme, host, port) = match parse_url(url) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };
    let addrs: Vec<_> = match (host.as_str(), port).to_socket_addrs() {
        Ok(a) => a.collect(),
        Err(e) => {
            return fail(trf!(
                "Adresse {host} nicht auflösbar: {e}",
                "Cannot resolve the address {host}: {e}",
                "无法解析地址 {host}：{e}"
            ))
        }
    };
    let timeout = Duration::from_secs(3);
    let Some(mut stream) = addrs.iter().find_map(|a| TcpStream::connect_timeout(a, timeout).ok()) else {
        return fail(trf!(
            "{host}:{port} ist nicht erreichbar (läuft der Server?)",
            "{host}:{port} cannot be reached (is the server running?)",
            "无法连接 {host}:{port}（服务器在运行吗？）"
        ));
    };

    let mut result = EndpointCheck {
        reachable: true,
        message: trf!("{host}:{port} ist erreichbar", "{host}:{port} is reachable", "{host}:{port} 可以连接"),
        models: vec![],
    };

    // Plain HTTP: ask an Ollama server which models it has.
    if scheme == "http" {
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));
        let req = format!("GET /api/tags HTTP/1.0\r\nHost: {host}:{port}\r\nAccept: application/json\r\n\r\n");
        if stream.write_all(req.as_bytes()).is_ok() {
            let mut buf = Vec::new();
            let _ = stream.take(4 * 1024 * 1024).read_to_end(&mut buf);
            let text = String::from_utf8_lossy(&buf);
            if let Some((head, body)) = text.split_once("\r\n\r\n") {
                if head.starts_with("HTTP/1.") && head.split_whitespace().nth(1) == Some("200") {
                    if let Ok(json) = serde_json::from_str::<Value>(body) {
                        if let Some(models) = json.get("models").and_then(Value::as_array) {
                            result.models = models
                                .iter()
                                .filter_map(|m| m.get("name").and_then(Value::as_str).map(String::from))
                                .collect();
                            result.message = trf!(
                                "Ollama auf {host}:{port} erreichbar",
                                "Ollama reachable at {host}:{port}",
                                "已连接到 {host}:{port} 上的 Ollama"
                            );
                        }
                    }
                }
            }
        }
    }
    result
}

/// Provider types the settings offer besides the profiles of the aar config.
pub const CLOUD_KINDS: [&str; 4] = ["anthropic", "openai", "gemini", "generic"];

/// Environment variable aar (or its provider) reads the API key from.
pub fn api_key_env(kind: &str) -> Option<&'static str> {
    match kind {
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "openai" => Some("OPENAI_API_KEY"),
        "gemini" => Some("GEMINI_API_KEY"),
        "generic" => Some("GENERIC_API_KEY"),
        _ => None,
    }
}

/// Request that lists the models of a cloud provider (checks the key as well).
fn models_request(kind: &str, base_url: &str, key: &str) -> Result<(String, Vec<(&'static str, String)>), String> {
    let base = base_url.trim().trim_end_matches('/');
    Ok(match kind {
        "anthropic" => (
            format!("{}/v1/models?limit=100", if base.is_empty() { "https://api.anthropic.com" } else { base }),
            vec![("x-api-key", key.to_string()), ("anthropic-version", "2023-06-01".into())],
        ),
        "openai" | "generic" => {
            if kind == "generic" && base.is_empty() {
                return Err(tr("Bitte die Server-Adresse eintragen.", "Please enter the server address.", "请填写服务器地址。").into());
            }
            // aar's generic provider takes the full chat endpoint; the model list sits next to it.
            let root = base.strip_suffix("/chat/completions").unwrap_or(base);
            (
                format!("{}/models", if root.is_empty() { "https://api.openai.com/v1" } else { root }),
                vec![("authorization", format!("Bearer {key}"))],
            )
        }
        "gemini" => (
            "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200".into(),
            vec![("x-goog-api-key", key.to_string())],
        ),
        _ => return Err(trf!("Unbekannter Anbieter {kind}", "Unknown provider {kind}", "未知的提供方 {kind}")),
    })
}

/// Model ids from a provider's model list (OpenAI/Anthropic `data[].id`,
/// Gemini `models[].name` without `models/`, only those that can chat).
fn model_ids(json: &Value) -> Vec<String> {
    let mut ids: Vec<String> = if let Some(data) = json.get("data").and_then(Value::as_array) {
        data.iter().filter_map(|m| m.get("id").and_then(Value::as_str).map(String::from)).collect()
    } else if let Some(models) = json.get("models").and_then(Value::as_array) {
        models
            .iter()
            .filter(|m| {
                m.get("supportedGenerationMethods")
                    .and_then(Value::as_array)
                    .map_or(true, |a| a.iter().any(|x| x == "generateContent"))
            })
            .filter_map(|m| m.get("name").and_then(Value::as_str))
            .map(|n| n.trim_start_matches("models/").to_string())
            .collect()
    } else {
        vec![]
    };
    ids.dedup();
    ids
}

pub fn check_provider(kind: &str, base_url: &str, key: &str) -> EndpointCheck {
    let fail = |m: String| EndpointCheck { reachable: false, message: m, models: vec![] };
    if key.trim().is_empty() {
        return fail(tr("Bitte den API-Schlüssel eintragen.", "Please enter the API key.", "请填写 API 密钥。").into());
    }
    let (url, headers) = match models_request(kind, base_url, key.trim()) {
        Ok(r) => r,
        Err(e) => return fail(e),
    };
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).build();
    let mut req = agent.get(&url);
    for (name, value) in &headers {
        req = req.set(name, value);
    }
    match req.call() {
        Ok(resp) => {
            let json: Value = resp.into_json().unwrap_or(Value::Null);
            let models = model_ids(&json);
            EndpointCheck {
                reachable: true,
                message: trf!(
                    "Verbunden – der Schlüssel funktioniert ({} Modelle).",
                    "Connected – the key works ({} models).",
                    "已连接 – 密钥有效（{} 个模型）。",
                    models.len()
                ),
                models,
            }
        }
        Err(ureq::Error::Status(401 | 403, _)) => fail(
            tr(
                "Der API-Schlüssel wurde abgelehnt. Bitte prüfe ihn.",
                "The API key was rejected. Please check it.",
                "API 密钥被拒绝，请检查。",
            )
            .into(),
        ),
        Err(ureq::Error::Status(400, r)) if kind == "gemini" => {
            // Gemini answers an invalid key with 400 API_KEY_INVALID.
            let body = r.into_string().unwrap_or_default();
            fail(if body.contains("API_KEY_INVALID") {
                tr("Der API-Schlüssel wurde abgelehnt. Bitte prüfe ihn.", "The API key was rejected. Please check it.", "API 密钥被拒绝，请检查。").into()
            } else {
                format!("HTTP 400: {}", body.chars().take(200).collect::<String>())
            })
        }
        Err(ureq::Error::Status(code, _)) => fail(trf!(
            "Der Server antwortet mit Fehler {code} ({url}).",
            "The server answered with error {code} ({url}).",
            "服务器返回错误 {code}（{url}）。"
        )),
        Err(e) => fail(trf!(
            "Keine Verbindung: {e}",
            "No connection: {e}",
            "无法连接：{e}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_urls() {
        assert_eq!(parse_url("http://localhost:11434").unwrap(), ("http".into(), "localhost".into(), 11434));
        assert_eq!(parse_url("http://127.0.0.1:11435/v1").unwrap(), ("http".into(), "127.0.0.1".into(), 11435));
        assert_eq!(parse_url("https://api.example.com").unwrap(), ("https".into(), "api.example.com".into(), 443));
        assert_eq!(parse_url("localhost:8080").unwrap(), ("http".into(), "localhost".into(), 8080));
        assert_eq!(parse_url("http://[::1]:11434/").unwrap(), ("http".into(), "::1".into(), 11434));
        assert!(parse_url("http://").is_err());
        assert!(parse_url("http://host:abc").is_err());
    }

    #[test]
    fn reads_config_profiles() {
        let dir = std::env::temp_dir().join(format!("aar-ui-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("config.json");
        std::fs::write(
            &p,
            r#"{"provider":"b","context_window":8192,"providers":{"a":{"name":"ollama","model":"m1","base_url":"http://x:1","extra":{"num_ctx":16384}},
                "b":{"name":"anthropic","model":"claude","base_url":"","context_window":200000}}}"#,
        )
        .unwrap();
        let info = read_aar_config(&p);
        assert!(info.found && info.error.is_none());
        assert_eq!(info.default_profile, "b");
        assert_eq!(info.profiles.len(), 2);
        assert_eq!(info.profiles.iter().find(|x| x.key == "a").unwrap().base_url, "http://x:1");
        assert_eq!(info.profiles.iter().find(|x| x.key == "a").unwrap().context_window, 16384);
        assert_eq!(info.profiles.iter().find(|x| x.key == "b").unwrap().context_window, 200000);
        assert_eq!(info.context_window, 8192);
        let missing = read_aar_config(&dir.join("nope.json"));
        assert!(!missing.found && missing.error.is_some());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn provider_model_lists() {
        let (url, h) = models_request("anthropic", "", "k").unwrap();
        assert_eq!(url, "https://api.anthropic.com/v1/models?limit=100");
        assert!(h.iter().any(|(n, v)| *n == "x-api-key" && v == "k"));
        assert_eq!(models_request("openai", "", "k").unwrap().0, "https://api.openai.com/v1/models");
        assert_eq!(
            models_request("generic", "https://x.example/v1/chat/completions", "k").unwrap().0,
            "https://x.example/v1/models"
        );
        assert!(models_request("generic", "", "k").is_err());
        let openai: Value = serde_json::from_str(r#"{"data":[{"id":"a"},{"id":"b"}]}"#).unwrap();
        assert_eq!(model_ids(&openai), ["a", "b"]);
        let gemini: Value = serde_json::from_str(
            r#"{"models":[{"name":"models/g1","supportedGenerationMethods":["generateContent"]},
                {"name":"models/emb","supportedGenerationMethods":["embedContent"]}]}"#,
        )
        .unwrap();
        assert_eq!(model_ids(&gemini), ["g1"]);
        assert!(!check_provider("anthropic", "", " ").reachable);
        assert_eq!(api_key_env("gemini"), Some("GEMINI_API_KEY"));
        assert_eq!(api_key_env("ollama"), None);
    }

    #[test]
    fn unreachable_endpoint() {
        // Port 1 on localhost is practically never open.
        let r = check_endpoint("http://127.0.0.1:1");
        assert!(!r.reachable);
    }
}
