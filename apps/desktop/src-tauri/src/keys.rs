// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
//! API keys for the pay-per-use engines.
//!
//! The shell is the only holder. Keys are sealed with Windows DPAPI in
//! `<data dir>/api-keys.dpapi`, so they open only for this Windows account, and
//! are handed to the runtime over the private pipe with `providers.session`.
//! The webview can save or remove a key and ask which providers have one. It
//! can never read a key back, and nothing here logs one.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use crate::drive::{protect, unprotect};
use crate::runtime::{RuntimeHandle, RuntimeReply};

pub(crate) const PROVIDERS: [&str; 3] = ["claude-api", "openai-api", "gemini-api"];

pub(crate) struct ApiKeys {
    keys: Mutex<BTreeMap<String, String>>,
    runtime: Arc<RuntimeHandle>,
    path: PathBuf,
    /// The runtime generation that last received every key. Zero means none has.
    pushed: AtomicU64,
}

fn provider(raw: &str) -> Result<&'static str, String> {
    PROVIDERS.iter().copied().find(|p| *p == raw).ok_or_else(|| "Choose Claude API, OpenAI API or Gemini API".into())
}

/// Shape only: printable ASCII with no spaces, 20 to 300 characters. Whether the
/// provider accepts it is learned when the user lists models.
fn valid_key(key: &str) -> bool {
    (20..=300).contains(&key.len()) && key.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

impl ApiKeys {
    /// An unreadable or damaged file starts empty: the user saves the key again.
    pub fn new(path: PathBuf, runtime: Arc<RuntimeHandle>) -> Arc<Self> {
        let keys = std::fs::read(&path).ok()
            .and_then(|sealed| unprotect(&sealed).ok())
            .and_then(|plain| serde_json::from_slice::<BTreeMap<String, String>>(&plain).ok())
            .map(|saved| saved.into_iter().filter(|(p, k)| PROVIDERS.contains(&p.as_str()) && valid_key(k)).collect())
            .unwrap_or_default();
        Arc::new(Self { keys: Mutex::new(keys), runtime, path, pushed: AtomicU64::new(0) })
    }

    fn save(&self, keys: &BTreeMap<String, String>) -> Result<(), String> {
        if keys.is_empty() {
            return match std::fs::remove_file(&self.path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err("Could not remove the saved API key".into()),
                _ => Ok(()),
            };
        }
        let sealed = protect(&serde_json::to_vec(keys).map_err(|_| "API key unavailable")?).map_err(|_| "Windows could not protect the API key")?;
        let temp = self.path.with_extension("dpapi.tmp");
        std::fs::write(&temp, sealed).map_err(|_| "Could not save the protected API key")?;
        std::fs::rename(&temp, &self.path).map_err(|_| { let _ = std::fs::remove_file(&temp); "Could not save the protected API key".to_string() })
    }

    /// Which providers have a key. Booleans only.
    pub fn status(&self) -> Value {
        let keys = self.keys.lock().ok();
        Value::Object(PROVIDERS.iter().map(|p| ((*p).to_string(), Value::Bool(keys.as_ref().is_some_and(|k| k.contains_key(*p))))).collect())
    }

    fn push(&self, provider: &str, key: Option<&str>) -> RuntimeReply {
        self.runtime.request_internal("providers.session", json!({ "provider": provider, "apiKey": key }))
    }

    /// Seal first, then hand over: a key the disk refused is never left in use.
    pub fn set(&self, raw_provider: &str, key: &str) -> Result<Value, String> {
        let provider = provider(raw_provider)?;
        if !valid_key(key) { return Err("That does not look like an API key. Paste the key exactly, with no spaces.".into()); }
        {
            let mut keys = self.keys.lock().map_err(|_| "API keys unavailable")?;
            let mut next = keys.clone();
            next.insert(provider.into(), key.into());
            self.save(&next)?;
            *keys = next;
        }
        // A refused hand-over is retried by the next sync rather than left stale.
        if !self.push(provider, Some(key)).ok { self.pushed.store(0, Ordering::Relaxed); return Err("The key was saved, but the runtime did not accept it. Reopen Pantheon.".into()); }
        Ok(self.status())
    }

    pub fn clear(&self, raw_provider: &str) -> Result<Value, String> {
        let provider = provider(raw_provider)?;
        {
            let mut keys = self.keys.lock().map_err(|_| "API keys unavailable")?;
            let mut next = keys.clone();
            next.remove(provider);
            self.save(&next)?;
            *keys = next;
        }
        // Removal is pushed even when nothing was saved, so the runtime cannot keep a stale key.
        let _ = self.push(provider, None);
        Ok(self.status())
    }

    /// Hand every saved key to the runtime when it is new: at startup and after
    /// a relaunch, because the runtime keeps keys in memory only.
    pub fn sync(&self) {
        self.runtime.ensure_running();
        let generation = self.runtime.generation();
        if generation == 0 || self.pushed.load(Ordering::Relaxed) == generation { return; }
        let Ok(keys) = self.keys.lock().map(|k| k.clone()) else { return };
        if keys.iter().all(|(provider, key)| self.push(provider, Some(key)).ok) {
            self.pushed.store(generation, Ordering::Relaxed);
        } else {
            crate::log::line("keys", "the runtime did not accept a saved API key; it will be offered again");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "fixture-api-key-0123456789abcdef";

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pantheon-api-keys-{}-{:?}", std::process::id(), std::thread::current().id()).replace(['(', ')'], ""));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Replies with the frame it received, so a test can see exactly what crossed the pipe.
    fn echo() -> Arc<RuntimeHandle> {
        let node = std::env::var_os("PANTHEON_TEST_NODE").map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(std::env::var_os("ProgramFiles").unwrap()).join("nodejs/node.exe"));
        let runtime = Arc::new(RuntimeHandle::new());
        runtime.start(&node, &["-e".into(), "const seen=[];require('readline').createInterface({input:process.stdin}).on('line',line=>{const f=JSON.parse(line);if(f.method!=='runtime.health')seen.push({method:f.method,params:f.params});process.stdout.write(JSON.stringify({id:f.id,ok:true,result:{seen}})+'\\n');if(f.method==='runtime.shutdown')process.exit(0);});".into()]).unwrap();
        runtime
    }

    fn seen(runtime: &RuntimeHandle) -> Value { runtime.request("runtime.health", json!({})).result.unwrap()["seen"].clone() }

    #[test]
    fn key_shape_and_provider_are_validated_before_anything_is_stored() {
        let dir = temp();
        let keys = ApiKeys::new(dir.join("api-keys.dpapi"), Arc::new(RuntimeHandle::new()));
        for bad in ["", "short", "has a space in the middle 0123456789", "tab\there-0123456789-0123456789", "line\nbreak-0123456789-0123456789", "ünïcödé-0123456789-0123456789", &"x".repeat(301)] {
            assert!(keys.set("claude-api", bad).is_err(), "{bad:?}");
        }
        for bad in ["", "claude", "codex", "ollama", "Claude-API", "../claude-api"] {
            assert!(keys.set(bad, SECRET).is_err(), "{bad:?}");
            assert!(keys.clear(bad).is_err(), "{bad:?}");
        }
        assert!(!dir.join("api-keys.dpapi").exists());
        assert_eq!(keys.status(), json!({"claude-api":false,"openai-api":false,"gemini-api":false}));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn keys_are_sealed_on_disk_survive_a_restart_and_never_appear_in_status_or_errors() {
        let dir = temp();
        let path = dir.join("api-keys.dpapi");
        let runtime = echo();
        let keys = ApiKeys::new(path.clone(), Arc::clone(&runtime));
        let status = keys.set("openai-api", SECRET).unwrap();
        assert_eq!(status, json!({"claude-api":false,"openai-api":true,"gemini-api":false}));
        assert!(!serde_json::to_string(&status).unwrap().contains("fixture"));
        let stored = std::fs::read(&path).unwrap();
        assert!(!stored.windows(SECRET.len()).any(|w| w == SECRET.as_bytes()));
        assert!(!dir.join("api-keys.dpapi.tmp").exists());
        // The key crossed the private pipe once, under the native-only method.
        assert_eq!(seen(&runtime), json!([{"method":"providers.session","params":{"provider":"openai-api","apiKey":SECRET}}]));
        runtime.shutdown();

        // A new shell and a new runtime: the sealed key is read back and offered again, once.
        let runtime = echo();
        let restarted = ApiKeys::new(path.clone(), Arc::clone(&runtime));
        assert_eq!(restarted.status()["openai-api"], true);
        restarted.sync();
        restarted.sync();
        assert_eq!(seen(&runtime), json!([{"method":"providers.session","params":{"provider":"openai-api","apiKey":SECRET}}]));

        let cleared = restarted.clear("openai-api").unwrap();
        assert_eq!(cleared["openai-api"], false);
        assert!(!path.exists());
        assert_eq!(seen(&runtime)[1], json!({"method":"providers.session","params":{"provider":"openai-api","apiKey":null}}));
        for error in [restarted.set("openai-api", "bad key with spaces 0123456789").unwrap_err(), restarted.set("nope", SECRET).unwrap_err()] {
            assert!(!error.contains("fixture") && !error.contains("0123456789"), "{error}");
        }
        runtime.shutdown();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_damaged_or_foreign_file_reads_as_no_keys() {
        let dir = temp();
        let path = dir.join("api-keys.dpapi");
        std::fs::write(&path, b"not a sealed file").unwrap();
        assert_eq!(ApiKeys::new(path.clone(), Arc::new(RuntimeHandle::new())).status()["claude-api"], false);
        std::fs::write(&path, protect(br#"{"claude-api":"short","shell":"fixture-api-key-0123456789abcdef"}"#).unwrap()).unwrap();
        assert_eq!(ApiKeys::new(path, Arc::new(RuntimeHandle::new())).status(), json!({"claude-api":false,"openai-api":false,"gemini-api":false}));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_key_saved_while_the_runtime_is_down_is_kept_and_reported_without_the_key() {
        let dir = temp();
        let keys = ApiKeys::new(dir.join("api-keys.dpapi"), Arc::new(RuntimeHandle::new()));
        if cfg!(windows) {
            let error = keys.set("gemini-api", SECRET).unwrap_err();
            assert!(error.contains("saved") && !error.contains("fixture"));
            assert_eq!(keys.status()["gemini-api"], true);
            keys.sync(); // No runtime: nothing to push, nothing panics.
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
