//! "Beim Anmelden an Windows starten": a value in the current user's Run key.
//!
//! Always HKCU (`Software\Microsoft\Windows\CurrentVersion\Run`, value `Aar`):
//! the app is installed per user, and the uninstaller removes exactly this
//! value. (`auto-launch`, used by the Tauri autostart plugin, writes to HKLM -
//! all users - whenever the process has admin rights.)

use std::path::Path;

/// The Run value's data: the quoted exe path (without the `\\?\` prefix).
pub fn command_line(exe: &Path) -> String {
    let s = exe.to_string_lossy();
    format!("\"{}\"", s.strip_prefix(r"\\?\").unwrap_or(&s))
}

/// Register (or remove) the widget in the Run key; rewrites the value on every
/// start so it follows the exe after a reinstall elsewhere.
pub fn apply(enabled: bool) -> Result<(), String> {
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        imp::set(Some(&command_line(&exe)))
    } else {
        imp::set(None)
    }
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

    pub fn set(command: Option<&str>) -> Result<(), String> {
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
    pub fn set(_command: Option<&str>) -> Result<(), String> {
        Ok(())
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
}
