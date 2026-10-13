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
use std::sync::atomic::{AtomicU64, Ordering};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Methods the shell will relay. Anything else is refused before it reaches
/// the sidecar, so a compromised webview cannot reach an unlisted capability
/// even if the sidecar were later to grow one.
const ALLOWED_METHODS: &[&str] = &[
    "drive.status", "drive.files", "drive.search", "drive.source",
    "runtime.health",
    "runtime.shutdown",
    "providers.list",
    "memory.search",
    "memory.stats",
    "project.open",
    "pantheon.list",
    "channel.get",
    "channel.postMessage",
    "channel.getMessages",
    "studio.snapshot",
    "brief.read",
    "finance.read", "finance.preview", "finance.commit", "finance.backup",
    "chat.list", "chat.get", "chat.create", "chat.send", "chat.stop", "chat.delete",
    "studio.knowledge",
    "rag.status", "rag.rebuild", "rag.cancel", "rag.search", "rag.source",
    "studio.backup",
    "studio.artifact",
    "studio.connections",
    "studio.createJob",
    "studio.runJob",
    "studio.cancelJob",
    "studio.reviewJob",
    "studio.exportJob",
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
type Pending = Arc<Mutex<HashMap<String, (u64, Sender<Value>)>>>;

/// Remove the subscription on every exit, including failed writes and timeouts.
struct PendingSlot {
    pending: Pending,
    id: String,
}

impl Drop for PendingSlot {
    fn drop(&mut self) {
        if let Ok(mut map) = self.pending.lock() {
            map.remove(&self.id);
        }
    }
}

pub struct RuntimeHandle {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<(ChildStdin, u64)>>,
    pending: Pending,
    next_id: Mutex<u64>,
    generation: AtomicU64,
    /// How to relaunch the sidecar. Present only for a supervised runtime, and
    /// cleared on shutdown so an exiting app never respawns its child.
    launch: Mutex<Option<(PathBuf, Vec<String>)>>,
    restarts: Mutex<Vec<Instant>>,
}

/// A runtime that keeps dying is broken, not unlucky: stop relaunching it and
/// let the error reach the user.
const MAX_RESTARTS: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(60);

impl RuntimeHandle {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Mutex::new(0),
            generation: AtomicU64::new(0),
            launch: Mutex::new(None),
            restarts: Mutex::new(Vec::new()),
        }
    }

    /// Start the sidecar and remember how, so a crashed runtime is relaunched
    /// by the next request instead of leaving the app dead until it is reopened.
    pub fn start_supervised(&self, program: &Path, args: &[String]) -> Result<(), String> {
        if let Ok(mut launch) = self.launch.lock() {
            *launch = Some((program.to_path_buf(), args.to_vec()));
        }
        self.start(program, args)
    }

    /// Relaunch a supervised runtime that has exited. Interrupted work is not
    /// replayed: the store marks it failed on open and the user retries it.
    fn ensure_running(&self) {
        let Some((program, args)) = self.launch.lock().ok().and_then(|l| l.clone()) else { return };
        let exited = match self.child.lock() {
            Ok(mut guard) => match guard.as_mut() {
                Some(child) => !matches!(child.try_wait(), Ok(None)),
                None => true,
            },
            Err(_) => return,
        };
        if !exited { return; }
        {
            let Ok(mut restarts) = self.restarts.lock() else { return };
            let now = Instant::now();
            restarts.retain(|at| now.duration_since(*at) < RESTART_WINDOW);
            if restarts.len() >= MAX_RESTARTS { return; }
            restarts.push(now);
        }
        match self.start(&program, &args) {
            Ok(()) => crate::log::line("runtime", "runtime had stopped; relaunched"),
            Err(err) => crate::log::line("runtime", &format!("relaunch failed: {err}")),
        }
    }

    /// Spawn the sidecar and start the reader thread.
    ///
    /// `program` is resolved by the caller from the bundled resource directory,
    /// never from PATH — resolving by name would let an unrelated executable of
    /// the same name be launched with this process's privileges.
    pub fn start(&self, program: &std::path::Path, args: &[String]) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|_| "runtime lock poisoned")?;
        if let Some(child) = guard.as_mut() {
            if child.try_wait().map_err(|e| format!("could not check Thesmos runtime: {e}"))?.is_none() {
                return Ok(());
            }
        }
        // Lock before spawning so a poisoned input lock cannot orphan a child.
        let mut input = self.stdin.lock().map_err(|_| "stdin lock poisoned")?;
        *input = None;
        *guard = None;

        let mut command = Command::new(program);
        command.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW for the noninteractive runtime.
        }
        let mut child = command.spawn()
            .map_err(|e| format!("failed to start Thesmos runtime: {e}"))?;

        let stdout = child.stdout.take().ok_or("runtime produced no stdout")?;
        let stdin = child.stdin.take().ok_or("runtime accepted no stdin")?;
        // Drain stderr so provider diagnostics cannot fill the pipe and deadlock IPC.
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    crate::log::line("runtime-stderr", &line);
                }
            });
        }

        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        let pending = Arc::clone(&self.pending);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                // Event frames carry no id and belong to no waiter.
                let Some(id) = value.get("id").and_then(Value::as_str) else {
                    // Uncaught runtime errors arrive as events; record them
                    // instead of dropping the only evidence of the failure.
                    if value.get("event").and_then(Value::as_str) == Some("runtime.error") {
                        let message = value.pointer("/payload/message").and_then(Value::as_str).unwrap_or("unknown error");
                        crate::log::line("runtime-error", message);
                    }
                    continue;
                };
                if let Ok(mut map) = pending.lock() {
                    if let Some((_, tx)) = map.remove(id) {
                        let _ = tx.send(value);
                    }
                }
            }
            crate::log::line("runtime", "runtime output stream closed");
            // Stream closed: release every waiter rather than leaving the UI
            // blocked on a runtime that has gone.
            if let Ok(mut map) = pending.lock() {
                // An old reader can finish after a replacement starts. It must
                // release only its own waiters, never those of the new child.
                map.retain(|_, (owner, tx)| {
                    if *owner != generation { return true; }
                    let _ = tx.send(json!({ "ok": false, "error": {
                        "code": "runtime_closed",
                        "message": "the Thesmos runtime stopped"
                    }}));
                    false
                });
            }
        });

        *input = Some((stdin, generation));
        *guard = Some(child);
        Ok(())
    }

    pub fn request(&self, method: &str, params: Value) -> RuntimeReply {
        if !ALLOWED_METHODS.contains(&method) {
            return RuntimeReply::err("method_not_allowed", format!("method \"{method}\" is not exposed"));
        }

        self.request_internal(method, params)
    }
    pub(crate) fn request_internal(&self, method: &str, params: Value) -> RuntimeReply {
        if method != "runtime.shutdown" { self.ensure_running(); }
        let id = {
            let mut n = match self.next_id.lock() {
                Ok(n) => n,
                Err(_) => return RuntimeReply::err("internal", "id lock poisoned"),
            };
            *n += 1;
            format!("r{n}")
        };

        let (tx, rx): (Sender<Value>, Receiver<Value>) = channel();
        let frame = json!({ "id": id, "method": method, "params": params }).to_string();
        let _slot = PendingSlot { pending: Arc::clone(&self.pending), id: id.clone() };
        {
            let mut guard = match self.stdin.lock() {
                Ok(g) => g,
                Err(_) => return RuntimeReply::err("internal", "stdin lock poisoned"),
            };
            let Some((stdin, generation)) = guard.as_mut() else {
                return RuntimeReply::err("runtime_not_started", "the Thesmos runtime is not running");
            };
            // Subscribe while holding the input lock: start cannot switch the
            // child between registering the request and writing its frame.
            match self.pending.lock() {
                Ok(mut map) => { map.insert(id.clone(), (*generation, tx)); }
                Err(_) => return RuntimeReply::err("internal", "pending lock poisoned"),
            }
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
        if let Ok(mut launch) = self.launch.lock() { *launch = None; }
        let _ = self.request("runtime.shutdown", json!({}));
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                // Give the runtime time to checkpoint and close its databases.
                // Killing it after a fixed 120 ms left every write in the WAL.
                let deadline = Instant::now() + Duration::from_secs(3);
                let mut exited = false;
                while Instant::now() < deadline {
                    if let Ok(Some(_)) = child.try_wait() { exited = true; break; }
                    std::thread::sleep(Duration::from_millis(25));
                }
                if !exited {
                    crate::log::line("runtime", "runtime did not exit in time; terminating it");
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            *guard = None;
        }
        if let Ok(mut guard) = self.stdin.lock() {
            *guard = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Instant;

    fn node() -> PathBuf {
        std::env::var_os("PANTHEON_TEST_NODE").map(PathBuf::from).unwrap_or_else(|| {
            if cfg!(windows) {
                PathBuf::from(std::env::var_os("ProgramFiles").unwrap()).join("nodejs/node.exe")
            } else {
                PathBuf::from("/usr/bin/node")
            }
        })
    }

    fn start_helper(handle: &RuntimeHandle, script: &str) {
        handle.start(&node(), &["-e".into(), script.into()]).unwrap();
    }

    const ECHO: &str = r#"
        let count = 0;
        require('readline').createInterface({input:process.stdin}).on('line', line => {
            const frame = JSON.parse(line);
            process.stdout.write('not-json\n' + JSON.stringify({event:'notice'}) + '\n');
            process.stdout.write(JSON.stringify({id:frame.id,ok:true,result:{count:++count,params:frame.params}})+'\n');
            if (frame.method === 'runtime.shutdown') process.exit(0);
        });
    "#;

    fn error(reply: RuntimeReply) -> String {
        assert!(!reply.ok);
        reply.error.unwrap().code
    }

    fn wait_for_exit(handle: &RuntimeHandle) {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if handle.child.lock().unwrap().as_mut().unwrap().try_wait().unwrap().is_some() { break; }
            assert!(Instant::now() < deadline, "helper did not exit");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn absent_runtime_does_not_retain_failed_requests() {
        let handle = RuntimeHandle::new();
        for _ in 0..3 {
            assert_eq!(error(handle.request("runtime.health", json!({}))), "runtime_not_started");
        }
        assert!(handle.pending.lock().unwrap().is_empty());
    }

    #[test]
    fn poisoned_stdin_does_not_retain_failed_requests() {
        let handle = RuntimeHandle::new();
        let _ = std::panic::catch_unwind(|| {
            let _guard = handle.stdin.lock().unwrap();
            panic!("poison stdin");
        });
        assert_eq!(error(handle.request("runtime.health", json!({}))), "internal");
        assert!(handle.pending.lock().unwrap().is_empty());
    }

    #[test]
    fn real_helper_correlates_replies_and_rejects_unallowed_methods() {
        let handle = RuntimeHandle::new();
        start_helper(&handle, ECHO);
        assert_eq!(error(handle.request("shell.exec", json!({}))), "method_not_allowed");
        let reply = handle.request("runtime.health", json!({"marker":"native-test"}));
        assert!(reply.ok);
        assert_eq!(reply.result.unwrap(), json!({"count":1,"params":{"marker":"native-test"}}));
        handle.shutdown();
        assert!(handle.pending.lock().unwrap().is_empty());
    }

    #[test]
    fn private_drive_frames_never_reach_sidecar_from_browser_requests() {
        let handle=RuntimeHandle::new();start_helper(&handle,ECHO);
        for method in ["drive.session","drive.sync","drive.disconnect","drive.pause","drive.resume","drive.authState"] {
            let reply=handle.request(method,json!({"accessToken":"fixture-private-token"}));
            let serialized=serde_json::to_string(&reply).unwrap();assert!(!serialized.contains("fixture-private-token"));assert_eq!(error(reply),"method_not_allowed");
        }
        assert_eq!(handle.request("drive.status",json!({})).result.unwrap()["count"],1);
        handle.shutdown();
    }

    #[test]
    fn crash_releases_waiters_and_restart_does_not_replay_requests() {
        let handle = RuntimeHandle::new();
        start_helper(&handle, "require('readline').createInterface({input:process.stdin}).on('line',()=>process.exit(17));");
        let before = Instant::now();
        assert_eq!(error(handle.request("runtime.health", json!({"old":true}))), "runtime_closed");
        assert!(before.elapsed() < Duration::from_secs(5));
        wait_for_exit(&handle);
        start_helper(&handle, ECHO);
        let reply = handle.request("runtime.health", json!({"new":true}));
        assert!(reply.ok, "restart failed: {reply:?}");
        assert_eq!(reply.result.unwrap(), json!({"count":1,"params":{"new":true}}));
        handle.shutdown();
    }

    const CRASH_ON_DEMAND: &str = r#"
        require('readline').createInterface({input:process.stdin}).on('line', line => {
            const frame = JSON.parse(line);
            if (frame.params && frame.params.crash) process.exit(17);
            process.stdout.write(JSON.stringify({id:frame.id,ok:true,result:{pid:process.pid}})+'\n');
            if (frame.method === 'runtime.shutdown') process.exit(0);
        });
    "#;

    #[test]
    fn supervised_runtime_is_relaunched_after_a_crash() {
        let handle = RuntimeHandle::new();
        handle.start_supervised(&node(), &["-e".into(), CRASH_ON_DEMAND.into()]).unwrap();
        let first = handle.request("runtime.health", json!({})).result.unwrap()["pid"].clone();
        assert_eq!(error(handle.request("runtime.health", json!({"crash":true}))), "runtime_closed");
        wait_for_exit(&handle);
        let reply = handle.request("runtime.health", json!({}));
        assert!(reply.ok, "runtime was not relaunched: {reply:?}");
        assert_ne!(reply.result.unwrap()["pid"], first);
        handle.shutdown();
        // Shutdown ends supervision: nothing is relaunched afterwards.
        assert_eq!(error(handle.request("runtime.health", json!({}))), "runtime_not_started");
    }

    #[test]
    fn relaunch_is_bounded_when_the_runtime_keeps_dying() {
        let handle = RuntimeHandle::new();
        handle.start_supervised(&node(), &["-e".into(), "process.exit(19);".into()]).unwrap();
        for _ in 0..(MAX_RESTARTS + 3) {
            wait_for_exit(&handle);
            std::thread::sleep(Duration::from_millis(60));
            assert!(!handle.request("runtime.health", json!({})).ok);
        }
        assert_eq!(handle.restarts.lock().unwrap().len(), MAX_RESTARTS);
        handle.shutdown();
    }

    #[test]
    fn broken_pipe_does_not_retain_failed_requests() {
        let handle = RuntimeHandle::new();
        start_helper(&handle, "process.exit(19);");
        wait_for_exit(&handle);
        // Wait until the reader has finished its one-time drain; the next
        // request must clean up its own slot when writing to the closed pipe.
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(error(handle.request("runtime.health", json!({}))), "runtime_unreachable");
        assert!(handle.pending.lock().unwrap().is_empty());
        handle.shutdown();
    }

    #[test]
    fn retiring_reader_does_not_release_replacement_waiters() {
        let handle = RuntimeHandle::new();
        // Hold the map until a replacement subscription exists. This forces
        // the retiring real-process reader to handle EOF after the restart.
        let mut map = handle.pending.lock().unwrap();
        start_helper(&handle, "process.exit(17);");
        let old_generation = handle.stdin.lock().unwrap().as_ref().unwrap().1;
        let (old_tx, old_rx) = channel();
        map.insert("old-probe".into(), (old_generation, old_tx));
        wait_for_exit(&handle);
        start_helper(&handle, ECHO);
        let generation = handle.stdin.lock().unwrap().as_ref().unwrap().1;
        let (tx, rx) = channel();
        map.insert("replacement-probe".into(), (generation, tx));
        drop(map);
        assert_eq!(old_rx.recv_timeout(Duration::from_secs(5)).unwrap()["error"]["code"], "runtime_closed");
        assert!(handle.pending.lock().unwrap().contains_key("replacement-probe"));
        {
            let mut input = handle.stdin.lock().unwrap();
            let stdin = &mut input.as_mut().unwrap().0;
            writeln!(stdin, "{}", json!({"id":"replacement-probe","method":"runtime.health","params":{}})).unwrap();
            stdin.flush().unwrap();
        }
        let reply = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(reply["ok"], true);
        handle.shutdown();
        assert!(handle.pending.lock().unwrap().is_empty());
    }
}
#[cfg(test)]
mod rag_method_tests {
 use super::ALLOWED_METHODS;
 #[test]
 fn local_knowledge_operations_have_closed_native_routes() {
  for method in ["rag.status", "rag.rebuild", "rag.cancel", "rag.search", "rag.source"] { assert!(ALLOWED_METHODS.contains(&method), "{method}"); }
  assert!(!ALLOWED_METHODS.contains(&"rag.writeDrive"));
 }
 #[test]
 fn tokens_and_native_controls_are_absent_from_webview_allowlist() {
  for method in ["drive.status","drive.files","drive.search","drive.source"] {assert!(ALLOWED_METHODS.contains(&method));}
  for method in ["drive.session","drive.sync","drive.pause","drive.resume","drive.disconnect","drive.authState"] {assert!(!ALLOWED_METHODS.contains(&method));}
 }
}

