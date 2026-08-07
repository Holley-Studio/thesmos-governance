// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
//! Thesmos Runtime sidecar supervision.
//!
//! Owns one long-lived child process and the correlation of requests to
//! responses over its stdio pipes. The webview never sees the process, the
//! pipes, or a port — it sees two Tauri commands.
//!
//! Why stdio and not a local HTTP server: a port is reachable by every process
//! on the machine and would need its own authentication story. An inherited
//! pipe is reachable only by this parent. Narrower boundary, less to defend.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Methods the shell will relay. Anything else is refused before it reaches
/// the sidecar, so a compromised webview cannot reach an unlisted capability
/// even if the sidecar were later to grow one.
const ALLOWED_METHODS: &[&str] = &[
    "runtime.health",
    "runtime.shutdown",
    "providers.list",
    "memory.search",
    "memory.stats",
    "project.open",
    "pantheon.list",
];

#[derive(Debug, Serialize, Deserialize)]
pub struct RuntimeReply {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RuntimeErr>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RuntimeErr {
    pub code: String,
    pub message: String,
}

impl RuntimeReply {
    fn ok(result: Value) -> Self {
        Self { ok: true, result: Some(result), error: None }
    }
    fn err(code: &str, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            result: None,
            error: Some(RuntimeErr { code: code.into(), message: message.into() }),
        }
    }
}

/// Pending request slots, keyed by request id.
type Pending = Arc<Mutex<HashMap<String, Sender<Value>>>>;

pub struct RuntimeHandle {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    pending: Pending,
    next_id: Mutex<u64>,
}

impl RuntimeHandle {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Mutex::new(0),
        }
    }

    /// Spawn the sidecar and start the reader thread.
    ///
    /// `program` is resolved by the caller from the bundled resource directory,
    /// never from PATH — resolving by name would let an unrelated executable of
    /// the same name be launched with this process's privileges.
    pub fn start(&self, program: &std::path::Path, args: &[String]) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|_| "runtime lock poisoned")?;
        if guard.is_some() {
            return Ok(());
        }

        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to start Thesmos runtime: {e}"))?;

        let stdout = child.stdout.take().ok_or("runtime produced no stdout")?;
        let stdin = child.stdin.take().ok_or("runtime accepted no stdin")?;

        let pending = Arc::clone(&self.pending);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                // Event frames carry no id and belong to no waiter.
                let Some(id) = value.get("id").and_then(Value::as_str) else {
                    continue;
                };
                if let Ok(mut map) = pending.lock() {
                    if let Some(tx) = map.remove(id) {
                        let _ = tx.send(value);
                    }
                }
            }
            // Stream closed: release every waiter rather than leaving the UI
            // blocked on a runtime that has gone.
            if let Ok(mut map) = pending.lock() {
                for (_, tx) in map.drain() {
                    let _ = tx.send(json!({ "ok": false, "error": {
                        "code": "runtime_closed",
                        "message": "the Thesmos runtime stopped"
                    }}));
                }
            }
        });

        *self.stdin.lock().map_err(|_| "stdin lock poisoned")? = Some(stdin);
        *guard = Some(child);
        Ok(())
    }

    pub fn request(&self, method: &str, params: Value) -> RuntimeReply {
        if !ALLOWED_METHODS.contains(&method) {
            return RuntimeReply::err("method_not_allowed", format!("method \"{method}\" is not exposed"));
        }

        let id = {
            let mut n = match self.next_id.lock() {
                Ok(n) => n,
                Err(_) => return RuntimeReply::err("internal", "id lock poisoned"),
            };
            *n += 1;
            format!("r{n}")
        };

        let (tx, rx): (Sender<Value>, Receiver<Value>) = channel();
        match self.pending.lock() {
            Ok(mut map) => {
                map.insert(id.clone(), tx);
            }
            Err(_) => return RuntimeReply::err("internal", "pending lock poisoned"),
        }

        let frame = json!({ "id": id, "method": method, "params": params }).to_string();
        {
            let mut guard = match self.stdin.lock() {
                Ok(g) => g,
                Err(_) => return RuntimeReply::err("internal", "stdin lock poisoned"),
            };
            let Some(stdin) = guard.as_mut() else {
                return RuntimeReply::err("runtime_not_started", "the Thesmos runtime is not running");
            };
            if writeln!(stdin, "{frame}").is_err() || stdin.flush().is_err() {
                return RuntimeReply::err("runtime_unreachable", "could not reach the Thesmos runtime");
            }
        }

        // Bounded wait: a hung runtime must surface as an error the UI can show,
        // never as a permanently spinning view.
        match rx.recv_timeout(Duration::from_secs(30)) {
            Ok(value) => {
                if value.get("ok").and_then(Value::as_bool) == Some(true) {
                    RuntimeReply::ok(value.get("result").cloned().unwrap_or(Value::Null))
                } else {
                    let err = value.get("error");
                    RuntimeReply::err(
                        err.and_then(|e| e.get("code")).and_then(Value::as_str).unwrap_or("unknown"),
                        err.and_then(|e| e.get("message"))
                            .and_then(Value::as_str)
                            .unwrap_or("runtime error")
                            .to_string(),
                    )
                }
            }
            Err(_) => {
                if let Ok(mut map) = self.pending.lock() {
                    map.remove(&id);
                }
                RuntimeReply::err("timeout", "the Thesmos runtime did not respond")
            }
        }
    }

    /// Ask politely, then insist.
    ///
    /// A sidecar left running after the window closes is an orphan holding the
    /// memory store open, so the kill is unconditional if the request path is
    /// already gone.
    pub fn shutdown(&self) {
        let _ = self.request("runtime.shutdown", json!({}));
        std::thread::sleep(Duration::from_millis(120));
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                match child.try_wait() {
                    Ok(Some(_)) => {}
                    _ => {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
            *guard = None;
        }
        if let Ok(mut guard) = self.stdin.lock() {
            *guard = None;
        }
    }
}
