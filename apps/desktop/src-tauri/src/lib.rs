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

use runtime::{RuntimeHandle, RuntimeReply};
use serde_json::Value;
use tauri::{Manager, RunEvent};

/// Relay a typed request to the runtime. The only data path the UI has.
#[tauri::command]
async fn runtime_request(
    state: tauri::State<'_, RuntimeHandle>,
    method: String,
    params: Value,
) -> Result<RuntimeReply, String> {
    Ok(state.request(&method, params))
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
    rx.recv().map_err(|e| e.to_string())
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
        .plugin(tauri_plugin_dialog::init())
        .manage(RuntimeHandle::new())
        .invoke_handler(tauri::generate_handler![runtime_request, choose_project_folder])
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<RuntimeHandle>();
            match sidecar_path(&handle) {
                // A missing sidecar is reported through `runtime.health`, not a
                // crash: the shell should open and explain itself rather than
                // vanish on a machine with a broken install.
                Some(path) => {
                    if let Err(err) = state.start(&path, &[]) {
                        eprintln!("[thesmos] runtime failed to start: {err}");
                    }
                }
                None => eprintln!("[thesmos] runtime sidecar not found next to the app"),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Thesmos")
        .run(|app, event| {
            // Terminate the child on exit so no orphan keeps the memory store open.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                app.state::<RuntimeHandle>().shutdown();
            }
        });
}
