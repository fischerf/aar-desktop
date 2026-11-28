//! Log file for troubleshooting: everything aar writes to stderr (warnings,
//! provider errors, tracebacks) plus when the widget started or lost it.
//! `%LOCALAPPDATA%\de.aar.ui\logs\aar.log`; one older copy is kept as `aar.log.1`.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Rotate when the log grows beyond this (at start-up and while writing: a
/// widget that runs for weeks must not grow the file without limit).
const MAX_BYTES: u64 = 2 * 1024 * 1024;

struct Open {
    file: File,
    path: PathBuf,
    /// Size of the file as far as we know (start size + what we wrote).
    size: u64,
}

#[derive(Default)]
pub struct AgentLog {
    file: Mutex<Option<Open>>,
}

pub fn log_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_log_dir().ok().map(|d| d.join("aar.log"))
}

/// Move a too big log to `aar.log.1` (replacing the older copy) and open a fresh one.
fn open_rotated(path: &Path) -> Option<Open> {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let size = if size > MAX_BYTES {
        let old = path.with_extension("log.1");
        let _ = std::fs::remove_file(&old);
        if std::fs::rename(path, &old).is_ok() { 0 } else { size }
    } else {
        size
    };
    let file = OpenOptions::new().create(true).append(true).open(path).ok()?;
    Some(Open { file, path: path.to_path_buf(), size })
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
        *guard = open_rotated(path);
    }

    /// Append one line with a local timestamp. Never fails the caller.
    pub fn line(&self, text: &str) {
        let mut guard = self.file.lock().unwrap();
        let Some(open) = guard.as_mut() else { return };
        let line = format!("{} {}\n", timestamp(), text.trim_end());
        if open.file.write_all(line.as_bytes()).is_ok() {
            open.size += line.len() as u64;
        }
        let _ = open.file.flush();
        if open.size > MAX_BYTES {
            // Windows cannot rename an open file: close it first.
            let path = open.path.clone();
            *guard = None;
            *guard = open_rotated(&path);
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
    let (y, mo, d) = civil_date((secs / 86400) as i64);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{m:02}:{s:02} UTC")
}

/// Days since 1970-01-01 → (year, month, day) (Howard Hinnant's algorithm).
#[cfg_attr(windows, allow(dead_code))]
fn civil_date(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates() {
        assert_eq!(civil_date(0), (1970, 1, 1));
        assert_eq!(civil_date(19_782), (2024, 2, 29));
        assert_eq!(civil_date(20_783), (2026, 11, 26));
    }

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

        // And while it is open: a long-running widget rotates as well.
        let big = "y".repeat(64 * 1024);
        for _ in 0..40 {
            log.line(&big);
        }
        assert!(std::fs::metadata(&path).unwrap().len() < MAX_BYTES, "rotated while writing");
        assert!(std::fs::metadata(path.with_extension("log.1")).unwrap().len() > MAX_BYTES);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
