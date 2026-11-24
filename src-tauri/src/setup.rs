//! First-run setup for end users: detect hardware, install/start Ollama and
//! download a language model. Progress is reported as `setup://progress`
//! events; all functions here are blocking and run on a worker thread.

use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::i18n::tr;
/// Progress sink: the GUI forwards to the webview, the CLI prints.
pub type Reporter<'a> = &'a dyn Fn(Progress);

pub const OLLAMA_URL: &str = "http://127.0.0.1:11434";
const OLLAMA_SETUP_URL: &str = "https://ollama.com/download/OllamaSetup.exe";

static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

fn check_cancel() -> Result<(), String> {
    if CANCEL.load(Ordering::SeqCst) {
        // The webview recognises all three variants (src/setup.ts CANCELLED).
        Err(tr("Abgebrochen", "Cancelled", "已取消").into())
    } else {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    /// nvidia | amd | intel | other
    pub vendor: String,
    /// Dedicated video memory in MiB.
    pub vram_mb: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub ram_mb: u64,
    pub cpu_threads: usize,
    pub gpus: Vec<Gpu>,
}

pub fn system_info() -> SystemInfo {
    SystemInfo {
        ram_mb: total_ram_mb(),
        cpu_threads: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        gpus: gpus(),
    }
}

fn vendor_name(id: u32) -> &'static str {
    match id {
        0x10DE => "nvidia",
        0x1002 | 0x1022 => "amd",
        0x8086 => "intel",
        _ => "other",
    }
}

#[cfg(windows)]
fn total_ram_mb() -> u64 {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    match unsafe { GlobalMemoryStatusEx(&mut status) } {
        Ok(()) => status.ullTotalPhys / 1024 / 1024,
        Err(_) => 0,
    }
}

#[cfg(not(windows))]
fn total_ram_mb() -> u64 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("MemTotal:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|kb| kb.parse::<u64>().ok())
        })
        .map(|kb| kb / 1024)
        .unwrap_or(0)
}

/// GPUs via DXGI (Win32_VideoController caps AdapterRAM at 4 GB, DXGI does not).
#[cfg(windows)]
fn gpus() -> Vec<Gpu> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
    let mut out: Vec<Gpu> = Vec::new();
    unsafe {
        let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else { return out };
        let mut i = 0;
        while let Ok(adapter) = factory.EnumAdapters1(i) {
            i += 1;
            let Ok(desc) = adapter.GetDesc1() else { continue };
            if desc.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 {
                continue;
            }
            let len = desc.Description.iter().position(|&c| c == 0).unwrap_or(desc.Description.len());
            let name = String::from_utf16_lossy(&desc.Description[..len]).trim().to_string();
            if out.iter().any(|g| g.name == name) {
                continue; // the same adapter can be listed once per output
            }
            out.push(Gpu {
                name,
                vendor: vendor_name(desc.VendorId).into(),
                vram_mb: (desc.DedicatedVideoMemory as u64) / 1024 / 1024,
            });
        }
    }
    out
}

#[cfg(not(windows))]
fn gpus() -> Vec<Gpu> {
    let _ = vendor_name;
    Vec::new()
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub installed: bool,
    pub exe: Option<String>,
    pub running: bool,
    pub version: Option<String>,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// download | install | start | pull
    pub phase: &'static str,
    pub message: String,
    pub done: u64,
    pub total: u64,
}

fn emit(report: Reporter, phase: &'static str, message: impl Into<String>, done: u64, total: u64) {
    report(Progress { phase, message: message.into(), done, total });
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(120))
        .build()
}

fn ollama_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Programs").join("Ollama"))
}

fn ollama_exe() -> Option<PathBuf> {
    ollama_dir()
        .map(|d| d.join(if cfg!(windows) { "ollama.exe" } else { "ollama" }))
        .filter(|p| p.is_file())
        .or_else(|| crate::agent_process::resolve_program("ollama").ok())
}

fn ollama_version(timeout: Duration) -> Option<String> {
    let agent = ureq::AgentBuilder::new().timeout(timeout).build();
    let v: Value = agent.get(&format!("{OLLAMA_URL}/api/version")).call().ok()?.into_json().ok()?;
    v.get("version").and_then(Value::as_str).map(String::from)
}

fn ollama_models() -> Vec<String> {
    agent()
        .get(&format!("{OLLAMA_URL}/api/tags"))
        .call()
        .ok()
        .and_then(|r| r.into_json::<Value>().ok())
        .and_then(|v| {
            v.get("models").and_then(Value::as_array).map(|ms| {
                ms.iter().filter_map(|m| m.get("name").and_then(Value::as_str).map(String::from)).collect()
            })
        })
        .unwrap_or_default()
}

pub fn ollama_status() -> OllamaStatus {
    let exe = ollama_exe();
    let version = ollama_version(Duration::from_secs(2));
    let running = version.is_some();
    OllamaStatus {
        installed: exe.is_some() || running,
        exe: exe.map(|p| p.to_string_lossy().into_owned()),
        running,
        version,
        models: if running { ollama_models() } else { vec![] },
    }
}

fn spawn_hidden(program: &PathBuf, args: &[&str]) -> std::io::Result<()> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    cmd.spawn().map(|_| ())
}

/// Make sure the Ollama server answers; start it if needed.
pub fn ollama_start(report: Reporter) -> Result<OllamaStatus, String> {
    CANCEL.store(false, Ordering::SeqCst);
    if ollama_version(Duration::from_secs(2)).is_some() {
        return Ok(ollama_status());
    }
    emit(report, "start", tr("Starte Ollama …", "Starting Ollama …", "正在启动 Ollama …"), 0, 0);
    // Prefer the tray app (keeps running, autostarts with Windows); else the bare server.
    // `--hide`: only the tray icon, without opening Ollama's chat window.
    let tray = ollama_dir().map(|d| d.join("ollama app.exe")).filter(|p| p.is_file());
    match (tray, ollama_exe()) {
        (Some(t), _) => spawn_hidden(&t, &["--hide"]),
        (None, Some(exe)) => spawn_hidden(&exe, &["serve"]),
        (None, None) => {
            return Err(tr("Ollama ist nicht installiert", "Ollama is not installed", "尚未安装 Ollama").into())
        }
    }
    .map_err(|e| {
        trf!(
            "Ollama konnte nicht gestartet werden: {e}",
            "Ollama could not be started: {e}",
            "无法启动 Ollama：{e}"
        )
    })?;

    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(60) {
        check_cancel()?;
        if ollama_version(Duration::from_secs(2)).is_some() {
            return Ok(ollama_status());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err(tr(
        "Ollama wurde gestartet, antwortet aber nicht (Port 11434)",
        "Ollama was started but does not respond (port 11434)",
        "Ollama 已启动，但没有响应（端口 11434）",
    )
    .into())
}

fn downloading_ollama() -> &'static str {
    tr("Lade Ollama herunter …", "Downloading Ollama …", "正在下载 Ollama …")
}

/// Download the official installer and install Ollama silently for the current user.
pub fn ollama_install(report: Reporter) -> Result<OllamaStatus, String> {
    CANCEL.store(false, Ordering::SeqCst);
    let target = std::env::temp_dir().join("OllamaSetup.exe");
    emit(report, "download", downloading_ollama(), 0, 0);
    let resp = agent()
        .get(OLLAMA_SETUP_URL)
        .call()
        .map_err(|e| trf!("Download fehlgeschlagen: {e}", "Download failed: {e}", "下载失败：{e}"))?;
    let total: u64 = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(&target).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut done = 0u64;
    let mut last = Instant::now();
    loop {
        check_cancel()?;
        let n = reader
            .read(&mut buf)
            .map_err(|e| trf!("Download abgebrochen: {e}", "Download interrupted: {e}", "下载中断：{e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if last.elapsed() > Duration::from_millis(200) {
            emit(report, "download", downloading_ollama(), done, total);
            last = Instant::now();
        }
    }
    drop(file);
    if total > 0 && done < total {
        return Err(tr("Download unvollständig", "Download incomplete", "下载不完整").into());
    }

    emit(report, "install", tr("Installiere Ollama …", "Installing Ollama …", "正在安装 Ollama …"), 0, 0);
    // Ollama's installer is Inno Setup: per-user install, no admin rights needed.
    let status = std::process::Command::new(&target)
        .args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"])
        .status()
        .map_err(|e| {
            trf!(
                "Installer konnte nicht gestartet werden: {e}",
                "The installer could not be started: {e}",
                "无法启动安装程序：{e}"
            )
        })?;
    let _ = std::fs::remove_file(&target);
    if !status.success() {
        let code = status.code();
        return Err(trf!(
            "Installation fehlgeschlagen (Code {code:?})",
            "Installation failed (code {code:?})",
            "安装失败（代码 {code:?}）"
        ));
    }
    ollama_start(report)
}

/// Download a model (`ollama pull`) with progress.
pub fn ollama_pull(report: Reporter, model: &str) -> Result<(), String> {
    CANCEL.store(false, Ordering::SeqCst);
    emit(report, "pull", trf!("Lade {model} …", "Downloading {model} …", "正在下载 {model} …"), 0, 0);
    let resp = agent()
        .post(&format!("{OLLAMA_URL}/api/pull"))
        .send_json(serde_json::json!({ "model": model, "stream": true }))
        .map_err(|e| {
            trf!(
                "Download von {model} fehlgeschlagen: {e}",
                "Download of {model} failed: {e}",
                "{model} 下载失败：{e}"
            )
        })?;
    let mut last = Instant::now();
    for line in BufReader::new(resp.into_reader()).lines() {
        check_cancel()?;
        let line = line.map_err(|e| trf!("Verbindung unterbrochen: {e}", "Connection lost: {e}", "连接中断：{e}"))?;
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(err) = v.get("error").and_then(Value::as_str) {
            return Err(format!("Ollama: {err}"));
        }
        let status = v.get("status").and_then(Value::as_str).unwrap_or_default();
        if status == "success" {
            emit(report, "pull", tr("Fertig", "Done", "完成"), 1, 1);
            return Ok(());
        }
        let done = v.get("completed").and_then(Value::as_u64).unwrap_or(0);
        let total = v.get("total").and_then(Value::as_u64).unwrap_or(0);
        if last.elapsed() > Duration::from_millis(200) || total == 0 {
            emit(report, "pull", pull_message(status), done, total);
            last = Instant::now();
        }
    }
    Err(trf!(
        "Download von {model} wurde unerwartet beendet",
        "Download of {model} ended unexpectedly",
        "{model} 下载意外中止"
    ))
}

/// Translate Ollama's pull status lines for end users.
fn pull_message(status: &str) -> String {
    if status.starts_with("pulling manifest") {
        tr("Hole Modellbeschreibung …", "Fetching model details …", "正在获取模型信息 …").into()
    } else if status.starts_with("pulling") || status.starts_with("downloading") {
        tr("Lade Modell herunter …", "Downloading model …", "正在下载模型 …").into()
    } else if status.starts_with("verifying") {
        tr("Prüfe Download …", "Checking download …", "正在校验下载 …").into()
    } else if status.starts_with("writing") {
        tr("Speichere Modell …", "Saving model …", "正在保存模型 …").into()
    } else {
        status.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vendors() {
        assert_eq!(vendor_name(0x10DE), "nvidia");
        assert_eq!(vendor_name(0x1002), "amd");
        assert_eq!(vendor_name(0x8086), "intel");
        assert_eq!(vendor_name(0x1234), "other");
    }

    #[test]
    fn pull_messages() {
        // The UI language is a process-wide setting that other tests switch in
        // parallel, so accept any of the three translations.
        let any = |got: String, de: &str, en: &str, zh: &str| assert!([de, en, zh].contains(&got.as_str()), "{got}");
        any(pull_message("pulling manifest"), "Hole Modellbeschreibung …", "Fetching model details …", "正在获取模型信息 …");
        any(pull_message("pulling 8eeb52dfb3bb"), "Lade Modell herunter …", "Downloading model …", "正在下载模型 …");
        any(pull_message("verifying sha256 digest"), "Prüfe Download …", "Checking download …", "正在校验下载 …");
        assert_eq!(pull_message("something else"), "something else");
    }

    #[test]
    fn system_info_has_ram() {
        let info = system_info();
        assert!(info.ram_mb > 0);
        assert!(info.cpu_threads >= 1);
    }
}
