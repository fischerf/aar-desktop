//! Photo search (Settings → Photos): the folders the user chose are described
//! once by the local vision model (Ollama) into an index; aar searches it via
//! the bundled MCP server `python -m aar_desktop.photos serve`. The index lives
//! in `%LOCALAPPDATA%\de.aar.ui\photos` (index.sqlite, thumbs\, progress.json).

use base64::Engine as _;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::agent_process::{EnvVar, McpServer};
use crate::i18n::tr;
use crate::settings::Settings;

pub fn photo_db_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("photos"))
}

/// Ollama address + vision model for indexing: the photo model from the
/// settings, else the chat model; the address from the settings or profile.
/// Err = why there is no local Ollama model (e.g. a cloud provider).
pub fn resolve_llm(app: &AppHandle, s: &Settings) -> Result<(String, String), String> {
    let info = crate::llm_config::read_aar_config(&s.aar_config_file(app));
    let profile = if s.provider.is_empty() {
        info.profiles.iter().find(|p| p.key == info.default_profile).cloned().or(info.default_inline.clone())
    } else {
        info.profiles.iter().find(|p| p.key == s.provider).cloned()
    };
    let kind = profile.as_ref().map(|p| p.kind.clone()).unwrap_or_else(|| s.provider.clone());
    if !kind.is_empty() && kind != "ollama" {
        // Chat in the cloud, photos stay local: a photo model on this PC's Ollama.
        if !s.photo_model.trim().is_empty() {
            return Ok((crate::setup::OLLAMA_URL.to_string(), s.photo_model.trim().to_string()));
        }
        return Err(tr(
            "Die Fotosuche braucht ein lokales Ollama-Modell – wähle unten ein Modell für die Fotobeschreibung (das Chat-Modell läuft bei einem anderen Anbieter).",
            "Photo search needs a local Ollama model – choose a model for describing photos below (the chat model runs at another provider).",
            "照片搜索需要本地 Ollama 模型 – 请在下方选择用于描述照片的模型（聊天模型由其他提供方运行）。",
        )
        .into());
    }
    let url = [s.base_url.trim(), profile.as_ref().map(|p| p.base_url.trim()).unwrap_or("")]
        .into_iter()
        .find(|u| !u.is_empty())
        .unwrap_or("http://localhost:11434")
        .trim_end_matches('/')
        .to_string();
    let model = [s.photo_model.trim(), s.model.trim(), profile.as_ref().map(|p| p.model.trim()).unwrap_or("")]
        .into_iter()
        .find(|m| !m.is_empty())
        .unwrap_or("")
        .to_string();
    if model.is_empty() {
        return Err(tr("Kein Modell eingestellt.", "No model set.", "未设置模型。").into());
    }
    Ok((url, model))
}

fn photo_env(app: &AppHandle, s: &Settings) -> Vec<EnvVar> {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let (url, model) = resolve_llm(app, s).unwrap_or_default();
    let db = photo_db_dir(app).map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    vec![
        EnvVar { name: "AAR_DESKTOP_PHOTO_DIRS".into(), value: s.photo_folders.join(sep) },
        EnvVar { name: "AAR_DESKTOP_PHOTO_DB".into(), value: db },
        EnvVar { name: "AAR_DESKTOP_OLLAMA_URL".into(), value: url },
        EnvVar { name: "AAR_DESKTOP_PHOTO_MODEL".into(), value: model },
    ]
}

/// The photo MCP server for aar (only when photo folders are set up).
pub fn mcp_server(app: &AppHandle, s: &Settings) -> Option<McpServer> {
    if s.photo_folders.is_empty() {
        return None;
    }
    let rt = crate::helpers::runtime(app, s).ok()?;
    let mut env: Vec<EnvVar> = rt.env().into_iter().map(|(name, value)| EnvVar { name, value }).collect();
    env.extend(photo_env(app, s));
    Some(McpServer {
        name: "photos".into(),
        command: rt.python.to_string_lossy().into_owned(),
        args: vec!["-m".into(), "aar_desktop.photos".into(), "serve".into()],
        env,
    })
}

fn helper(app: &AppHandle, s: &Settings, args: &[&str]) -> Result<Command, String> {
    let mut cmd = crate::helpers::runtime(app, s)?.command();
    cmd.args(["-m", "aar_desktop.photos"]).args(args);
    for e in photo_env(app, s) {
        cmd.env(e.name, e.value);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(cmd)
}

/// Index state for the settings page (`aar_desktop.photos status`).
pub fn status(app: &AppHandle, s: &Settings) -> Result<serde_json::Value, String> {
    let out = helper(app, s, &["status"])?.output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut v: serde_json::Value = text
        .lines()
        .rev()
        .find_map(|l| l.strip_prefix("@@JSON "))
        .and_then(|j| serde_json::from_str(j).ok())
        .ok_or_else(|| String::from_utf8_lossy(&out.stderr).trim().to_string())?;
    let llm = resolve_llm(app, s);
    v["model"] = llm.as_ref().map(|(_, m)| m.clone()).unwrap_or_default().into();
    v["modelProblem"] = llm.err().map(serde_json::Value::from).unwrap_or(serde_json::Value::Null);
    Ok(v)
}

/// Start indexing in the background (keeps running when aar restarts).
pub fn index_start(app: &AppHandle, s: &Settings) -> Result<(), String> {
    if s.photo_folders.is_empty() {
        return Err(tr("Bitte zuerst einen Fotoordner hinzufügen.", "Please add a photo folder first.", "请先添加照片文件夹。").into());
    }
    resolve_llm(app, s)?;
    let mut cmd = helper(app, s, &["index"])?;
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Delete the index entries (and thumbnails) outside the photo folders.
pub fn prune(app: &AppHandle, s: &Settings) -> Result<u32, String> {
    if !photo_db_dir(app).is_some_and(|d| d.join("index.sqlite").is_file()) {
        return Ok(0);
    }
    let out = helper(app, s, &["prune"])?.output().map_err(|e| e.to_string())?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .rev()
        .find_map(|l| l.strip_prefix("@@JSON "))
        .and_then(|j| serde_json::from_str::<serde_json::Value>(j).ok())
        .and_then(|v| v["removed"].as_u64())
        .map(|n| n as u32)
        .ok_or_else(|| String::from_utf8_lossy(&out.stderr).trim().to_string())
}

pub fn index_stop(app: &AppHandle) -> Result<(), String> {
    let dir = photo_db_dir(app).ok_or("no data dir")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("stop"), b"stop").map_err(|e| e.to_string())
}

/// Delete the whole index (descriptions and thumbnails).
pub fn clear(app: &AppHandle) -> Result<(), String> {
    let dir = photo_db_dir(app).ok_or("no data dir")?;
    let _ = index_stop(app);
    // The indexer needs a moment to notice the stop file and close index.sqlite;
    // until then Windows refuses to delete it. Retry for a few seconds.
    let started = std::time::Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(300));
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) if started.elapsed() > Duration::from_secs(8) => {
                return Err(trf!(
                    "Der Index konnte nicht ganz gelöscht werden (wird gerade benutzt?): {e}",
                    "The index could not be deleted completely (still in use?): {e}",
                    "无法完全删除索引（仍在使用中？）：{e}"
                ))
            }
            Err(_) => {}
        }
    }
}

/// FNV-1a 64 of the lower-cased path – the thumbnail name used by
/// `aar_desktop.photos.path_key`.
pub fn path_key(path: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in path.to_lowercase().bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Thumbnail of an indexed photo as a data: URL (only from the index's own
/// thumbnail folder, never the photo itself).
pub fn thumb(app: &AppHandle, path: &str) -> Option<String> {
    let file = photo_db_dir(app)?.join("thumbs").join(format!("{}.jpg", path_key(path)));
    let bytes = std::fs::read(file).ok()?;
    Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Vision-capable models of the Ollama server (for the model picker).
#[derive(Serialize)]
pub struct VisionModels {
    pub models: Vec<String>,
    pub error: Option<String>,
}

pub fn vision_models(url: &str) -> VisionModels {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(10)).build();
    let tags: Result<serde_json::Value, String> = agent
        .get(&format!("{url}/api/tags"))
        .call()
        .map_err(|e| e.to_string())
        .and_then(|r| r.into_json().map_err(|e| e.to_string()));
    let tags = match tags {
        Ok(t) => t,
        Err(e) => return VisionModels { models: vec![], error: Some(e) },
    };
    let names: Vec<String> = tags["models"]
        .as_array()
        .map(|a| a.iter().filter_map(|m| m["name"].as_str().map(String::from)).collect())
        .unwrap_or_default();
    let models = names
        .into_iter()
        .filter(|name| {
            agent
                .post(&format!("{url}/api/show"))
                .send_json(serde_json::json!({ "model": name }))
                .ok()
                .and_then(|r| r.into_json::<serde_json::Value>().ok())
                .and_then(|v| v["capabilities"].as_array().map(|c| c.iter().any(|x| x == "vision")))
                .unwrap_or(false)
        })
        .collect();
    VisionModels { models, error: None }
}

pub fn valid_folder(p: &str) -> bool {
    let path = Path::new(p.trim());
    path.is_absolute() && path.is_dir()
}

#[cfg(test)]
mod tests {
    use super::path_key;

    #[test]
    fn thumbnail_key_matches_python() {
        // Values computed with aar_desktop.photos.path_key (Python).
        assert_eq!(path_key(""), "cbf29ce484222325");
        assert_eq!(path_key("a"), "af63dc4c8601ec8c");
        assert_eq!(path_key("/tmp/ph/fotos/esszimmer.jpg"), "080178268d40799b");
        assert_eq!(path_key("C:\\Users\\Max\\Bilder\\Größe Ä.JPG"), "e355232bc9d40881");
        assert_eq!(path_key("C:\\Fotos\\A.JPG"), path_key("c:\\fotos\\a.jpg"));
    }
}
