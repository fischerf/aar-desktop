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
#[cfg(windows)]
const OLLAMA_SETUP_URL: &str = "https://ollama.com/download/OllamaSetup.exe";
/// Ollama for Linux (what ollama.com/install.sh unpacks to /usr/local; here
/// without root into ~/.local: `bin/ollama` + `lib/ollama`).
#[cfg(not(windows))]
const OLLAMA_LINUX_URL: &str = if cfg!(target_arch = "aarch64") {
    "https://ollama.com/download/ollama-linux-arm64.tar.zst"
} else {
    "https://ollama.com/download/ollama-linux-amd64.tar.zst"
};

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

/// Linux: NVIDIA cards from `nvidia-smi` (name + memory), the others from
/// `/sys/class/drm` (amdgpu reports its VRAM there).
#[cfg(not(windows))]
fn gpus() -> Vec<Gpu> {
    let mut out = crate::platform::command("nvidia-smi")
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| parse_nvidia_smi(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default();
    let have_nvidia = !out.is_empty();
    for g in drm_gpus(std::path::Path::new("/sys/class/drm")) {
        if !(have_nvidia && g.vendor == "nvidia") {
            out.push(g);
        }
    }
    out
}

/// `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` lines.
#[cfg_attr(windows, allow(dead_code))]
fn parse_nvidia_smi(text: &str) -> Vec<Gpu> {
    text.lines()
        .filter_map(|l| {
            let (name, mem) = l.rsplit_once(',')?;
            Some(Gpu { name: name.trim().into(), vendor: "nvidia".into(), vram_mb: mem.trim().parse().ok()? })
        })
        .collect()
}

/// Graphics cards under `/sys/class/drm/card<N>/device` (not the connectors
/// like `card0-HDMI-A-1`).
#[cfg_attr(windows, allow(dead_code))]
fn drm_gpus(root: &std::path::Path) -> Vec<Gpu> {
    let mut cards: Vec<(String, PathBuf)> = std::fs::read_dir(root)
        .map(|rd| {
            rd.flatten()
                .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path()))
                .filter(|(n, _)| n.strip_prefix("card").is_some_and(|r| !r.is_empty() && r.bytes().all(|b| b.is_ascii_digit())))
                .collect()
        })
        .unwrap_or_default();
    cards.sort();
    let mut out = vec![];
    for (_, card) in cards {
        let dev = card.join("device");
        let read = |f: &str| std::fs::read_to_string(dev.join(f)).ok().map(|s| s.trim().to_string());
        let Some(vendor) = read("vendor").and_then(|v| u32::from_str_radix(v.trim_start_matches("0x"), 16).ok()) else {
            continue;
        };
        let vendor = vendor_name(vendor);
        let vram_mb = read("mem_info_vram_total").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0) / 1024 / 1024;
        let name = match vendor {
            "nvidia" => "NVIDIA",
            "amd" => "AMD Radeon",
            "intel" => "Intel Graphics",
            _ => "GPU",
        };
        out.push(Gpu { name: name.into(), vendor: vendor.into(), vram_mb });
    }
    out
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

/// Where Ollama is installed for the current user (Windows: the official
/// installer's folder; Linux: the prefix `~/.local`).
fn ollama_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Programs").join("Ollama"))
    } else {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local"))
    }
}

fn ollama_exe() -> Option<PathBuf> {
    ollama_dir()
        .map(|d| if cfg!(windows) { d.join("ollama.exe") } else { d.join("bin").join("ollama") })
        .filter(|p| p.is_file())
        .or_else(|| crate::agent_process::resolve_program("ollama").ok())
        .or_else(|| Some(PathBuf::from("/usr/local/bin/ollama")).filter(|p| !cfg!(windows) && p.is_file()))
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

/// Make sure the Ollama server answers; start it if needed.
pub fn ollama_start(report: Reporter) -> Result<OllamaStatus, String> {
    CANCEL.store(false, Ordering::SeqCst);
    if ollama_version(Duration::from_secs(2)).is_some() {
        return Ok(ollama_status());
    }
    emit(report, "start", tr("Starte Ollama …", "Starting Ollama …", "正在启动 Ollama …"), 0, 0);
    // Windows: prefer the tray app (keeps running, autostarts with Windows); else the
    // bare server. `--hide`: only the tray icon, without opening Ollama's chat window.
    // Linux: `ollama serve` in its own session (keeps running when the widget quits).
    let tray = ollama_dir().map(|d| d.join("ollama app.exe")).filter(|p| cfg!(windows) && p.is_file());
    let log = std::env::temp_dir().join("aar-ollama-serve.log");
    let log = (!cfg!(windows)).then_some(log.as_path());
    match (tray, ollama_exe()) {
        (Some(t), _) => crate::platform::spawn_detached(&t, &["--hide"], None),
        (None, Some(exe)) => crate::platform::spawn_detached(&exe, &["serve"], log),
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

fn installing_ollama() -> &'static str {
    tr("Installiere Ollama …", "Installing Ollama …", "正在安装 Ollama …")
}

/// Download `url` to `target` with progress (phase "download").
fn download(report: Reporter, url: &str, target: &std::path::Path) -> Result<(), String> {
    emit(report, "download", downloading_ollama(), 0, 0);
    let resp = agent()
        .get(url)
        .call()
        .map_err(|e| trf!("Download fehlgeschlagen: {e}", "Download failed: {e}", "下载失败：{e}"))?;
    let total: u64 = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(target).map_err(|e| e.to_string())?;
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
    Ok(())
}

/// Download the official installer and install Ollama silently for the current user.
#[cfg(windows)]
pub fn ollama_install(report: Reporter) -> Result<OllamaStatus, String> {
    CANCEL.store(false, Ordering::SeqCst);
    let target = std::env::temp_dir().join("OllamaSetup.exe");
    download(report, OLLAMA_SETUP_URL, &target)?;
    emit(report, "install", installing_ollama(), 0, 0);
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

/// Download Ollama's Linux archive and unpack it into `~/.local` (no root,
/// no system service: the widget starts `ollama serve` itself).
#[cfg(not(windows))]
pub fn ollama_install(report: Reporter) -> Result<OllamaStatus, String> {
    CANCEL.store(false, Ordering::SeqCst);
    let prefix = ollama_dir().ok_or("no home folder")?;
    let target = std::env::temp_dir().join(format!("aar-ollama-{}.tar.zst", std::process::id()));
    let result = download(report, OLLAMA_LINUX_URL, &target).and_then(|()| {
        emit(report, "install", installing_ollama(), 0, 0);
        unpack_tar_zst(&target, &prefix)
    });
    let _ = std::fs::remove_file(&target);
    result.map_err(|e| trf!("Installation fehlgeschlagen: {e}", "Installation failed: {e}", "安装失败：{e}"))?;
    if !prefix.join("bin").join("ollama").is_file() {
        return Err(tr(
            "Installation fehlgeschlagen: ollama fehlt im Archiv",
            "Installation failed: ollama is missing in the archive",
            "安装失败：压缩包中没有 ollama",
        )
        .into());
    }
    ollama_start(report)
}

/// Unpack a `.tar.zst` archive below `dest` (entries must stay inside it).
#[cfg(not(windows))]
fn unpack_tar_zst(archive: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let decoder = ruzstd::decoding::StreamingDecoder::new(std::io::BufReader::new(file)).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut tar = tar::Archive::new(decoder);
    for entry in tar.entries().map_err(|e| e.to_string())? {
        check_cancel()?;
        let mut entry = entry.map_err(|e| e.to_string())?;
        // unpack_in refuses paths that would leave `dest`.
        entry.unpack_in(dest).map_err(|e| e.to_string())?;
    }
    Ok(())
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
    fn parses_nvidia_smi() {
        let g = parse_nvidia_smi("NVIDIA GeForce RTX 4090, 24564\nbroken\nNVIDIA A2, 15356\n");
        assert_eq!(g.len(), 2);
        assert_eq!((g[0].name.as_str(), g[0].vram_mb, g[0].vendor.as_str()), ("NVIDIA GeForce RTX 4090", 24564, "nvidia"));
    }

    #[test]
    fn reads_drm_cards() {
        let root = std::env::temp_dir().join(format!("aar-ui-drm-{}", std::process::id()));
        let card = |name: &str, vendor: &str, vram: Option<&str>| {
            let dev = root.join(name).join("device");
            std::fs::create_dir_all(&dev).unwrap();
            std::fs::write(dev.join("vendor"), format!("{vendor}\n")).unwrap();
            if let Some(v) = vram {
                std::fs::write(dev.join("mem_info_vram_total"), v).unwrap();
            }
        };
        card("card0", "0x8086", None);
        card("card1", "0x1002", Some("17163091968\n"));
        card("card1-DP-1", "0x1002", None);
        let g = drm_gpus(&root);
        assert_eq!(g.len(), 2, "{g:?}");
        assert_eq!((g[0].vendor.as_str(), g[0].vram_mb), ("intel", 0));
        assert_eq!((g[1].vendor.as_str(), g[1].vram_mb), ("amd", 16368));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn system_info_has_ram() {
        let info = system_info();
        assert!(info.ram_mb > 0);
        assert!(info.cpu_threads >= 1);
    }
}
