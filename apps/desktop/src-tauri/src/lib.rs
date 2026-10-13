// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
//! Thesmos Desktop — native shell.
//!
//! Rust owns the minimum: process lifecycle, the folder-grant dialog, and the
//! relay to the runtime. Mission, memory and governance logic stay in the
//! TypeScript core — a Rust reimplementation would be a second set of rules to
//! keep in agreement with the first.
//!
//! The webview's entire native surface is the two commands below.

mod runtime;
mod drive;
mod log;
mod update;

use runtime::{RuntimeHandle, RuntimeReply};
use serde_json::Value;
use tauri::{Manager, RunEvent};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct ProjectGrants(Mutex<Vec<PathBuf>>);

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}

fn save_grants(app: &tauri::AppHandle, roots: &[PathBuf], last: &Path) -> Result<(), String> {
    let dir = data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::json!({ "roots": roots, "lastRoot": last });
    std::fs::write(dir.join("project-grants.json"), json.to_string()).map_err(|e| e.to_string())
}

fn authorize_project_open(app: &tauri::AppHandle, params: &Value) -> Result<(), String> {
        let raw = params.get("root").and_then(Value::as_str).ok_or("Choose a project folder first")?;
        let root = PathBuf::from(raw).canonicalize().map_err(|e| e.to_string())?;
        let grants = app.state::<ProjectGrants>();
        let roots = grants.0.lock().map_err(|_| "Project grants unavailable")?;
        if !roots.contains(&root) { return Err("This folder has not been granted through the project picker".into()); }
        save_grants(app, &roots, &root)?;
        Ok(())
}

/// Filesystem checks and pipe requests run off the async executor. No guard crosses an await.
#[tauri::command]
async fn runtime_request(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<RuntimeHandle>>,
    method: String,
    params: Value,
) -> Result<RuntimeReply, String> {
    let handle = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || -> Result<RuntimeReply, String> {
        if method == "project.open" { authorize_project_open(&app, &params)?; }
        Ok(handle.request(&method, params))
    }).await.map_err(|e| e.to_string())?
}

/// Native folder picker — how a user *grants* project access.
///
/// Deliberately the only way a path enters the runtime. The runtime never
/// discovers a root on its own, so the app's filesystem reach is exactly what
/// the user chose in a dialog they recognize.
#[tauri::command]
async fn choose_project_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("Choose a Thesmos project")
        .pick_folder(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    let chosen = tauri::async_runtime::spawn_blocking(move || rx.recv()).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    if let Some(ref raw) = chosen {
        let root = PathBuf::from(raw).canonicalize().map_err(|e| e.to_string())?;
        if root.parent().is_none() { return Err("Choose a project folder, not an entire drive".into()); }
        let grants = app.state::<ProjectGrants>();
        let mut roots = grants.0.lock().map_err(|_| "Project grants unavailable")?;
        if !roots.contains(&root) { roots.push(root.clone()); }
        save_grants(&app, &roots, &root)?;
    }
    Ok(chosen)
}

#[tauri::command]
async fn open_exports(app: tauri::AppHandle) -> Result<(), String> {
    let folder = data_dir(&app)?.join("exports");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        let explorer = PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into())).join("explorer.exe");
        std::process::Command::new(explorer).arg(folder).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    { let _ = folder; Err("Open the export location shown in Settings on this platform".into()) }
}

fn native_worker(provider: &str) -> Option<PathBuf> {
    let name = match provider { "codex" => "codex.exe", "claude" => "claude.exe", _ => return None };
    let mut candidates: Vec<PathBuf> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).map(|p| p.join(name)).collect();
    if let Ok(home) = std::env::var("USERPROFILE") { candidates.push(PathBuf::from(home).join(".local").join("bin").join(name)); }
    if provider == "claude" {
        if let Ok(appdata) = std::env::var("APPDATA") {
            candidates.push(PathBuf::from(&appdata).join("npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe"));
            candidates.push(PathBuf::from(appdata).join("npm/node_modules/@anthropic-ai/claude-code/vendor/claude-code.exe"));
            candidates.push(PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("npm/node_modules/@anthropic-ai/claude-code/cli.exe"));
        }
    }
    if provider == "codex" {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let bin = PathBuf::from(local).join("OpenAI/Codex/bin");
            if let Ok(entries) = std::fs::read_dir(bin) {
                let mut bundled: Vec<PathBuf> = entries.filter_map(Result::ok).map(|e| e.path().join(name)).filter(|p| p.is_file()).collect();
                bundled.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
                bundled.reverse(); candidates.extend(bundled);
            }
        }
    }
    candidates.into_iter().find(|p| p.is_absolute() && p.is_file())
}

/// Fixed destination only. Credentials and private chat contents never enter the URL.
#[tauri::command]
async fn open_chatgpt() -> Result<(), String> {
    #[cfg(windows)]
    {
        let explorer = PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into())).join("explorer.exe");
        std::process::Command::new(explorer).arg("https://chatgpt.com/").spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    { Err("Open https://chatgpt.com in your browser and paste the prepared prompt".into()) }
}

/// The studio's portal. A different address can be saved in Settings.
const PORTAL_URL: &str = "https://portal.holley.studio/portal";

/// The portal address to open: the one saved in Settings when it is a plain
/// HTTPS address, otherwise the default. Validated here as well as in the
/// runtime, because this is the value handed to the operating system.
fn portal_url(data_dir: &Path) -> String {
    let saved = std::fs::read_to_string(data_dir.join("settings.json")).ok()
        .and_then(|text| serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')).ok())
        .and_then(|value| value.get("portalUrl").and_then(Value::as_str).map(str::to_owned));
    let Some(raw) = saved else { return PORTAL_URL.into() };
    if raw.len() > 200 || raw.bytes().any(|b| !(0x21..=0x7e).contains(&b)) { return PORTAL_URL.into(); }
    match tauri::Url::parse(&raw) {
        Ok(url) if url.scheme() == "https" && url.username().is_empty() && url.password().is_none() && url.host_str().is_some_and(|h| h.contains('.')) => url.to_string(),
        _ => PORTAL_URL.into(),
    }
}

#[tauri::command]
async fn open_portal(app: tauri::AppHandle) -> Result<(), String> {
    let url = portal_url(&data_dir(&app)?);
    #[cfg(windows)]
    {
        let explorer = PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into())).join("explorer.exe");
        std::process::Command::new(explorer).arg(url).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    { Err(format!("Open {url} in your browser")) }
}

/// Choose the update folder in a native dialog. The path comes from the dialog,
/// never from the webview: whoever controls this folder controls what installs.
#[tauri::command]
async fn update_choose_folder(app: tauri::AppHandle) -> Result<Option<update::UpdateStatus>, String> {
    use tauri_plugin_dialog::DialogExt;
    let dir = data_dir(&app)?;
    let current = app.package_info().version.to_string();
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().set_title("Choose the Pantheon update folder").pick_folder(move |path| { let _ = tx.send(path.map(|p| p.to_string())); });
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<update::UpdateStatus>, String> {
        let Some(raw) = rx.recv().map_err(|e| e.to_string())? else { return Ok(None) };
        let folder = PathBuf::from(raw).canonicalize().map_err(|_| "That folder is not available")?;
        if !folder.is_dir() { return Err("Choose a folder".into()); }
        std::fs::write(dir.join("update-channel.json"), serde_json::json!({ "dir": folder }).to_string()).map_err(|e| e.to_string())?;
        log::line("update", "update folder changed in Settings");
        Ok(Some(update::status(&current, &dir)))
    }).await.map_err(|e| e.to_string())?
}

/// Forget a chosen update folder and find the studio release folder automatically again.
#[tauri::command]
async fn update_reset_folder(app: tauri::AppHandle) -> Result<update::UpdateStatus, String> {
    let dir = data_dir(&app)?;
    let current = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || -> Result<update::UpdateStatus, String> {
        let file = dir.join("update-channel.json");
        if file.exists() { std::fs::remove_file(&file).map_err(|e| e.to_string())?; }
        Ok(update::status(&current, &dir))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod portal_url_tests {
    use super::{portal_url, PORTAL_URL};
    fn with(settings: &str) -> String {
        let dir = std::env::temp_dir().join(format!("pantheon-portal-url-{}-{}", std::process::id(), settings.len()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), settings).unwrap();
        let url = portal_url(&dir);
        let _ = std::fs::remove_dir_all(dir);
        url
    }
    #[test]
    fn saved_https_address_is_used_and_anything_else_falls_back() {
        assert_eq!(with(r#"{"portalUrl":"https://portal.example.studio/portal"}"#), "https://portal.example.studio/portal");
        for bad in [r#"{"portalUrl":"http://portal.example.studio"}"#, r#"{"portalUrl":"https://user:pw@portal.example.studio"}"#, r#"{"portalUrl":"file:///C:/Windows"}"#,
            r#"{"portalUrl":"https://localhost"}"#, r#"{"portalUrl":"https://portal.example.studio/a b"}"#, r#"{"portalUrl":42}"#, r#"{}"#, "not json"] {
            assert_eq!(with(bad), PORTAL_URL, "{bad}");
        }
        assert_eq!(portal_url(std::path::Path::new("Z:\\no\\such\\folder")), PORTAL_URL);
    }
}

/// Import a portal request the user picks in a native file dialog.
///
/// The webview chooses only the project and playbook. The request content comes
/// from the file the user selected and goes straight to the runtime, which
/// validates it; a compromised webview cannot inject a request of its own.
#[tauri::command]
async fn import_portal_request(app: tauri::AppHandle, state: tauri::State<'_, Arc<RuntimeHandle>>, project_id: String, playbook_id: String) -> Result<Option<Value>, String> {
    use tauri_plugin_dialog::DialogExt;
    if project_id.is_empty() || project_id.len() > 80 || playbook_id.is_empty() || playbook_id.len() > 80 { return Err("Choose a project and a playbook first".into()); }
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().set_title("Choose a portal request").add_filter("Portal request", &["json"]).pick_file(move |path| { let _ = tx.send(path.map(|p| p.to_string())); });
    let handle = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<Value>, String> {
        let Some(raw) = rx.recv().map_err(|e| e.to_string())? else { return Ok(None) };
        let path = PathBuf::from(raw);
        let size = std::fs::metadata(&path).map_err(|_| "The portal request file could not be read")?.len();
        if size > 64 * 1024 { return Err("The portal request file is too large".into()); }
        let content = std::fs::read_to_string(&path).map_err(|_| "The portal request file is not readable text")?;
        let reply = handle.request_internal("studio.importRequest", serde_json::json!({ "projectId": project_id, "playbookId": playbook_id, "content": content }));
        if !reply.ok { return Err(reply.error.map(|e| e.message).unwrap_or_else(|| "The portal request could not be imported".into())); }
        Ok(reply.result)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn connect_subscription(provider: String) -> Result<(), String> {
    let binary = native_worker(&provider).ok_or("Install the official native worker first")?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let powershell = PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into())).join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let command = format!("& '{}' {}", binary.to_string_lossy().replace('\'', "''"), if provider == "codex" { "login" } else { "auth login --claudeai" });
        // A visible console is intentional here: the user clicked Connect and must complete the provider's own login.
        let mut login = std::process::Command::new(powershell);
        login.args(["-NoProfile", "-NoExit", "-Command", &command]).creation_flags(0x00000010);
        for key in ["OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "OPENAI_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_OAUTH_TOKEN"] {
            login.env_remove(key);
        }
        login.spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    { let _ = binary; Err("Complete the provider's official CLI login, then refresh Connections".into()) }
}

/// Closed Google destinations; never accept arbitrary URLs from email or the webview.
fn google_url(service: &str, account: &str, reference: Option<&str>) -> Result<String, String> {
    if account.len() > 160 || !account.contains('@') || !account.bytes().all(|b| b.is_ascii_alphanumeric() || b"._+-@".contains(&b)) { return Err("Invalid Google account".into()); }
    fn encoded(raw: &str) -> String { raw.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect() }
    let auth = encoded(account);
    match service {
        "gmail" => { if let Some(item) = reference { if item.is_empty() || item.len() > 64 || !item.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("Invalid Gmail item".into()); } }
            Ok(format!("https://mail.google.com/mail/u/?authuser={auth}{}", reference.map(|id| format!("#all/{id}")).unwrap_or_default())) }
        "calendar" => { if let Some(item) = reference { if item.is_empty() || item.len() > 600 || !item.bytes().all(|b| b.is_ascii_alphanumeric() || b"_=-".contains(&b)) { return Err("Invalid calendar item".into()); }
            Ok(format!("https://www.google.com/calendar/event?eid={}&authuser={auth}", encoded(item))) }
            else { Ok(format!("https://calendar.google.com/calendar/?authuser={auth}")) } }
        _ => Err("Choose Gmail or Google Calendar".into()),
    }
}

#[tauri::command]
async fn open_google(service: String, account: String, reference: Option<String>) -> Result<(), String> {
    let url = google_url(&service, &account, reference.as_deref())?;
    #[cfg(windows)]
    { let explorer = PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into())).join("explorer.exe");
      std::process::Command::new(explorer).arg(url).spawn().map_err(|e| e.to_string())?; Ok(()) }
    #[cfg(not(windows))]
    { let _ = url; Err("Open Gmail or Google Calendar in your browser".into()) }
}

#[cfg(test)]
mod google_navigation_tests {
    use super::google_url;
    #[test]
    fn builds_account_specific_google_destinations() {
        assert_eq!(google_url("gmail", "matthew@holley.studio", Some("1a0f34c03683b8f3")).unwrap(), "https://mail.google.com/mail/u/?authuser=matthew%40holley.studio#all/1a0f34c03683b8f3");
        assert!(google_url("calendar", "matthew@holley.studio", Some("dGVzdA==")).unwrap().starts_with("https://www.google.com/calendar/event?eid=dGVzdA%3D%3D&authuser="));
    }
    #[test]
    fn rejects_arbitrary_destinations_and_url_injection() {
        assert!(google_url("shell", "matthew@holley.studio", None).is_err());
        assert!(google_url("gmail", "x@host/?next=evil", None).is_err());
        assert!(google_url("gmail", "matthew@holley.studio", Some("https://evil.example")).is_err());
        assert!(google_url("calendar", "matthew@holley.studio", Some("x&redirect=evil")).is_err());
    }
}


/// Source URLs are resolved from a permitted registration, never from generated answer text.
fn knowledge_url(raw: &str) -> Result<String, String> {
 if raw.len() > 2000 || raw.bytes().any(|b| b.is_ascii_control() || b == b' ' || b == b'\\') || raw.contains("/../") || raw.contains("/./") { return Err("Invalid knowledge source URL".into()); }
 let url = tauri::Url::parse(raw).map_err(|_| "Invalid knowledge source URL")?;
 if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port().is_some() { return Err("Choose an HTTPS Google Drive source".into()); }
 let segments: Vec<_> = url.path().split('/').filter(|s| !s.is_empty()).collect();
 let valid_id = |s: &str| !s.is_empty() && s.len() <= 200 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b));
 let valid_path = match url.host_str() {
  Some("drive.google.com") => segments.len() == 4 && segments[0] == "file" && segments[1] == "d" && valid_id(segments[2]) && matches!(segments[3], "view" | "preview"),
  Some("docs.google.com") => segments.len() == 4 && matches!(segments[0], "document" | "spreadsheets" | "presentation") && segments[1] == "d" && valid_id(segments[2]) && matches!(segments[3], "edit" | "view" | "preview"),
  _ => false,
 };
 if !valid_path || url.query_pairs().any(|(key, value)| !matches!(key.as_ref(), "usp" | "authuser" | "ouid" | "rtpof" | "sd") || value.len() > 160 || !value.bytes().all(|b| b.is_ascii_alphanumeric() || b"._+-@".contains(&b))) { return Err("This source is not an allowed Google document link".into()); }
 if let Some(fragment) = url.fragment() { if fragment.len() > 160 || !fragment.bytes().all(|b| b.is_ascii_alphanumeric() || b"._=-".contains(&b)) { return Err("Invalid source section".into()); } }
 Ok(url.to_string())
}

#[tauri::command]
async fn open_knowledge_source(state: tauri::State<'_, Arc<RuntimeHandle>>, project_id: String, source_id: String) -> Result<(), String> {
 if project_id.is_empty() || project_id.len() > 80 || source_id.is_empty() || source_id.len() > 200 || !source_id.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)) { return Err("Choose a registered source".into()); }
 let handle = Arc::clone(state.inner());
 let raw = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
  let reply = handle.request("rag.source", serde_json::json!({"projectId":project_id,"sourceId":source_id}));
  if !reply.ok { return Err(reply.error.map(|e| e.message).unwrap_or_else(|| "Source unavailable".into())); }
  let value = reply.result.ok_or("Source unavailable")?;
  value.get("url").and_then(Value::as_str).map(str::to_owned).ok_or_else(|| "Source unavailable".into())
 }).await.map_err(|e| e.to_string())??;
 let url = knowledge_url(&raw)?;
 #[cfg(windows)]
 { open_registered_source(&url) }
 #[cfg(not(windows))]
 { let _ = url; Err("Open the registered Drive link in your browser".into()) }
}

#[cfg(windows)]
fn open_registered_source(raw: &str) -> Result<(), String> {
 let url = knowledge_url(raw)?;
 let target: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
 let operation: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
 // ShellExecute dispatches the validated HTTPS URI to the registered browser;
 // no shell command, parameters, or caller-controlled executable is involved.
 let result = unsafe { windows_sys::Win32::UI::Shell::ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL) };
 if result as isize <= 32 { Err(format!("Windows could not open the registered Drive source (code {})", result as isize)) } else { Ok(()) }
}

/// Locate a file shipped in the app's `resources/` folder.
fn bundled_resource(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = app.path().resource_dir() { roots.push(dir); }
    if let Ok(exe) = std::env::current_exe() { if let Some(dir) = exe.parent() { roots.push(dir.to_path_buf()); } }
    roots.into_iter().flat_map(|dir| [dir.join("resources").join(name), dir.join(name)]).find(|p| p.is_file())
}

/// What the update folder offers. Read-only; reports problems instead of failing.
#[tauri::command]
async fn update_status(app: tauri::AppHandle) -> Result<update::UpdateStatus, String> {
    let dir = data_dir(&app)?;
    let current = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || update::status(&current, &dir)).await.map_err(|e| e.to_string())
}

/// Install the release the update folder offers, then restart into it.
///
/// Takes no arguments on purpose: the webview cannot choose a path, a version
/// or a package. The package is copied locally and checksum-verified first.
#[tauri::command]
async fn update_install(app: tauri::AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let current = app.package_info().version.to_string();
    let script = bundled_resource(&app, "Install-Pantheon.ps1").ok_or("This build does not include the installer")?;
    let staged = tauri::async_runtime::spawn_blocking(move || update::stage(&current, &dir)).await.map_err(|e| e.to_string())??;
    #[cfg(windows)]
    {
        log::line("update", &format!("installing {} from the update folder", staged.0.version));
        update::launch_installer(&script, &staged.0, &staged.1)?;
        // The installer waits for this process, so leave promptly and cleanly.
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    { let _ = (script, staged); Err("Automatic updates are available on Windows only".into()) }
}

/// Locate the bundled sidecar.
///
/// Resolved from the app's resource directory, never from PATH: launching by
/// bare name would run whatever executable of that name happened to be first on
/// the user's PATH, with this process's privileges.
fn sidecar_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let name = format!("thesmos-runtime{exe_suffix}");

    // Installed layout: Tauri copies bundled resources into the app's resource
    // directory, preserving the `resources/` prefix from tauri.conf.json.
    if let Ok(dir) = app.path().resource_dir() {
        for candidate in [dir.join("resources").join(&name), dir.join(&name)] {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    // Uninstalled layout (`target/release`, `tauri dev`): the sidecar sits in a
    // `resources/` subdirectory beside the shell, not next to it. Checking both
    // keeps a locally-built binary runnable without an install step.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for candidate in [dir.join("resources").join(&name), dir.join(&name)] {
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(RuntimeHandle::new()))
        .manage(ProjectGrants::default())
        .invoke_handler(tauri::generate_handler![runtime_request, update_status, update_install, open_portal, update_choose_folder, update_reset_folder, import_portal_request, choose_project_folder, open_exports, connect_subscription, open_chatgpt, open_google, open_knowledge_source, drive_auth_status, drive_configure, drive_connect, drive_disconnect, drive_sync_now, drive_pause, drive_resume, open_drive_source])
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<Arc<RuntimeHandle>>();
            let dir = data_dir(&handle).map_err(std::io::Error::other)?;
            std::fs::create_dir_all(&dir)?;
            log::init(&dir);
            log::line("shell", &format!("Pantheon {} starting", handle.package_info().version));
            let mut args = vec!["--data-dir".to_string(), dir.to_string_lossy().to_string()];
            if let Ok(text) = std::fs::read_to_string(dir.join("project-grants.json")) {
                if let Ok(saved) = serde_json::from_str::<Value>(&text) {
                    let roots: Vec<PathBuf> = saved.get("roots").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).filter_map(|p| PathBuf::from(p).canonicalize().ok()).collect();
                    if let Some(last) = saved.get("lastRoot").and_then(Value::as_str).and_then(|p| PathBuf::from(p).canonicalize().ok()) {
                        if roots.contains(&last) { args.extend(["--project-root".into(), last.to_string_lossy().to_string()]); }
                    }
                    *app.state::<ProjectGrants>().0.lock().map_err(|_| std::io::Error::other("Project grants unavailable"))? = roots;
                }
            }
            match sidecar_path(&handle) {
                // A missing sidecar is reported through `runtime.health`, not a
                // crash: the shell should open and explain itself rather than
                // vanish on a machine with a broken install.
                Some(path) => {
                    if let Err(err) = state.start_supervised(&path, &args) {
                        log::line("shell", &format!("runtime failed to start: {err}"));
                    }
                }
                None => log::line("shell", "runtime sidecar not found next to the app"),
            }
            let drive = drive::DriveCoordinator::new(dir.join("drive-credentials.dpapi"), Arc::clone(state.inner()));
            drive.start();
            app.manage(drive);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Thesmos")
        .run(|app, event| {
            // Terminate the child on exit so no orphan keeps the memory store open.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                app.state::<Arc<drive::DriveCoordinator>>().shutdown();
                app.state::<Arc<RuntimeHandle>>().shutdown();
            }
        });
}

#[cfg(test)]
mod knowledge_navigation_tests {
 use super::knowledge_url;
 #[test]
 fn registered_google_document_urls_are_supported() {
  for raw in ["https://drive.google.com/file/d/abc-123/view?usp=drivesdk", "https://docs.google.com/document/d/abc_123/edit", "https://docs.google.com/spreadsheets/d/abc/edit#gid=0"] {
   assert!(knowledge_url(raw).is_ok(), "{raw}");
  }
 }
 #[test]
 fn rejects_unregistered_destinations_and_url_injection() {
  for raw in ["https://evil.example/doc", "https://docs.google.com.evil.example/document/d/a/edit", "https://evil@docs.google.com/document/d/a/edit", "http://docs.google.com/document/d/a/edit", "file:///C:/Windows", "https://docs.google.com:444/document/d/a/edit", "https://docs.google.com/document/d/a/edit?next=https://evil.example", "https://docs.google.com/redirect?q=x", "https://drive.google.com/uc?export=download&id=abc", "https://docs.google.com/document/d/a%2Fb/edit", "https://docs.google.com/document/d/a/edit\n--argument"] {
   assert!(knowledge_url(raw).is_err(), "{raw}");
  }
 }
}
#[cfg(test)]
mod drive_security_tests {
 #[test] fn desktop_config_and_callback_are_closed() {
  assert!(crate::drive::parse_config(r#"{"web":{"client_id":"x"}}"#).is_err());
  assert!(crate::drive::callback("GET /oauth/callback?state=wrong&code=abc HTTP/1.1\r\n", "expected", 123).is_err());
 }
 #[test] fn dpapi_roundtrip_and_corruption() {
  let secret=b"fixture-refresh-credential";
  let sealed=crate::drive::protect(secret).unwrap();
  assert!(!sealed.windows(secret.len()).any(|w|w==secret));
  assert_eq!(crate::drive::unprotect(&sealed).unwrap(), secret);
  assert!(crate::drive::unprotect(b"corrupt").is_err());
 }
}

#[tauri::command]
async fn drive_auth_status(state:tauri::State<'_,Arc<drive::DriveCoordinator>>)->Result<drive::AuthStatus,String> {let drive=Arc::clone(state.inner());tauri::async_runtime::spawn_blocking(move||drive.status()).await.map_err(|_|"Google status unavailable".into())}
#[tauri::command]
async fn drive_configure(state:tauri::State<'_,Arc<drive::DriveCoordinator>>,client_config:String)->Result<drive::AuthStatus,String>{let drive=Arc::clone(state.inner());tauri::async_runtime::spawn_blocking(move||drive.configure(&client_config)).await.map_err(|_|"Google configuration unavailable")?}
#[tauri::command]
async fn drive_connect(state:tauri::State<'_,Arc<drive::DriveCoordinator>>)->Result<drive::AuthStatus,String>{let drive=Arc::clone(state.inner());tauri::async_runtime::spawn_blocking(move||drive.connect()).await.map_err(|_|"Google sign-in unavailable")?}
#[tauri::command]
async fn drive_disconnect(state:tauri::State<'_,Arc<drive::DriveCoordinator>>)->Result<drive::AuthStatus,String>{let drive=Arc::clone(state.inner());tauri::async_runtime::spawn_blocking(move||{drive.disconnect()?;Ok(drive.status())}).await.map_err(|_|"Google disconnect unavailable")?}
#[tauri::command]
async fn drive_sync_now(state:tauri::State<'_,Arc<drive::DriveCoordinator>>)->Result<Value,String>{let drive=Arc::clone(state.inner());tauri::async_runtime::spawn_blocking(move||drive.sync(true)).await.map_err(|_|"Google sync unavailable")?}
#[tauri::command]
async fn drive_pause(state:tauri::State<'_,Arc<drive::DriveCoordinator>>)->Result<Value,String>{let drive=Arc::clone(state.inner());tauri::async_runtime::spawn_blocking(move||drive.control("drive.pause")).await.map_err(|_|"Google pause unavailable")?}
#[tauri::command]
async fn drive_resume(state:tauri::State<'_,Arc<drive::DriveCoordinator>>)->Result<Value,String>{let drive=Arc::clone(state.inner());tauri::async_runtime::spawn_blocking(move||drive.sync(true)).await.map_err(|_|"Google resume unavailable")?}
#[tauri::command]
async fn open_drive_source(state:tauri::State<'_,Arc<RuntimeHandle>>,source_id:String)->Result<(),String>{
 if source_id.is_empty() || source_id.len()>200 || !source_id.bytes().all(|b|b.is_ascii_alphanumeric() || b"_-:".contains(&b)){return Err("Choose a registered Drive source".into());}
 let handle=Arc::clone(state.inner());let raw=tauri::async_runtime::spawn_blocking(move||->Result<String,String>{let reply=handle.request("drive.source",serde_json::json!({"sourceId":source_id}));if !reply.ok{return Err("Drive source unavailable".into());}reply.result.and_then(|v|v.get("url").and_then(Value::as_str).map(str::to_owned)).ok_or("Drive source unavailable".into())}).await.map_err(|_|"Drive source unavailable")??;
 let url=knowledge_url(&raw)?;
 #[cfg(windows)]{open_registered_source(&url)}
 #[cfg(not(windows))]{let _=url;Err("Open the registered Drive link in your browser".into())}
}


