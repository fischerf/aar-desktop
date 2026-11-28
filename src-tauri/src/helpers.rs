//! Which Python runs Aar Desktop's helpers (`python/aar_desktop`: extensions,
//! MCP servers, photo search) – always the one that runs aar:
//!
//! * bundled runtime (installed app, agent program empty): `python\python.exe`,
//!   helpers in `python\aar-tools` (on its `._pth`);
//! * otherwise the Python behind the agent program (e.g. `aar` from PATH:
//!   `…\Python312\Scripts\aar.exe` → `…\Python312\python.exe`). The helpers are
//!   compiled into this exe and written to `%LOCALAPPDATA%\de.aar.ui\helpers`,
//!   found through `PYTHONPATH`. So add-ons also work when the app runs without
//!   the bundled runtime (e.g. `dist\aar-desktop.exe`) and they land in the
//!   environment of the aar that actually uses them.

use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

use crate::agent_process::{bundled_helpers, bundled_python, resolve_agent};
use crate::i18n::tr;
use crate::settings::Settings;

const FILES: &[(&str, &str)] = &[
    ("__init__.py", include_str!("../../python/aar_desktop/__init__.py")),
    ("_site.py", include_str!("../../python/aar_desktop/_site.py")),
    ("boot.py", include_str!("../../python/aar_desktop/boot.py")),
    ("ext.py", include_str!("../../python/aar_desktop/ext.py")),
    ("mcp.py", include_str!("../../python/aar_desktop/mcp.py")),
    ("node.py", include_str!("../../python/aar_desktop/node.py")),
    ("photos.py", include_str!("../../python/aar_desktop/photos.py")),
];

/// A Python that can run `-m aar_desktop.*`.
#[derive(Debug, Clone)]
pub struct PyRuntime {
    pub python: PathBuf,
    /// Directory to put on `PYTHONPATH` (None for the bundled runtime).
    pub pythonpath: Option<PathBuf>,
    pub bundled: bool,
}

impl PyRuntime {
    /// Environment the helper processes need (PYTHONPATH for a normal Python).
    pub fn env(&self) -> Vec<(String, String)> {
        let mut env = vec![
            ("PYTHONUTF8".to_string(), "1".to_string()),
            ("PYTHONIOENCODING".to_string(), "utf-8".to_string()),
        ];
        if self.bundled {
            // Never pick up packages from a Python the user installed separately.
            env.push(("PYTHONNOUSERSITE".into(), "1".into()));
        } else {
            // Own Python: aar may be a `pip install --user`, so keep the user site;
            // but not the working folder in front of sys.path (`-m` puts it there),
            // where a stray `mcp.py` or `json.py` would shadow real modules.
            env.push(("PYTHONSAFEPATH".into(), "1".into()));
        }
        if let Some(p) = &self.pythonpath {
            env.push(("PYTHONPATH".into(), prepend_path(p, std::env::var_os("PYTHONPATH"))));
        }
        env
    }

    pub fn command(&self) -> Command {
        let mut cmd = crate::platform::command(&self.python);
        cmd.envs(self.env());
        cmd
    }
}

fn prepend_path(first: &Path, rest: Option<std::ffi::OsString>) -> String {
    let mut parts = vec![first.to_path_buf()];
    if let Some(r) = rest {
        parts.extend(std::env::split_paths(&r));
    }
    std::env::join_paths(parts).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Write the embedded helpers to `%LOCALAPPDATA%\de.aar.ui\helpers` (only when changed).
pub fn ensure_helpers(app: &AppHandle) -> Option<PathBuf> {
    let root = app.path().app_local_data_dir().ok()?.join("helpers");
    let pkg = root.join("aar_desktop");
    std::fs::create_dir_all(&pkg).ok()?;
    for (name, text) in FILES {
        let file = pkg.join(name);
        if std::fs::read_to_string(&file).ok().as_deref() != Some(*text) {
            std::fs::write(&file, text).ok()?;
        }
    }
    Some(root)
}

/// The Python interpreter next to a console script (`Scripts\aar.exe`) or the
/// program itself when it is a Python.
pub fn python_for_program(program: &Path) -> Option<PathBuf> {
    let name = program.file_stem()?.to_string_lossy().to_lowercase();
    if name.starts_with("python") {
        return Some(program.to_path_buf());
    }
    let dir = program.parent()?;
    let exe = if cfg!(windows) { "python.exe" } else { "python3" };
    // venv: Scripts\python.exe next to aar.exe; system install: Python312\python.exe above Scripts.
    [dir.join(exe), dir.parent().map(|p| p.join(exe)).unwrap_or_default()]
        .into_iter()
        .find(|p| p.is_file())
}

/// The Python of the aar that Aar Desktop starts (see the module docs).
pub fn runtime(app: &AppHandle, s: &Settings) -> Result<PyRuntime, String> {
    let auto = s.agent_command.trim().is_empty() || s.agent_command.trim().eq_ignore_ascii_case("auto");
    if auto {
        if let Ok(res) = app.path().resource_dir() {
            if let Some(py) = bundled_python(&res).filter(|_| bundled_helpers(&res)) {
                return Ok(PyRuntime { python: py, pythonpath: None, bundled: true });
            }
        }
    }
    let (program, _) = resolve_agent(app, &s.agent_command)?;
    let python = python_for_program(&program).ok_or_else(|| {
        trf!(
            "Zu „{}“ finde ich kein Python – Erweiterungen und Werkzeug-Server lassen sich so nicht verwalten.",
            "I can't find the Python behind “{}” – extensions and tool servers can't be managed like this.",
            "找不到“{}”所用的 Python – 无法这样管理扩展和工具服务器。",
            program.display()
        )
    })?;
    let helpers = ensure_helpers(app)
        .ok_or_else(|| tr("Hilfsprogramme konnten nicht angelegt werden.", "Could not set up the helpers.", "无法创建辅助程序。").to_string())?;
    Ok(PyRuntime { python, pythonpath: Some(helpers), bundled: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_python_next_to_console_scripts() {
        let base = std::env::temp_dir().join(format!("aar-ui-py-{}", std::process::id()));
        let exe = if cfg!(windows) { "python.exe" } else { "python3" };
        let aar = if cfg!(windows) { "aar.exe" } else { "aar" };
        // System install: <root>\python.exe + <root>\Scripts\aar.exe
        std::fs::create_dir_all(base.join("sys").join("Scripts")).unwrap();
        std::fs::write(base.join("sys").join(exe), "x").unwrap();
        assert_eq!(python_for_program(&base.join("sys").join("Scripts").join(aar)), Some(base.join("sys").join(exe)));
        // venv: Scripts\python.exe next to aar.exe wins.
        std::fs::create_dir_all(base.join("venv").join("Scripts")).unwrap();
        std::fs::write(base.join("venv").join("Scripts").join(exe), "x").unwrap();
        assert_eq!(
            python_for_program(&base.join("venv").join("Scripts").join(aar)),
            Some(base.join("venv").join("Scripts").join(exe))
        );
        // The program is a Python itself.
        assert_eq!(python_for_program(Path::new("C:/x/python3.13.exe")), Some(PathBuf::from("C:/x/python3.13.exe")));
        assert_eq!(python_for_program(&base.join("nothing").join(aar)), None);
        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn embedded_helpers_are_complete() {
        for (name, text) in FILES {
            assert!(!text.is_empty(), "{name}");
        }
        assert!(FILES.iter().any(|(n, t)| *n == "ext.py" && t.contains("def cmd_install")));
    }
}
