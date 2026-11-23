//! Log file for troubleshooting: everything aar writes to stderr (warnings,
//! provider errors, tracebacks) plus when the widget started or lost it.
//! `%LOCALAPPDATA%\de.aar.ui\logs\aar.log`; one older copy is kept as `aar.log.1`.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Rotate when the log grows beyond this at start-up.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Default)]
pub struct AgentLog {
    file: Mutex<Option<File>>,
}

pub fn log_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_log_dir().ok().map(|d| d.join("aar.log"))
}

impl AgentLog {
    /// Open (or keep) the log at `path`; rotates a file that grew too big.
    pub fn open(&self, path: &Path) {
        let mut guard = self.file.lock().unwrap();
        if guard.is_some() {
            return;
        }
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::metadata(path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
            let old = path.with_extension("log.1");
            let _ = std::fs::remove_file(&old);
            let _ = std::fs::rename(path, &old);
        }
        *guard = OpenOptions::new().create(true).append(true).open(path).ok();
    }

    /// Append one line with a local timestamp. Never fails the caller.
    pub fn line(&self, text: &str) {
        if let Some(f) = self.file.lock().unwrap().as_mut() {
            let _ = writeln!(f, "{} {}", timestamp(), text.trim_end());
            let _ = f.flush();
        }
    }
}

#[cfg(windows)]
fn timestamp() -> String {
    // SAFETY: GetLocalTime only fills the returned struct.
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond
    )
}

#[cfg(not(windows))]
fn timestamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (h, m, s) = (secs / 3600 % 24, secs / 60 % 60, secs % 60);
    format!("{}d {:02}:{:02}:{:02} UTC", secs / 86400, h, m, s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_lines_and_rotates_big_files() {
        let dir = std::env::temp_dir().join(format!("aar-ui-log-{}", std::process::id()));
        let path = dir.join("logs").join("aar.log");
        let log = AgentLog::default();
        log.open(&path);
        log.line("first\n");
        log.line("second");
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.lines().count() == 2 && text.contains(" first") && text.ends_with("second\n"));

        // A file over the limit is moved to aar.log.1 when the log is opened again.
        std::fs::write(&path, vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();
        let log = AgentLog::default();
        log.open(&path);
        log.line("fresh");
        assert!(std::fs::read_to_string(&path).unwrap().ends_with("fresh\n"));
        assert_eq!(std::fs::metadata(path.with_extension("log.1")).unwrap().len(), MAX_BYTES + 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
