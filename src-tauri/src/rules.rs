//! Rules (system prompt text) Aar Desktop hands to aar: who Aar is for an
//! office user, how it works with the permission cards, the user's real
//! folders. aar (>= develop_mcp 7851789) reads the files in `AAR_EXTRA_RULES`;
//! `AAR_NO_GLOBAL_RULES` leaves out ~/.aar/rules.md (a coding-agent template
//! from `aar init`). Own additions: %APPDATA%\de.aar.ui\rules.md
//! (Linux: ~/.config/de.aar.ui/rules.md).

use crate::i18n::Lang;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const TEMPLATE_WINDOWS: &str = include_str!("../rules/desktop.md");
/// Linux: no desktop control (yet), bash instead of PowerShell.
const TEMPLATE_LINUX: &str = include_str!("../rules/desktop-linux.md");
const TEMPLATE: &str = if cfg!(windows) { TEMPLATE_WINDOWS } else { TEMPLATE_LINUX };

#[derive(Debug, Clone, PartialEq)]
pub struct Folders {
    pub desktop: PathBuf,
    pub documents: PathBuf,
    pub downloads: PathBuf,
    pub pictures: PathBuf,
    pub home: PathBuf,
}

/// The user's folders as the system resolves them (Windows: Desktop may live
/// in OneDrive; Linux: localised XDG user dirs like `~/Schreibtisch`).
pub fn known_folders() -> Folders {
    let home = home_dir();
    let fallback = |name: &str| home.join(name);
    #[cfg(windows)]
    {
        use windows::Win32::UI::Shell::{
            FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads, FOLDERID_Pictures,
        };
        Folders {
            desktop: known(&FOLDERID_Desktop).unwrap_or_else(|| fallback("Desktop")),
            documents: known(&FOLDERID_Documents).unwrap_or_else(|| fallback("Documents")),
            downloads: known(&FOLDERID_Downloads).unwrap_or_else(|| fallback("Downloads")),
            pictures: known(&FOLDERID_Pictures).unwrap_or_else(|| fallback("Pictures")),
            home: home.clone(),
        }
    }
    #[cfg(not(windows))]
    {
        let config = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| home.join(".config"));
        let dirs = std::fs::read_to_string(config.join("user-dirs.dirs")).unwrap_or_default();
        let get = |key: &str, name: &str| xdg_user_dir(&dirs, key, &home).unwrap_or_else(|| fallback(name));
        Folders {
            desktop: get("XDG_DESKTOP_DIR", "Desktop"),
            documents: get("XDG_DOCUMENTS_DIR", "Documents"),
            downloads: get("XDG_DOWNLOAD_DIR", "Downloads"),
            pictures: get("XDG_PICTURES_DIR", "Pictures"),
            home: home.clone(),
        }
    }
}

/// One entry of `~/.config/user-dirs.dirs` (`XDG_DESKTOP_DIR="$HOME/Schreibtisch"`).
#[cfg_attr(windows, allow(dead_code))]
fn xdg_user_dir(text: &str, key: &str, home: &Path) -> Option<PathBuf> {
    let line = text.lines().map(str::trim).find(|l| l.starts_with(key) && l[key.len()..].starts_with('='))?;
    let value = line[key.len() + 1..].trim().trim_matches('"');
    let path = match value.strip_prefix("$HOME") {
        Some(rest) => home.join(rest.trim_start_matches('/')),
        None => PathBuf::from(value),
    };
    // "$HOME/" alone means the folder is switched off.
    (path.is_absolute() && path != home).then_some(path)
}

#[cfg(windows)]
fn known(id: &windows::core::GUID) -> Option<PathBuf> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const _));
        s.filter(|s| !s.is_empty()).map(PathBuf::from)
    }
}

fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn language_name(lang: Lang) -> &'static str {
    match lang {
        Lang::De => "German",
        Lang::En => "English",
        Lang::Zh => "Simplified Chinese",
    }
}

/// The desktop rules with the user's folders and UI language filled in.
pub fn render(folders: &Folders, lang: Lang) -> String {
    render_template(TEMPLATE, folders, lang)
}

fn render_template(template: &str, folders: &Folders, lang: Lang) -> String {
    let path = |p: &Path| p.to_string_lossy().into_owned();
    template
        .replace("{language}", language_name(lang))
        .replace("{desktop}", &path(&folders.desktop))
        .replace("{documents}", &path(&folders.documents))
        .replace("{downloads}", &path(&folders.downloads))
        .replace("{pictures}", &path(&folders.pictures))
        .replace("{home}", &path(&folders.home))
}

/// Write the rules for this start and return the environment for aar.
pub fn agent_env(app: &AppHandle) -> Vec<(&'static str, String)> {
    let mut files: Vec<PathBuf> = vec![];
    if let Ok(dir) = app.path().app_local_data_dir() {
        let file = dir.join("rules").join("desktop.md");
        let text = render(&known_folders(), crate::i18n::lang());
        let written = std::fs::create_dir_all(file.parent().unwrap()).and_then(|_| std::fs::write(&file, text));
        match written {
            Ok(()) => files.push(file),
            Err(e) => eprintln!("desktop rules not written: {e}"),
        }
    }
    if let Ok(dir) = app.path().app_config_dir() {
        let own = dir.join("rules.md");
        if own.is_file() {
            files.push(own);
        }
    }
    let joined = std::env::join_paths(&files).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    vec![("AAR_EXTRA_RULES", joined), ("AAR_NO_GLOBAL_RULES", "1".into())]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folders() -> Folders {
        Folders {
            desktop: PathBuf::from(r"C:\Users\Ana\OneDrive\Desktop"),
            documents: PathBuf::from(r"C:\Users\Ana\OneDrive\Dokumente"),
            downloads: PathBuf::from(r"C:\Users\Ana\Downloads"),
            pictures: PathBuf::from(r"C:\Users\Ana\OneDrive\Bilder"),
            home: PathBuf::from(r"C:\Users\Ana"),
        }
    }

    #[test]
    fn fills_in_folders_and_language() {
        let text = render_template(TEMPLATE_WINDOWS, &folders(), Lang::De);
        assert!(text.contains(r"Desktop: C:\Users\Ana\OneDrive\Desktop"));
        assert!(text.contains(r"e.g. C:\Users\Ana\OneDrive\Desktop\Einladung.txt"));
        assert!(text.contains(r"Downloads: C:\Users\Ana\Downloads"));
        assert!(text.contains("The app is set to German"));
        assert!(render_template(TEMPLATE_WINDOWS, &folders(), Lang::Zh).contains("Simplified Chinese"));
        assert!(!text.contains('{'), "placeholder left: {text}");
    }

    #[test]
    fn linux_rules_use_slashes_and_bash() {
        let f = Folders {
            desktop: PathBuf::from("/home/ana/Schreibtisch"),
            documents: PathBuf::from("/home/ana/Dokumente"),
            downloads: PathBuf::from("/home/ana/Downloads"),
            pictures: PathBuf::from("/home/ana/Bilder"),
            home: PathBuf::from("/home/ana"),
        };
        let text = render_template(TEMPLATE_LINUX, &f, Lang::En);
        assert!(text.contains("e.g. /home/ana/Schreibtisch/Einladung.txt"));
        assert!(text.contains("use bash"));
        assert!(!text.contains("PowerShell") && !text.contains("Windows"));
        assert!(!text.contains('{'), "placeholder left: {text}");
    }

    #[test]
    fn reads_xdg_user_dirs() {
        let home = Path::new("/home/ana");
        let text = "# comment\nXDG_DESKTOP_DIR=\"$HOME/Schreibtisch\"\nXDG_DOWNLOAD_DIR=\"/data/dl\"\nXDG_PUBLICSHARE_DIR=\"$HOME/\"\n";
        assert_eq!(xdg_user_dir(text, "XDG_DESKTOP_DIR", home), Some(PathBuf::from("/home/ana/Schreibtisch")));
        assert_eq!(xdg_user_dir(text, "XDG_DOWNLOAD_DIR", home), Some(PathBuf::from("/data/dl")));
        assert_eq!(xdg_user_dir(text, "XDG_PUBLICSHARE_DIR", home), None);
        assert_eq!(xdg_user_dir(text, "XDG_DESKTOP", home), None);
    }

    #[test]
    fn templates_are_for_the_desktop_not_for_coding() {
        for t in [TEMPLATE_WINDOWS, TEMPLATE_LINUX] {
            assert!(t.contains("You are Aar"));
            assert!(t.contains("permission card"));
            assert!(!t.to_lowercase().contains("coding"));
        }
    }
}
