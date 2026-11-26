//! "Beim Anmelden starten".
//!
//! Windows: a value in the current user's Run key, always HKCU
//! (`Software\Microsoft\Windows\CurrentVersion\Run`, value `Aar`): the app is
//! installed per user, and the uninstaller removes exactly this value. (`auto-launch`, used by the Tauri autostart plugin, writes to HKLM -
//! all users - whenever the process has admin rights.)
//!
//! Linux: `~/.config/autostart/aar-desktop.desktop` (XDG autostart; KDE, GNOME,
//! Xfce, …). For an AppImage it names the AppImage file, not its mount point.

use std::path::Path;

/// The Run value's data: the quoted exe path (without the `\\?\` prefix).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn command_line(exe: &Path) -> String {
    let s = exe.to_string_lossy();
    format!("\"{}\"", s.strip_prefix(r"\\?\").unwrap_or(&s))
}

/// Register (or remove) the widget in the Run key; rewrites the value on every
/// start so it follows the exe after a reinstall elsewhere.
pub fn apply(enabled: bool) -> Result<(), String> {
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        // AppImage: current_exe is inside the temporary mount.
        let exe = std::env::var_os("APPIMAGE").map(std::path::PathBuf::from).unwrap_or(exe);
        imp::set(Some(&exe))
    } else {
        imp::set(None)
    }
}

/// `Exec=` value of a desktop entry: the quoted program path (spec: `"`, `` ` ``,
/// `$` and `\` escaped with a backslash; `%` doubled).
#[cfg_attr(windows, allow(dead_code))]
pub fn desktop_exec(exe: &Path) -> String {
    let mut out = String::from("\"");
    for c in exe.to_string_lossy().chars() {
        match c {
            '"' | '`' | '$' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            '%' => out.push_str("%%"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The autostart desktop entry.
#[cfg_attr(windows, allow(dead_code))]
pub fn desktop_entry(exe: &Path) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName=Aar\nComment=Aar desktop assistant\nExec={}\nIcon=aar-desktop\n\
         Terminal=false\nX-GNOME-Autostart-enabled=true\nX-KDE-autostart-after=panel\n",
        desktop_exec(exe)
    )
}

#[cfg(windows)]
mod imp {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows::Win32::System::Registry::{
        RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ,
    };

    const RUN: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Run");
    const NAME: PCWSTR = w!("Aar");

    pub fn set(exe: Option<&std::path::Path>) -> Result<(), String> {
        let command = exe.map(super::command_line);
        let command = command.as_deref();
        // SAFETY: plain registry calls with NUL-terminated UTF-16 buffers that
        // outlive the call.
        unsafe {
            match command {
                Some(cmd) => {
                    let data: Vec<u16> = cmd.encode_utf16().chain(Some(0)).collect();
                    RegSetKeyValueW(
                        HKEY_CURRENT_USER,
                        RUN,
                        NAME,
                        REG_SZ.0,
                        Some(data.as_ptr().cast()),
                        (data.len() * 2) as u32,
                    )
                    .ok()
                    .map_err(|e| e.message())
                }
                None => {
                    let r = RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN, NAME);
                    if r.is_ok() || r == ERROR_FILE_NOT_FOUND {
                        Ok(())
                    } else {
                        r.ok().map_err(|e| e.message())
                    }
                }
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::path::{Path, PathBuf};

    fn entry_file() -> Option<PathBuf> {
        let config = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
        Some(config.join("autostart").join("aar-desktop.desktop"))
    }

    pub fn set(exe: Option<&Path>) -> Result<(), String> {
        let file = entry_file().ok_or("no home folder")?;
        match exe {
            Some(exe) => {
                let text = super::desktop_entry(exe);
                if std::fs::read_to_string(&file).ok().as_deref() == Some(text.as_str()) {
                    return Ok(());
                }
                std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
                std::fs::write(&file, text).map_err(|e| e.to_string())
            }
            None => match std::fs::remove_file(&file) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
                _ => Ok(()),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_line_is_quoted_without_verbatim_prefix() {
        assert_eq!(
            command_line(Path::new(r"\\?\C:\Users\A B\AppData\Local\Aar\aar-desktop.exe")),
            r#""C:\Users\A B\AppData\Local\Aar\aar-desktop.exe""#
        );
        assert_eq!(command_line(Path::new(r"C:\Aar\aar-desktop.exe")), r#""C:\Aar\aar-desktop.exe""#);
    }

    #[test]
    fn desktop_entry_quotes_the_program() {
        assert_eq!(desktop_exec(Path::new("/home/a b/Aar.AppImage")), r#""/home/a b/Aar.AppImage""#);
        assert_eq!(desktop_exec(Path::new(r#"/x/$a"%"#)), r#""/x/\$a\"%%""#);
        let e = desktop_entry(Path::new("/opt/aar/bin/aar-desktop"));
        assert!(e.starts_with("[Desktop Entry]\n"));
        assert!(e.contains("\nExec=\"/opt/aar/bin/aar-desktop\"\nIcon=aar-desktop\nTerminal=false\n"));
    }
}
