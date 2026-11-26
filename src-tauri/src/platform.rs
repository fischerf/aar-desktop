//! Operating-system specifics shared by the modules: the process environment
//! on Linux, child processes and showing files in the file manager.
//!
//! Linux: the widget positions itself (bottom right), stays on top and grabs a
//! global hotkey – none of that is allowed for Wayland clients. So it runs
//! through XWayland (`GDK_BACKEND=x11`, opt out with `AAR_DESKTOP_WAYLAND=1`),
//! and with WebKitGTK's DMA-BUF renderer off (transparent windows otherwise
//! stay empty with some GPU drivers). Programs the widget starts (aar, the
//! helpers, xdg-open) get the user's original environment back, also without
//! the AppImage's library paths.

use std::path::Path;
use std::process::Command;
#[cfg(target_os = "linux")]
use std::sync::Mutex;

/// `std::env::consts::OS` ("windows", "linux", "macos").
pub fn os() -> &'static str {
    std::env::consts::OS
}

/// Variables this process changed for itself: (name, original value).
#[cfg(target_os = "linux")]
static CHANGED: Mutex<Vec<(&'static str, Option<std::ffi::OsString>)>> = Mutex::new(Vec::new());

/// Set up the process environment before the GUI toolkit starts.
pub fn prepare_env() {
    #[cfg(target_os = "linux")]
    {
        let mut changed = CHANGED.lock().unwrap();
        let mut set = |name: &'static str, value: &str| {
            changed.push((name, std::env::var_os(name)));
            std::env::set_var(name, value);
        };
        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
        let x11 = std::env::var_os("DISPLAY").is_some();
        let opt_out = std::env::var("AAR_DESKTOP_WAYLAND").is_ok_and(|v| v == "1");
        if wayland && x11 && !opt_out && std::env::var_os("GDK_BACKEND").is_none() {
            set("GDK_BACKEND", "x11");
        }
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            set("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}

/// A command for a program the widget starts: on Linux with the user's
/// environment (see the module docs), on Windows unchanged.
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "linux")]
    {
        for (name, original) in CHANGED.lock().unwrap().iter() {
            match original {
                Some(v) => cmd.env(name, v),
                None => cmd.env_remove(name),
            };
        }
        if let Some(appdir) = std::env::var_os("APPDIR").filter(|_| std::env::var_os("APPIMAGE").is_some()) {
            let vars: Vec<(String, String)> = std::env::vars().collect();
            for (name, change) in appimage_env_fixes(&vars, &appdir.to_string_lossy()) {
                match change {
                    Some(v) => cmd.env(name, v),
                    None => cmd.env_remove(name),
                };
            }
        }
    }
    cmd
}

/// Variables an AppImage's start script pointed into its own mount (library
/// paths, GTK/GIO modules, XDG_DATA_DIRS entries): `None` = remove, else the
/// value without those entries. Programs the widget starts must not load the
/// AppImage's libraries.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn appimage_env_fixes(vars: &[(String, String)], appdir: &str) -> Vec<(String, Option<String>)> {
    let appdir = appdir.trim_end_matches('/');
    if appdir.is_empty() {
        return vec![];
    }
    let inside = |p: &str| p == appdir || p.starts_with(&format!("{appdir}/"));
    let mut out = vec![];
    for (name, value) in vars {
        // Tauri's AppRun forces the X11 backend for GTK – not wanted for other programs.
        if name == "GDK_BACKEND" || name == "APPDIR" || name == "APPIMAGE" || name == "ARGV0" || name == "OWD" {
            if name == "GDK_BACKEND" {
                out.push((name.clone(), None));
            }
            continue;
        }
        if !value.contains(appdir) {
            continue;
        }
        let kept: Vec<&str> = value.split(':').filter(|p| !p.is_empty() && !inside(p)).collect();
        out.push((name.clone(), (!kept.is_empty()).then(|| kept.join(":"))));
    }
    out
}

/// `file://` URI for a path (percent-encoded, as file managers expect it).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn file_uri(path: &Path) -> String {
    let mut out = String::from("file://");
    for b in path.to_string_lossy().bytes() {
        if b.is_ascii_alphanumeric() || b"/-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Name of the file manager at the start of a sentence in messages.
pub fn file_manager_name() -> &'static str {
    if cfg!(windows) {
        crate::i18n::tr("Explorer", "Explorer", "资源管理器")
    } else {
        crate::i18n::tr("Der Dateimanager", "The file manager", "文件管理器")
    }
}

/// Open a file or folder with its default program, or (`reveal`) show it
/// selected in the file manager.
pub fn open(path: &Path, reveal: bool) -> Result<(), String> {
    let failed = |e: std::io::Error| {
        let name = file_manager_name();
        trf!("{name} konnte nicht starten: {e}", "{name} could not start: {e}", "无法启动{name}：{e}")
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = command("explorer");
        // explorer wants the whole `/select,"<path>"` as one raw argument (spaces in paths).
        let arg = if reveal { format!("/select,\"{}\"", path.display()) } else { format!("\"{}\"", path.display()) };
        cmd.raw_arg(arg);
        cmd.spawn().map(|_| ()).map_err(failed)
    }
    #[cfg(not(windows))]
    {
        use std::process::Stdio;
        let quiet = |mut c: Command| {
            c.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            c
        };
        if reveal {
            // Freedesktop file manager interface (Dolphin, Nautilus, Nemo, …).
            let mut c = quiet(command("dbus-send"));
            c.args([
                "--session",
                "--print-reply",
                "--dest=org.freedesktop.FileManager1",
                "--type=method_call",
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
            ])
            .arg(format!("array:string:{}", file_uri(path)))
            .arg("string:");
            if c.status().is_ok_and(|s| s.success()) {
                return Ok(());
            }
            // No such service: open the folder instead.
            let dir = if path.is_dir() { path } else { path.parent().unwrap_or(path) };
            let mut c = quiet(command("xdg-open"));
            return c.arg(dir).spawn().map(|_| ()).map_err(failed);
        }
        let mut c = quiet(command("xdg-open"));
        c.arg(path).spawn().map(|_| ()).map_err(failed)
    }
}

/// Start a program that keeps running on its own (e.g. `ollama serve`): no
/// window on Windows, its own session on Linux (not stopped with the widget).
pub fn spawn_detached(program: &Path, args: &[&str], log: Option<&Path>) -> std::io::Result<()> {
    use std::process::Stdio;
    let mut cmd = command(program);
    cmd.args(args).stdin(Stdio::null());
    match log.and_then(|p| std::fs::File::create(p).ok()) {
        Some(f) => {
            let f2 = f.try_clone()?;
            cmd.stdout(f).stderr(f2);
        }
        None => {
            cmd.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd.spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appimage_paths_are_removed_from_child_env() {
        let vars: Vec<(String, String)> = [
            ("LD_LIBRARY_PATH", "/tmp/.mount_Aar1/usr/lib:/opt/x/lib"),
            ("GIO_MODULE_DIR", "/tmp/.mount_Aar1/usr/lib/gio/modules"),
            ("XDG_DATA_DIRS", "/tmp/.mount_Aar1/usr/share:/usr/local/share:/usr/share"),
            ("HOME", "/home/u"),
            ("GDK_BACKEND", "x11"),
            ("APPDIR", "/tmp/.mount_Aar1"),
            ("OTHER", "/tmp/.mount_Aar10/x"),
        ]
        .iter()
        .map(|(a, b)| (a.to_string(), b.to_string()))
        .collect();
        let fixes = appimage_env_fixes(&vars, "/tmp/.mount_Aar1/");
        let get = |n: &str| fixes.iter().find(|(k, _)| k == n).map(|(_, v)| v.clone());
        assert_eq!(get("LD_LIBRARY_PATH"), Some(Some("/opt/x/lib".into())));
        assert_eq!(get("GIO_MODULE_DIR"), Some(None));
        assert_eq!(get("XDG_DATA_DIRS"), Some(Some("/usr/local/share:/usr/share".into())));
        assert_eq!(get("GDK_BACKEND"), Some(None));
        assert_eq!(get("HOME"), None);
        assert_eq!(get("APPDIR"), None, "kept: harmless, and xdg tools ignore it");
        // A different mount that merely starts with the same text stays.
        assert_eq!(get("OTHER"), Some(Some("/tmp/.mount_Aar10/x".into())));
        assert!(appimage_env_fixes(&vars, "").is_empty());
    }

    #[test]
    fn file_uris_are_percent_encoded() {
        assert_eq!(file_uri(Path::new("/home/u/Mein Ordner/ä.pdf")), "file:///home/u/Mein%20Ordner/%C3%A4.pdf");
    }
}
