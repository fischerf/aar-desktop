#[macro_use]
mod i18n;
mod addons;
mod agent_log;
mod agent_process;
mod autostart;
mod helpers;
mod files;
mod llm_config;
mod photos;
mod settings;
mod setup;

use agent_process::AgentProcess;
use i18n::tr;
use settings::{Settings, UserMcpServer};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow,
    WindowEvent, Wry,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Logical window sizes. Collapsed = only the mascot, expanded = mascot + chat bubble.
const COLLAPSED: (f64, f64) = (150.0, 150.0);
const DEFAULT_EXPANDED: (f64, f64) = (400.0, 640.0);
/// Smallest size the user can shrink the expanded window to.
const MIN_EXPANDED: (f64, f64) = (320.0, 420.0);
const SCREEN_MARGIN: i32 = 12;

struct AppState {
    settings: Mutex<Settings>,
    /// Bottom-right corner of the main window in physical pixels.
    anchor: Mutex<Option<(i32, i32)>>,
    /// Hotkey currently registered (so it can be swapped on settings change).
    hotkey: Mutex<Option<Shortcut>>,
    /// Is the chat bubble open (window resizable, size remembered)?
    expanded: AtomicBool,
    /// Logical size of the expanded window, changed by the user via resizing.
    expanded_size: Mutex<(f64, f64)>,
    /// True while the app itself moves/resizes the window.
    adjusting: AtomicBool,
}

// ---------------------------------------------------------------------------
// Window placement
// ---------------------------------------------------------------------------

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Default anchor: bottom-right of the primary monitor's work area (above the taskbar).
fn default_anchor(win: &WebviewWindow) -> Option<(i32, i32)> {
    let monitor = win.primary_monitor().ok().flatten().or_else(|| win.current_monitor().ok().flatten())?;
    let area = monitor.work_area();
    Some((
        area.position.x + area.size.width as i32 - SCREEN_MARGIN,
        area.position.y + area.size.height as i32 - SCREEN_MARGIN,
    ))
}

/// Is the anchor still on a connected monitor? (Monitors may have been unplugged.)
fn anchor_visible(win: &WebviewWindow, (x, y): (i32, i32)) -> bool {
    win.available_monitors()
        .map(|ms| {
            ms.iter().any(|m| {
                let p = m.position();
                let s = m.size();
                x > p.x + 60 && y > p.y + 60 && x <= p.x + s.width as i32 && y <= p.y + s.height as i32
            })
        })
        .unwrap_or(false)
}

/// Work-area rectangle `(x, y, width, height)` in physical pixels.
type Area = (i32, i32, i32, i32);

/// Place a window of `size` so its bottom-right corner is at `anchor`, but
/// keep it completely inside `area` (shrinking it if the area is smaller).
/// Returns `(x, y, width, height)`.
fn place(anchor: (i32, i32), size: (i32, i32), area: Area) -> (i32, i32, i32, i32) {
    let (ax, ay, aw, ah) = area;
    let w = size.0.min(aw).max(1);
    let h = size.1.min(ah).max(1);
    let x = (anchor.0 - w).clamp(ax, ax + aw - w);
    let y = (anchor.1 - h).clamp(ay, ay + ah - h);
    (x, y, w, h)
}

/// Work area of the monitor that contains `point`, else the primary monitor.
fn work_area_for(win: &WebviewWindow, point: (i32, i32)) -> Option<Area> {
    let monitor = win
        .monitor_from_point(point.0 as f64 - 1.0, point.1 as f64 - 1.0)
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten())?;
    let a = monitor.work_area();
    Some((a.position.x, a.position.y, a.size.width as i32, a.size.height as i32))
}

/// Resize the window keeping its bottom-right corner (the mascot) in place.
fn apply_size(win: &WebviewWindow, state: &AppState, logical: (f64, f64)) -> Result<(), String> {
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let size: PhysicalSize<u32> = LogicalSize::new(logical.0, logical.1).to_physical(scale);
    let anchor = state
        .anchor
        .lock()
        .unwrap()
        .or_else(|| default_anchor(win))
        .unwrap_or((size.width as i32 + 100, size.height as i32 + 100));
    let (x, y, w, h) = match work_area_for(win, anchor) {
        Some(area) => place(anchor, (size.width as i32, size.height as i32), area),
        None => (anchor.0 - size.width as i32, anchor.1 - size.height as i32, size.width as i32, size.height as i32),
    };
    // Windows delivers WM_SIZE/WM_MOVE synchronously inside set_size/set_position;
    // ignore those intermediate states, then store the final anchor.
    state.adjusting.store(true, Ordering::SeqCst);
    let result = win
        .set_size(PhysicalSize::new(w as u32, h as u32))
        .and_then(|_| win.set_position(PhysicalPosition::new(x, y)))
        .map_err(|e| e.to_string());
    state.adjusting.store(false, Ordering::SeqCst);
    *state.anchor.lock().unwrap() = Some((x + w, y + h));
    result
}

fn remember_anchor(win: &WebviewWindow, state: &AppState) {
    if state.adjusting.load(Ordering::SeqCst) {
        return;
    }
    if let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) {
        *state.anchor.lock().unwrap() = Some((pos.x + size.width as i32, pos.y + size.height as i32));
    }
}

/// While expanded, remember the size the user resized the window to.
fn remember_expanded_size(win: &WebviewWindow, state: &AppState, size: PhysicalSize<u32>) {
    if !state.expanded.load(Ordering::SeqCst) || state.adjusting.load(Ordering::SeqCst) {
        return;
    }
    if let Ok(scale) = win.scale_factor() {
        let logical: LogicalSize<f64> = size.to_logical(scale);
        if logical.width >= MIN_EXPANDED.0 - 1.0 && logical.height >= MIN_EXPANDED.1 - 1.0 {
            *state.expanded_size.lock().unwrap() = (logical.width.round(), logical.height.round());
        }
    }
}

/// Save window placement (anchor + chat size) to the settings file.
fn persist_anchor(app: &AppHandle) {
    let state = app.state::<AppState>();
    let anchor = *state.anchor.lock().unwrap();
    let (w, h) = *state.expanded_size.lock().unwrap();
    let mut s = state.settings.lock().unwrap();
    if let Some((r, b)) = anchor {
        s.anchor_right = Some(r);
        s.anchor_bottom = Some(b);
    }
    s.expanded_width = Some(w);
    s.expanded_height = Some(h);
    let _ = s.save(app);
}

fn show_and_toggle(app: &AppHandle) {
    if let Some(win) = main_window(app) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    let _ = app.emit("ui://toggle", ());
}

// ---------------------------------------------------------------------------
// Hotkey
// ---------------------------------------------------------------------------

fn register_hotkey(app: &AppHandle, spec: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let gs = app.global_shortcut();
    if let Some(old) = state.hotkey.lock().unwrap().take() {
        let _ = gs.unregister(old);
    }
    let shortcut: Shortcut = spec
        .parse()
        .map_err(|e| format!("Ungültiger Hotkey '{spec}': {e}"))?;
    gs.register(shortcut).map_err(|e| format!("Hotkey '{spec}' nicht verfügbar: {e}"))?;
    *state.hotkey.lock().unwrap() = Some(shortcut);
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Current settings (for modules that have no `State` at hand).
pub(crate) fn current_settings(app: &AppHandle) -> Settings {
    app.state::<AppState>().settings.lock().unwrap().clone()
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> Result<(), String> {
    let hotkey_changed = state.settings.lock().unwrap().hotkey != settings.hotkey;
    {
        // Window placement is owned by the backend, never by the settings form.
        let mut s = state.settings.lock().unwrap();
        let keep = (s.anchor_right, s.anchor_bottom, s.expanded_width, s.expanded_height);
        // Add-ons are changed through their own commands right away; a form
        // opened earlier must not bring back an old list.
        let addons = (std::mem::take(&mut s.disabled_extensions), std::mem::take(&mut s.mcp_servers));
        let photos = (std::mem::take(&mut s.photo_folders), std::mem::take(&mut s.photo_model));
        *s = settings;
        (s.anchor_right, s.anchor_bottom, s.expanded_width, s.expanded_height) = keep;
        (s.disabled_extensions, s.mcp_servers) = addons;
        (s.photo_folders, s.photo_model) = photos;
        s.save(&app)?;
    }
    if hotkey_changed {
        let spec = state.settings.lock().unwrap().hotkey.clone();
        register_hotkey(&app, &spec)?;
    }
    apply_autostart(state.settings.lock().unwrap().autostart);
    Ok(())
}

#[tauri::command]
fn agent_start(app: AppHandle, state: State<AppState>, proc_: State<AgentProcess>) -> Result<u64, String> {
    let settings = state.settings.lock().unwrap().clone();
    proc_.start(&app, &settings)
}

#[tauri::command]
fn agent_send(proc_: State<AgentProcess>, line: String) -> Result<(), String> {
    proc_.send(&line)
}

#[tauri::command]
fn agent_stop(proc_: State<AgentProcess>) {
    proc_.stop();
}

#[tauri::command]
fn agent_stderr(proc_: State<AgentProcess>) -> String {
    proc_.stderr_tail()
}

/// MCP servers to pass to aar with each session: the bundled Windows desktop
/// server (unless switched off) plus the servers added under Settings → Tools.
#[tauri::command]
fn agent_mcp_servers(app: AppHandle, state: State<AppState>) -> Vec<agent_process::AcpMcpServer> {
    let s = state.settings.lock().unwrap().clone();
    let Ok(dir) = app.path().resource_dir() else { return vec![] };
    let mut out: Vec<agent_process::AcpMcpServer> = vec![];
    if s.desktop_control {
        out.extend(agent_process::bundled_mcp_servers(&dir).into_iter().map(agent_process::AcpMcpServer::Stdio));
    }
    if let Some(photos) = photos::mcp_server(&app, &s) {
        out.push(agent_process::AcpMcpServer::Stdio(photos));
    }
    if let (Some(root), Some(state), Some(node)) = (addons::mcp_dir(&app), addons::mcp_state_dir(&app), addons::node_dir(&app)) {
        let dirs = agent_process::McpDirs { root, state, node, browsers: addons::browsers() };
        let rt = helpers::runtime(&app, &s).ok();
        out.extend(agent_process::user_mcp_servers(rt.as_ref(), &dirs, &s.mcp_servers));
    }
    out
}

// ---- add-ons: extensions + MCP servers ------------------------------------

#[tauri::command]
async fn registry_fetch(app: AppHandle) -> Result<addons::RegistryResult, String> {
    blocking(move || addons::fetch_registry(&app)).await
}

#[tauri::command]
async fn ext_list(app: AppHandle) -> Result<addons::HelperResult, String> {
    blocking(move || addons::ext_list(&app)).await?
}

#[tauri::command]
async fn ext_install(app: AppHandle, dist: String) -> Result<addons::HelperResult, String> {
    blocking(move || addons::ext_install(&app, &dist)).await?
}

#[tauri::command]
async fn ext_uninstall(app: AppHandle, dist: String) -> Result<addons::HelperResult, String> {
    blocking(move || addons::ext_uninstall(&app, &dist)).await?
}

#[tauri::command]
async fn mcp_install(
    app: AppHandle,
    id: String,
    requirement: String,
    runtime: Option<String>,
    bin: Option<String>,
) -> Result<addons::HelperResult, String> {
    blocking(move || {
        addons::mcp_install(&app, &id, &requirement, runtime.as_deref().unwrap_or("python"), bin.as_deref().unwrap_or(""))
    })
    .await?
}

/// Which Python add-ons are installed for (shown in the extensions tab).
#[tauri::command]
fn addons_runtime(app: AppHandle, state: State<AppState>) -> Option<serde_json::Value> {
    let s = state.settings.lock().unwrap().clone();
    let rt = helpers::runtime(&app, &s).ok()?;
    Some(serde_json::json!({ "python": rt.python.to_string_lossy(), "bundled": rt.bundled }))
}

#[tauri::command]
fn mcp_browsers() -> addons::Browsers {
    addons::browsers()
}

// ---- photo search -----------------------------------------------------------

#[tauri::command]
async fn photos_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let s = app.state::<AppState>().settings.lock().unwrap().clone();
    blocking(move || photos::status(&app, &s)).await?
}

#[tauri::command]
fn photos_index_start(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let s = state.settings.lock().unwrap().clone();
    photos::index_start(&app, &s)
}

#[tauri::command]
fn photos_index_stop(app: AppHandle) -> Result<(), String> {
    photos::index_stop(&app)
}

#[tauri::command]
async fn photos_clear(app: AppHandle) -> Result<(), String> {
    blocking(move || photos::clear(&app)).await?
}

#[tauri::command]
fn photo_thumb(app: AppHandle, path: String) -> Option<String> {
    photos::thumb(&app, &path)
}

/// Vision models of the Ollama server the photo search would use.
#[tauri::command]
async fn photo_models(app: AppHandle) -> Result<photos::VisionModels, String> {
    let s = app.state::<AppState>().settings.lock().unwrap().clone();
    blocking(move || {
        let url = photos::resolve_llm(&app, &s).map(|(u, _)| u).unwrap_or_else(|_| "http://localhost:11434".into());
        photos::vision_models(&url)
    })
    .await
}

/// Photo folders + model (new folders must exist; takes effect for the next
/// session). Returns how many index entries of removed folders were deleted.
#[tauri::command]
async fn set_photo_settings(app: AppHandle, folders: Vec<String>, model: String) -> Result<u32, String> {
    let next = {
        let state = app.state::<AppState>();
        let mut s = state.settings.lock().unwrap();
        // Only new folders must exist (a vanished one can still be removed).
        if let Some(bad) = folders.iter().find(|f| !s.photo_folders.contains(f) && !photos::valid_folder(f)) {
            return Err(trf!("Ordner nicht gefunden: {bad}", "Folder not found: {bad}", "找不到文件夹：{bad}"));
        }
        let removed_any = s.photo_folders.iter().any(|f| !folders.contains(f));
        s.photo_folders = folders.iter().map(|f| f.trim().to_string()).collect();
        s.photo_model = model.trim().to_string();
        s.save(&app)?;
        removed_any.then(|| s.clone())
    };
    // A folder was removed: its descriptions and thumbnails go right away.
    match next {
        Some(s) => blocking(move || photos::prune(&app, &s)).await?,
        None => Ok(0),
    }
}

/// Windows folder picker (None = cancelled).
#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |p| {
        let _ = tx.send(p.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()));
    });
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten()).await.ok().flatten()
}

#[tauri::command]
async fn mcp_remove(app: AppHandle, id: String) -> Result<(), String> {
    blocking(move || addons::mcp_remove(&app, &id)).await?
}

#[tauri::command]
fn mcp_installed(app: AppHandle) -> Vec<String> {
    addons::mcp_installed(&app)
}

#[tauri::command]
fn addons_cancel() {
    addons::cancel();
}

/// Extensions switched off (takes effect when aar restarts).
#[tauri::command]
fn set_disabled_extensions(app: AppHandle, state: State<AppState>, names: Vec<String>) -> Result<(), String> {
    let mut s = state.settings.lock().unwrap();
    s.disabled_extensions = names;
    s.save(&app)
}

/// MCP servers from Settings → Tools (used from the next session on).
#[tauri::command]
fn set_mcp_servers(app: AppHandle, state: State<AppState>, servers: Vec<UserMcpServer>) -> Result<(), String> {
    if let Some(bad) = servers.iter().find(|s| !settings::valid_server_id(&s.id) || s.id == "windows") {
        return Err(format!("invalid server id: {}", bad.id));
    }
    let mut s = state.settings.lock().unwrap();
    s.mcp_servers = servers;
    s.save(&app)
}

/// The webview resolved the UI language ("auto" = Windows language): use it
/// for texts made here (tray menu, error messages).
#[tauri::command]
fn set_ui_language(app: AppHandle, lang: String) {
    i18n::set_lang(&lang);
    if let Some(tray) = app.try_state::<TrayMenu>() {
        tray.relabel();
    }
    if let Some(t) = app.tray_by_id("aar-tray") {
        let _ = t.set_tooltip(Some(tray_tooltip()));
    }
}

/// Tray menu entries, relabelled when the UI language changes.
struct TrayMenu {
    toggle: MenuItem<Wry>,
    new_chat: MenuItem<Wry>,
    restart: MenuItem<Wry>,
    settings: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

impl TrayMenu {
    fn labels() -> [&'static str; 5] {
        [
            tr("Aar öffnen / schließen", "Open / close Aar", "打开 / 关闭 Aar"),
            tr("Neues Gespräch", "New conversation", "新对话"),
            tr("Agent neu starten", "Restart agent", "重新启动代理"),
            tr("Einstellungen…", "Settings…", "设置…"),
            tr("Beenden", "Quit", "退出"),
        ]
    }

    fn relabel(&self) {
        let l = Self::labels();
        for (item, text) in [&self.toggle, &self.new_chat, &self.restart, &self.settings, &self.quit].into_iter().zip(l) {
            let _ = item.set_text(text);
        }
    }
}

fn tray_tooltip() -> &'static str {
    tr("Aar – dein Assistent", "Aar – your assistant", "Aar – 你的助手")
}

/// Register or remove the "start with Windows" entry and remember a problem
/// for the settings page.
fn apply_autostart(enabled: bool) {
    let status = match autostart::apply(enabled) {
        Ok(()) => String::new(),
        Err(e) => trf!(
            "Autostart konnte nicht eingerichtet werden: {e}",
            "Could not set up starting with Windows: {e}",
            "无法设置开机自动启动：{e}"
        ),
    };
    *AUTOSTART_STATUS.lock().unwrap() = status;
}

/// Problem with the last autostart change, shown under the checkbox ("" = fine).
static AUTOSTART_STATUS: Mutex<String> = Mutex::new(String::new());

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// A file the agent created or changed during the last turn.
#[derive(serde::Serialize)]
struct TurnFile {
    path: String,
    name: String,
    openable: bool,
}

/// Files touched since `since_ms` (Unix ms): the candidate paths the frontend
/// found in the turn (tool inputs, commands, the answer) plus anything new
/// directly in Desktop, Documents, Downloads and the working folder - e.g. a
/// PDF a PowerShell command produced without naming the path literally.
#[tauri::command]
fn turn_files(app: AppHandle, state: State<AppState>, since_ms: u64, candidates: Vec<String>) -> Vec<TurnFile> {
    let wd = state.settings.lock().unwrap().resolved_working_dir(&app);
    let since = std::time::UNIX_EPOCH + std::time::Duration::from_millis(since_ms.saturating_sub(2000));
    let mut paths: Vec<std::path::PathBuf> = candidates
        .iter()
        .map(|c| {
            let p = std::path::PathBuf::from(c.trim());
            if p.is_absolute() { p } else { wd.join(p) }
        })
        .collect();
    let folders = [app.path().desktop_dir().ok(), app.path().document_dir().ok(), app.path().download_dir().ok(), Some(wd)];
    for dir in folders.into_iter().flatten() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            paths.extend(entries.flatten().map(|e| e.path()).filter(|p| files::is_document(p)));
        }
    }
    files::recent(paths, since)
        .into_iter()
        .take(10)
        .map(|p| TurnFile {
            name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            openable: files::is_document(&p),
            path: p.to_string_lossy().into_owned(),
        })
        .collect()
}

/// Open a document with its default program, or show any file in Explorer.
/// Opening is limited to document/image types: never an exe, script or link,
/// even if the webview asks for one.
#[tauri::command]
fn open_file(path: String, reveal: bool) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_file() {
        return Err(trf!(
            "Die Datei gibt es nicht mehr: {path}",
            "The file no longer exists: {path}",
            "该文件已不存在：{path}"
        ));
    }
    if !reveal && !files::is_document(&p) {
        return Err(tr(
            "Diesen Dateityp öffne ich aus Sicherheitsgründen nicht direkt.",
            "For safety reasons I don't open this file type directly.",
            "出于安全原因，我不会直接打开这种文件类型。",
        )
        .into());
    }
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let arg = if reveal { format!("/select,\"{}\"", p.display()) } else { format!("\"{}\"", p.display()) };
        cmd.raw_arg(arg);
    }
    #[cfg(not(windows))]
    cmd.arg(&p);
    cmd.spawn().map(|_| ()).map_err(|e| trf!("Explorer konnte nicht starten: {e}", "Could not start Explorer: {e}", "无法启动资源管理器：{e}"))
}

/// Places a user (or support) looks at when something went wrong.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticPaths {
    sessions: String,
    log: String,
    autostart_problem: String,
}

#[tauri::command]
fn diagnostic_paths(app: AppHandle, state: State<AppState>) -> DiagnosticPaths {
    let s = state.settings.lock().unwrap().clone();
    DiagnosticPaths {
        sessions: s.sessions_dir(&app).to_string_lossy().into_owned(),
        log: agent_log::log_path(&app).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        autostart_problem: AUTOSTART_STATUS.lock().unwrap().clone(),
    }
}

/// Show the conversation folder or the log file in Explorer. Takes a fixed
/// name, never a path: the webview must not be able to open arbitrary files.
#[tauri::command]
fn open_path(app: AppHandle, state: State<AppState>, what: String) -> Result<(), String> {
    let s = state.settings.lock().unwrap().clone();
    let (path, select) = match what.as_str() {
        "sessions" => (s.sessions_dir(&app), false),
        "log" => (
            agent_log::log_path(&app).ok_or_else(|| tr("Kein Protokollordner", "No log folder", "没有日志文件夹").to_string())?,
            true,
        ),
        _ => return Err(format!("unknown: {what}")),
    };
    if !path.exists() {
        return Err(match what.as_str() {
            "sessions" => trf!(
                "Es gibt noch keine gespeicherten Gespräche ({}).",
                "There are no saved conversations yet ({}).",
                "还没有保存的对话（{}）。",
                path.display()
            ),
            _ => trf!(
                "Es gibt noch kein Protokoll ({}).",
                "There is no log yet ({}).",
                "还没有日志（{}）。",
                path.display()
            ),
        });
    }
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer wants the whole `/select,"<path>"` as one raw argument (spaces in paths).
        if select {
            cmd.raw_arg(format!("/select,\"{}\"", path.display()));
        } else {
            cmd.raw_arg(format!("\"{}\"", path.display()));
        }
    }
    #[cfg(not(windows))]
    {
        let _ = select;
        cmd.arg(&path);
    }
    cmd.spawn().map(|_| ()).map_err(|e| trf!("Explorer konnte nicht starten: {e}", "Could not start Explorer: {e}", "无法启动资源管理器：{e}"))
}

#[tauri::command]
fn agent_working_dir(app: AppHandle, state: State<AppState>) -> String {
    state.settings.lock().unwrap().resolved_working_dir(&app).to_string_lossy().into_owned()
}

/// Provider profiles from the aar config file. `config_path` = value currently
/// typed in the settings form (may differ from the saved one); empty = default.
#[tauri::command]
fn aar_config_info(app: AppHandle, state: State<AppState>, config_path: Option<String>) -> llm_config::AarConfigInfo {
    let mut s = state.settings.lock().unwrap().clone();
    if let Some(p) = config_path {
        s.config_path = p;
    }
    llm_config::read_aar_config(&s.aar_config_file(&app))
}

#[tauri::command]
async fn check_endpoint(url: String) -> llm_config::EndpointCheck {
    tauri::async_runtime::spawn_blocking(move || llm_config::check_endpoint(&url))
        .await
        .unwrap_or_else(|e| llm_config::EndpointCheck { reachable: false, message: e.to_string(), models: vec![] })
}

/// Cloud provider (anthropic, openai, gemini, generic): is the key valid, which
/// models are there? An empty `api_key` uses the stored one.
#[tauri::command]
async fn check_provider(
    state: State<'_, AppState>,
    kind: String,
    base_url: String,
    api_key: String,
) -> Result<llm_config::EndpointCheck, String> {
    let key = if api_key.trim().is_empty() {
        state.settings.lock().unwrap().api_keys.get(&kind).cloned().unwrap_or_default()
    } else {
        api_key
    };
    blocking(move || llm_config::check_provider(&kind, &base_url, &key)).await
}

// ---- first-run setup (hardware, Ollama, model download) -------------------

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn setup_system_info() -> Result<setup::SystemInfo, String> {
    blocking(setup::system_info).await
}

#[tauri::command]
async fn setup_ollama_status() -> Result<setup::OllamaStatus, String> {
    blocking(setup::ollama_status).await
}

fn to_webview(app: &AppHandle) -> impl Fn(setup::Progress) + '_ {
    move |p| {
        let _ = app.emit("setup://progress", p);
    }
}

#[tauri::command]
async fn setup_ollama_install(app: AppHandle) -> Result<setup::OllamaStatus, String> {
    blocking(move || setup::ollama_install(&to_webview(&app))).await?
}

#[tauri::command]
async fn setup_ollama_start(app: AppHandle) -> Result<setup::OllamaStatus, String> {
    blocking(move || setup::ollama_start(&to_webview(&app))).await?
}

#[tauri::command]
async fn setup_ollama_pull(app: AppHandle, model: String) -> Result<(), String> {
    blocking(move || setup::ollama_pull(&to_webview(&app), &model)).await?
}

#[tauri::command]
fn setup_cancel() {
    setup::cancel();
}

#[tauri::command]
fn set_expanded(app: AppHandle, window: WebviewWindow, state: State<AppState>, expanded: bool) -> Result<(), String> {
    let err = |e: tauri::Error| e.to_string();
    if expanded {
        let size = *state.expanded_size.lock().unwrap();
        apply_size(&window, &state, size)?;
        window.set_min_size(Some(LogicalSize::new(MIN_EXPANDED.0, MIN_EXPANDED.1))).map_err(err)?;
        window.set_resizable(true).map_err(err)?;
        state.expanded.store(true, Ordering::SeqCst);
    } else {
        state.expanded.store(false, Ordering::SeqCst);
        window.set_resizable(false).map_err(err)?;
        window.set_min_size(None::<LogicalSize<f64>>).map_err(err)?;
        apply_size(&window, &state, COLLAPSED)?;
        persist_anchor(&app);
    }
    Ok(())
}

#[tauri::command]
fn hide_window(app: AppHandle, window: WebviewWindow) {
    persist_anchor(&app);
    let _ = window.hide();
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    persist_anchor(&app);
    app.state::<AgentProcess>().stop();
    app.exit(0);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/// `aar-desktop.exe --diagnose <file>`: write hardware/Ollama detection as JSON
/// and exit (support + automated checks; the GUI build has no console).
fn diagnose(path: &str) {
    let report = serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "system": setup::system_info(),
        "ollama": setup::ollama_status(),
        // On Windows the resource dir is the install dir (next to the exe).
        "bundledPython": std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().and_then(agent_process::bundled_python))
            .map(|p| p.to_string_lossy().into_owned()),
        "aarOnPath": agent_process::resolve_program("aar").map(|p| p.to_string_lossy().into_owned()),
        "mcpServers": std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(agent_process::bundled_mcp_servers))
            .unwrap_or_default(),
    });
    let _ = std::fs::write(path, serde_json::to_string_pretty(&report).unwrap_or_default());
}

/// `aar-desktop.exe --setup <log file> [model]`: unattended setup (install/start
/// Ollama, optionally pull a model) — what the wizard does, for automated tests
/// and admins. Progress lines go to the log; the last line is `OK` or `ERROR: …`.
fn setup_cli(log: &str, model: Option<&str>) {
    use std::io::Write as _;
    let file = std::sync::Mutex::new(std::fs::File::create(log).ok());
    let line = |s: String| {
        if let Some(f) = file.lock().unwrap().as_mut() {
            let _ = writeln!(f, "{s}");
            let _ = f.flush();
        }
    };
    let last = std::sync::Mutex::new(String::new());
    let report = |p: setup::Progress| {
        // Log phase changes and every ~10 % of progress, not every chunk.
        let pct = if p.total > 0 { p.done * 10 / p.total } else { 0 };
        let key = format!("{} {} {pct}", p.phase, p.message);
        if *last.lock().unwrap() != key {
            line(format!("[{}] {} {}/{}", p.phase, p.message, p.done, p.total));
            *last.lock().unwrap() = key;
        }
    };
    let result = (|| {
        let status = setup::ollama_status();
        line(format!("status: {}", serde_json::to_string(&status).unwrap_or_default()));
        let status = if !status.installed {
            setup::ollama_install(&report)?
        } else if !status.running {
            setup::ollama_start(&report)?
        } else {
            status
        };
        line(format!("ollama: {}", serde_json::to_string(&status).unwrap_or_default()));
        if let Some(m) = model {
            setup::ollama_pull(&report, m)?;
            line(format!("models: {:?}", setup::ollama_status().models));
        }
        Ok::<(), String>(())
    })();
    line(match result {
        Ok(()) => "OK".into(),
        Err(e) => format!("ERROR: {e}"),
    });
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--diagnose") {
        diagnose(args.get(i + 1).map(String::as_str).unwrap_or("aar-desktop-diagnose.json"));
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--setup") {
        let log = args.get(i + 1).map(String::as_str).unwrap_or("aar-desktop-setup.log");
        setup_cli(log, args.get(i + 2).map(String::as_str));
        return;
    }
    tauri::Builder::default()
        // Must be the first plugin: a second launch just focuses the running mascot.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_and_toggle(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        show_and_toggle(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .manage(AgentProcess::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = Settings::load(&handle);
            // Until the webview reports the resolved language (auto = Windows language).
            i18n::set_lang(if settings.language.is_empty() { "de" } else { &settings.language });
            let anchor = match (settings.anchor_right, settings.anchor_bottom) {
                (Some(r), Some(b)) => Some((r, b)),
                _ => None,
            };
            let hotkey = settings.hotkey.clone();
            let expanded_size = (
                settings.expanded_width.unwrap_or(DEFAULT_EXPANDED.0).max(MIN_EXPANDED.0),
                settings.expanded_height.unwrap_or(DEFAULT_EXPANDED.1).max(MIN_EXPANDED.1),
            );
            apply_autostart(settings.autostart);
            app.manage(AppState {
                settings: Mutex::new(settings),
                anchor: Mutex::new(anchor),
                hotkey: Mutex::new(None),
                expanded: AtomicBool::new(false),
                expanded_size: Mutex::new(expanded_size),
                adjusting: AtomicBool::new(false),
            });

            if let Err(e) = register_hotkey(&handle, &hotkey) {
                eprintln!("{e}");
                let _ = register_hotkey(&handle, &Settings::default().hotkey);
            }

            // Tray icon + menu (relabelled once the webview reports its language).
            let [l_toggle, l_new, l_restart, l_settings, l_quit] = TrayMenu::labels();
            let toggle = MenuItem::with_id(app, "toggle", l_toggle, true, None::<&str>)?;
            let new_chat = MenuItem::with_id(app, "new_chat", l_new, true, None::<&str>)?;
            let restart = MenuItem::with_id(app, "restart", l_restart, true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", l_settings, true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", l_quit, true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&toggle, &new_chat, &restart, &settings_item, &sep, &quit])?;
            app.manage(TrayMenu {
                toggle: toggle.clone(),
                new_chat: new_chat.clone(),
                restart: restart.clone(),
                settings: settings_item.clone(),
                quit: quit.clone(),
            });

            TrayIconBuilder::with_id("aar-tray")
                .icon(app.default_window_icon().cloned().ok_or("missing icon")?)
                .tooltip(tray_tooltip())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => show_and_toggle(app),
                    "new_chat" => {
                        show_and_toggle_open(app);
                        let _ = app.emit("ui://new-chat", ());
                    }
                    "restart" => {
                        let _ = app.emit("ui://restart-agent", ());
                    }
                    "settings" => {
                        show_and_toggle_open(app);
                        let _ = app.emit("ui://settings", ());
                    }
                    "quit" => quit_app(app.clone()),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_and_toggle(tray.app_handle());
                    }
                })
                .build(app)?;

            // Place the mascot, then show it.
            if let Some(win) = main_window(&handle) {
                let state = handle.state::<AppState>();
                let stale = state.anchor.lock().unwrap().map(|a| !anchor_visible(&win, a)).unwrap_or(true);
                if stale {
                    *state.anchor.lock().unwrap() = default_anchor(&win);
                }
                apply_size(&win, &state, COLLAPSED)?;
                win.show()?;
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Moved(_) => {
                if let Some(win) = window.app_handle().get_webview_window(window.label()) {
                    remember_anchor(&win, &window.app_handle().state::<AppState>());
                }
            }
            WindowEvent::Resized(size) => {
                if let Some(win) = window.app_handle().get_webview_window(window.label()) {
                    let state = window.app_handle().state::<AppState>();
                    remember_expanded_size(&win, &state, *size);
                    remember_anchor(&win, &state);
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                // Closing the mascot only hides it; quit via tray.
                api.prevent_close();
                persist_anchor(window.app_handle());
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            agent_start,
            agent_send,
            agent_stop,
            agent_stderr,
            agent_working_dir,
            agent_mcp_servers,
            diagnostic_paths,
            open_path,
            app_version,
            turn_files,
            open_file,
            aar_config_info,
            check_endpoint,
            check_provider,
            setup_system_info,
            setup_ollama_status,
            setup_ollama_install,
            setup_ollama_start,
            setup_ollama_pull,
            setup_cancel,
            registry_fetch,
            ext_list,
            ext_install,
            ext_uninstall,
            mcp_install,
            mcp_remove,
            mcp_installed,
            mcp_browsers,
            addons_runtime,
            photos_status,
            photos_index_start,
            photos_index_stop,
            photos_clear,
            photo_thumb,
            photo_models,
            set_photo_settings,
            pick_folder,
            addons_cancel,
            set_disabled_extensions,
            set_mcp_servers,
            set_ui_language,
            set_expanded,
            hide_window,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running aar-ui");
}

/// Show the window and make sure the bubble is open (without toggling it closed).
fn show_and_toggle_open(app: &AppHandle) {
    if let Some(win) = main_window(app) {
        let _ = win.show();
        let _ = win.set_focus();
    }
    let _ = app.emit("ui://open", ());
}

#[cfg(test)]
mod tests {
    use super::place;

    const AREA: (i32, i32, i32, i32) = (0, 0, 3840, 2112);

    #[test]
    fn keeps_bottom_right_anchor() {
        assert_eq!(place((3828, 2100), (400, 640), AREA), (3428, 1460, 400, 640));
    }

    #[test]
    fn clamps_offscreen_anchor_into_work_area() {
        // The anchor that was saved off-screen in a real session.
        assert_eq!(place((4263, 1199), (400, 640), AREA), (3440, 559, 400, 640));
        assert_eq!(place((100, 100), (400, 640), AREA), (0, 0, 400, 640));
    }

    #[test]
    fn shrinks_to_small_work_area() {
        assert_eq!(place((1000, 700), (400, 900), (0, 0, 1280, 720)), (600, 0, 400, 720));
    }

    #[test]
    fn second_monitor_with_negative_origin() {
        assert_eq!(place((-12, 1068), (150, 150), (-1920, 0, 1920, 1080)), (-162, 918, 150, 150));
    }
}
