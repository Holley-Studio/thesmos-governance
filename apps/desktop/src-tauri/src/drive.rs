//! Native-only Google authorization and user-bound credential vault.
use crate::runtime::RuntimeHandle;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
const AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN: &str = "https://oauth2.googleapis.com/token";
const IDENTITY: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPE: &str = "openid email https://www.googleapis.com/auth/drive.readonly";
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct ClientConfig {
    client_id: String,
    client_secret: String,
}
pub(crate) fn parse_config(raw: &str) -> Result<ClientConfig, String> {
    if raw.len() > 16384 {
        return Err("Choose a Google Desktop OAuth client JSON".into());
    }
    let value: Value = serde_json::from_str(raw).map_err(|_| "Invalid OAuth client JSON")?;
    let installed = value
        .get("installed")
        .ok_or("Choose a Desktop app OAuth client, not a web client")?;
    let cfg: ClientConfig = serde_json::from_value(installed.clone())
        .map_err(|_| "OAuth client ID and secret are required")?;
    if !cfg.client_id.ends_with(".apps.googleusercontent.com")
        || cfg.client_id.len() > 256
        || !cfg
            .client_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
        || cfg.client_secret.is_empty()
        || cfg.client_secret.len() > 256
        || cfg.client_secret.bytes().any(|b| b.is_ascii_control())
    {
        return Err("Invalid Google Desktop OAuth client".into());
    }
    for (key, expected) in [
        ("auth_uri", "https://accounts.google.com/o/oauth2/auth"),
        ("token_uri", TOKEN),
    ] {
        if installed
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|s| s != expected)
        {
            return Err("OAuth endpoints must be Google's official endpoints".into());
        }
    }
    Ok(cfg)
}
#[derive(Clone, Serialize, Deserialize)]
struct Account {
    id: String,
    email: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Vault {
    config: ClientConfig,
    refresh_token: Option<String>,
    account: Option<Account>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthStatus {
    configured: bool,
    connected: bool,
    signing_in: bool,
    account: Option<Account>,
    error: Option<String>,
}
struct State {
    vault: Option<Vault>,
    token: Option<String>,
    expires: u64,
    error: Option<String>,
}
pub(crate) struct DriveCoordinator {
    state: Mutex<State>,
    runtime: Arc<RuntimeHandle>,
    path: PathBuf,
    generation: AtomicU64,
    signing: AtomicBool,
    stop: AtomicBool,
    operation: Mutex<()>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn random() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
fn http() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Google connection unavailable".into())
}
fn response(response: reqwest::blocking::Response) -> Result<Value, String> {
    if !response.status().is_success() {
        return Err(if response.status() == reqwest::StatusCode::BAD_REQUEST
            || response.status() == reqwest::StatusCode::UNAUTHORIZED
        {
            "Google sign-in needed"
        } else {
            "Google connection unavailable"
        }
        .into());
    }
    let bytes = response
        .take(65537)
        .bytes()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Google connection unavailable")?;
    if bytes.len() > 65536 {
        return Err("Invalid Google response".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid Google response".into())
}
fn identity(token: &str) -> Result<Account, String> {
    let v = response(
        http()?
            .get(IDENTITY)
            .bearer_auth(token)
            .send()
            .map_err(|_| "Google connection unavailable")?,
    )?;
    let id = v
        .get("sub")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= 256)
        .ok_or("Google identity unavailable")?;
    let email = v
        .get("email")
        .and_then(Value::as_str)
        .filter(|s| s.contains('@') && s.len() <= 320 && !s.bytes().any(|b| b.is_ascii_control()))
        .ok_or("Google identity unavailable")?;
    if v.get("email_verified").and_then(Value::as_bool) != Some(true) {
        return Err("Google email identity is not verified".into());
    }
    Ok(Account {
        id: id.into(),
        email: email.into(),
    })
}
pub(crate) fn callback(request: &str, state: &str, port: u16) -> Result<String, String> {
    if request.len() >= 8192 || !request.contains("\r\n\r\n") {
        return Err("Invalid Google callback headers".into());
    }
    let mut lines = request.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    if first.next() != Some("GET") {
        return Err("Invalid Google callback".into());
    }
    let target = first.next().ok_or("Invalid Google callback")?;
    if first.next() != Some("HTTP/1.1")
        || first.next().is_some()
        || !target.starts_with("/oauth/callback?")
    {
        return Err("Invalid Google callback".into());
    }
    let hosts: Vec<_> = lines
        .filter_map(|l| l.split_once(':'))
        .filter(|(k, _)| k.eq_ignore_ascii_case("host"))
        .map(|(_, v)| v.trim())
        .collect();
    if hosts != vec![format!("127.0.0.1:{port}")] {
        return Err("Invalid Google callback host".into());
    }
    let url = tauri::Url::parse(&format!("http://127.0.0.1:{port}{target}"))
        .map_err(|_| "Invalid Google callback")?;
    if url.path() != "/oauth/callback" || url.fragment().is_some() {
        return Err("Invalid Google callback".into());
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    if pairs.iter().filter(|(k, _)| k == "state").count() != 1
        || pairs
            .iter()
            .find(|(k, _)| k == "state")
            .map(|(_, v)| v.as_ref())
            != Some(state)
    {
        return Err("Google callback state mismatch".into());
    }
    if pairs.iter().any(|(k, _)| k == "error") {
        return Err("Google authorization was declined".into());
    }
    if pairs.iter().filter(|(k, _)| k == "code").count() != 1 {
        return Err("Invalid Google authorization code".into());
    }
    let code = pairs.iter().find(|(k, _)| k == "code").unwrap().1.as_ref();
    if code.is_empty() || code.len() > 4096 || code.bytes().any(|b| b.is_ascii_control()) {
        return Err("Invalid Google authorization code".into());
    }
    Ok(code.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct RuntimeFixture(Arc<RuntimeHandle>);
    impl Drop for RuntimeFixture {
        fn drop(&mut self) {
            self.0.shutdown();
        }
    }
    fn sync_fixture(signin_count: u64) -> (Arc<DriveCoordinator>, RuntimeFixture) {
        let runtime = Arc::new(RuntimeHandle::new());
        let node = std::env::var_os("PANTHEON_TEST_NODE")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(std::env::var_os("ProgramFiles").unwrap()).join("nodejs/node.exe")
            });
        let script = format!(
            r#"let count=0;require('readline').createInterface({{input:process.stdin}}).on('line',line=>{{const f=JSON.parse(line);let result={{count}};if(f.method==='drive.sync'){{count++;result={{accepted:count>{signin_count},status:{{state:count>{signin_count}?'idle':'signin'}}}};}}process.stdout.write(JSON.stringify({{id:f.id,ok:true,result}})+'\n');if(f.method==='runtime.shutdown')process.exit(0);}});"#
        );
        runtime.start(&node, &["-e".into(), script]).unwrap();
        let coordinator = DriveCoordinator::new(
            std::env::temp_dir().join(format!("unused-{}", random())),
            Arc::clone(&runtime),
        );
        {
            let mut state = coordinator.state.lock().unwrap();
            state.token = Some("fixture-cached-token".into());
            state.expires = now() + 3600;
        }
        (coordinator, RuntimeFixture(runtime))
    }
    #[test]
    fn sidecar_signin_forces_cached_token_refresh_once_then_retries_sync() {
        let (coordinator, _fixture) = sync_fixture(1);
        let mut refreshes = 0;
        let result = coordinator
            .sync_with_refresh(false, |_generation| {
                refreshes += 1;
                if refreshes == 2 {
                    let mut state = coordinator.state.lock().unwrap();
                    assert!(state.token.is_none());
                    assert_eq!(state.expires, 0);
                    state.token = Some("fixture-refreshed-token".into());
                    state.expires = now() + 3600;
                }
                Ok(())
            })
            .unwrap();
        assert_eq!(result["accepted"], true);
        assert_eq!(refreshes, 2);
        assert_eq!(
            coordinator
                .runtime
                .request_internal("runtime.health", json!({}))
                .result
                .unwrap()["count"],
            2
        );
    }
    #[test]
    fn repeated_sidecar_signin_stops_after_single_retry_and_clears_cached_connection() {
        let (coordinator, _fixture) = sync_fixture(100);
        let mut refreshes = 0;
        let error = coordinator
            .sync_with_refresh(true, |_generation| {
                refreshes += 1;
                let mut state = coordinator.state.lock().unwrap();
                state.token = Some("fixture-token".into());
                state.expires = now() + 3600;
                Ok(())
            })
            .unwrap_err();
        assert_eq!(error, "Google sign-in needed");
        assert_eq!(refreshes, 2);
        assert!(!coordinator.status().connected);
        assert_eq!(
            coordinator
                .runtime
                .request_internal("runtime.health", json!({}))
                .result
                .unwrap()["count"],
            2
        );
    }
    #[test]
    fn generation_change_before_sync_dispatch_preserves_new_token() {
        let (coordinator, _fixture) = sync_fixture(1);
        let error = coordinator
            .sync_with_refresh(false, |_generation| {
                coordinator.generation.fetch_add(1, Ordering::SeqCst);
                let mut state = coordinator.state.lock().unwrap();
                state.token = Some("fixture-new-account-token".into());
                state.expires = now() + 3600;
                Ok(())
            })
            .unwrap_err();
        assert_eq!(error, "Google connection cancelled");
        assert!(coordinator.status().connected);
        assert_eq!(
            coordinator
                .runtime
                .request_internal("runtime.health", json!({}))
                .result
                .unwrap()["count"],
            0
        );
    }
    #[test]
    fn auth_status_expired_cached_token_is_not_connected() {
        let (coordinator, _fixture) = sync_fixture(0);
        coordinator.state.lock().unwrap().expires = now();
        assert!(!coordinator.status().connected);
    }
    const CONFIG: &str = r#"{"installed":{"client_id":"fixture.apps.googleusercontent.com","client_secret":"fixture-client-secret","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token"}}"#;
    #[test]
    fn rejects_redirected_endpoints_and_web_clients() {
        assert!(parse_config(CONFIG).is_ok());
        assert!(parse_config(&CONFIG.replace(TOKEN, "https://evil.example/token")).is_err());
        assert!(parse_config(&CONFIG.replace("installed", "web")).is_err());
        assert!(parse_config(&CONFIG.replace(
            "fixture.apps.googleusercontent.com",
            "evil?client.apps.googleusercontent.com"
        ))
        .is_err());
    }
    #[test]
    fn strict_loopback_callback_rejects_method_path_host_duplicates_and_replay_state() {
        let valid="GET /oauth/callback?state=expected&code=fixture HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n\r\n";
        assert_eq!(callback(valid, "expected", 1234).unwrap(), "fixture");
        for bad in [
            valid.replace("GET", "POST"),
            valid.replace("/oauth/callback?", "/redirect?"),
            valid.replace("expected", "replayed"),
            valid.replace("state=expected", "state=expected&state=expected"),
            valid.replace("code=fixture", "code=fixture&code=another"),
            valid.replace("127.0.0.1:1234", "evil.example"),
            valid.replace("code=fixture", "error=access_denied"),
            valid.replace("HTTP/1.1", "HTTP/1.0"),
            valid.replace("\r\n\r\n", "\r\n"),
        ] {
            assert!(callback(&bad, "expected", 1234).is_err(), "{bad}");
        }
    }
    #[test]
    fn pkce_has_rfc7636_digest_and_unpredictable_state() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let a = random();
        let b = random();
        assert_ne!(a, b);
        assert_eq!(a.len(), 43);
    }
    #[test]
    fn callback_wait_is_bounded_and_cancelled_before_accept() {
        let coordinator = DriveCoordinator::new(
            std::env::temp_dir().join(format!("unused-{}", random())),
            Arc::new(RuntimeHandle::new()),
        );
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let began = Instant::now();
        let err = coordinator
            .await_code(listener, "expected", port, 0, Duration::from_millis(20))
            .unwrap_err();
        assert!(err.contains("timed out"));
        assert!(began.elapsed() < Duration::from_secs(1));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        coordinator.shutdown();
        assert!(coordinator
            .await_code(listener, "expected", port, 0, Duration::from_secs(180))
            .unwrap_err()
            .contains("cancelled"));
    }
    #[test]
    fn stale_refresh_failure_cannot_restore_disconnected_or_clear_new_session() {
        let coordinator = DriveCoordinator::new(
            std::env::temp_dir().join(format!("unused-{}", random())),
            Arc::new(RuntimeHandle::new()),
        );
        coordinator.generation.store(2, Ordering::SeqCst);
        coordinator.publish_refresh_error(1, "Google connection unavailable");
        assert!(coordinator.status().error.is_none());
        {
            let mut state = coordinator.state.lock().unwrap();
            state.token = Some("new-session-token".into());
            state.expires = now() + 3600;
        }
        coordinator.publish_refresh_error(1, "Google sign-in needed");
        assert!(coordinator.status().connected);
        assert!(coordinator.status().error.is_none());
    }
    #[test]
    fn protected_vault_restarts_without_exposing_credentials_in_status() {
        let dir = std::env::temp_dir().join(format!("pantheon-drive-native-{}", random()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("credential.dpapi");
        let coordinator = DriveCoordinator::new(path.clone(), Arc::new(RuntimeHandle::new()));
        assert!(!coordinator.status().configured);
        coordinator.configure(CONFIG).unwrap();
        let mut vault = coordinator.state.lock().unwrap().vault.clone().unwrap();
        vault.refresh_token = Some("fixture-refresh-secret".into());
        vault.account = Some(Account {
            id: "fixture-sub".into(),
            email: "fixture@example.test".into(),
        });
        coordinator.save(&vault).unwrap();
        let stored = std::fs::read(&path).unwrap();
        assert!(!stored.windows(22).any(|w| w == b"fixture-refresh-secret"));
        let restarted = DriveCoordinator::new(path.clone(), Arc::new(RuntimeHandle::new()));
        let status = serde_json::to_string(&restarted.status()).unwrap();
        assert!(status.contains("fixture@example.test"));
        for secret in [
            "fixture-refresh-secret",
            "fixture-client-secret",
            "client_id",
            "accessToken",
            "refresh_token",
        ] {
            assert!(!status.contains(secret));
        }
        assert!(!restarted.status().connected);
        restarted.disconnect().unwrap();
        let vault: Vault =
            serde_json::from_slice(&unprotect(&std::fs::read(path).unwrap()).unwrap()).unwrap();
        assert!(vault.refresh_token.is_none());
        assert!(vault.account.is_none());
        assert!(restarted.status().configured);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
#[cfg(windows)]
fn crypt(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len().try_into().map_err(|_| "Credential too large")?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        if decrypt {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err("Windows could not protect or read the Google credential".into());
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as *mut _);
    };
    Ok(result)
}
pub(crate) fn protect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        crypt(bytes, false)
    }
    #[cfg(not(windows))]
    {
        let _ = bytes;
        Err("Google credential protection requires Windows".into())
    }
}
pub(crate) fn unprotect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        crypt(bytes, true)
    }
    #[cfg(not(windows))]
    {
        let _ = bytes;
        Err("Google credential protection requires Windows".into())
    }
}
impl DriveCoordinator {
    pub fn new(path: PathBuf, runtime: Arc<RuntimeHandle>) -> Arc<Self> {
        let loaded = std::fs::read(&path).ok().map(|b| {
            unprotect(&b).and_then(|b| {
                serde_json::from_slice::<Vault>(&b)
                    .map_err(|_| "Saved Google credential is invalid".into())
            })
        });
        let error = loaded.as_ref().and_then(|v| v.as_ref().err()).cloned();
        let vault = loaded.and_then(Result::ok);
        Arc::new(Self {
            state: Mutex::new(State {
                vault,
                token: None,
                expires: 0,
                error,
            }),
            runtime,
            path,
            generation: AtomicU64::new(0),
            signing: AtomicBool::new(false),
            stop: AtomicBool::new(false),
            operation: Mutex::new(()),
        })
    }
    fn save(&self, vault: &Vault) -> Result<(), String> {
        let data = protect(&serde_json::to_vec(vault).map_err(|_| "Credential unavailable")?)?;
        let temp = self.path.with_extension(format!("{}.tmp", random()));
        let mut file = std::fs::File::create(&temp)
            .map_err(|_| "Could not save protected Google credential")?;
        file.write_all(&data)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Could not save protected Google credential")?;
        drop(file);
        #[cfg(windows)]
        {
            use windows_sys::Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            };
            let a: Vec<u16> = temp
                .as_os_str()
                .to_string_lossy()
                .encode_utf16()
                .chain(Some(0))
                .collect();
            let b: Vec<u16> = self
                .path
                .as_os_str()
                .to_string_lossy()
                .encode_utf16()
                .chain(Some(0))
                .collect();
            let mut replaced = false;
            for attempt in 0..5 {
                if unsafe {
                    MoveFileExW(
                        a.as_ptr(),
                        b.as_ptr(),
                        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                    )
                } != 0
                {
                    replaced = true;
                    break;
                }
                let error = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
                if !matches!(error, 5 | 32 | 33) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(25 * (attempt + 1)));
            }
            if !replaced {
                let _ = std::fs::remove_file(&temp);
                return Err("Could not replace protected Google credential".into());
            }
        }
        #[cfg(not(windows))]
        std::fs::rename(temp, &self.path).map_err(|_| "Could not save Google credential")?;
        Ok(())
    }
    pub fn status(&self) -> AuthStatus {
        let s = self.state.lock().unwrap();
        AuthStatus {
            configured: s.vault.is_some(),
            connected: s.token.is_some() && s.expires > now(),
            signing_in: self.signing.load(Ordering::SeqCst),
            account: s.vault.as_ref().and_then(|v| v.account.clone()),
            error: s.error.clone(),
        }
    }
    pub fn configure(&self, raw: &str) -> Result<AuthStatus, String> {
        let cfg = parse_config(raw)?;
        let _op = self
            .operation
            .lock()
            .map_err(|_| "Google connection unavailable")?;
        self.disconnect()?;
        let vault = Vault {
            config: cfg,
            refresh_token: None,
            account: None,
        };
        self.save(&vault)?;
        self.state.lock().unwrap().vault = Some(vault);
        Ok(self.status())
    }
    pub fn disconnect(&self) -> Result<Value, String> {
        let mut s = self.state.lock().unwrap();
        self.generation.fetch_add(1, Ordering::SeqCst);
        let reply = self.runtime.request_internal("drive.disconnect", json!({}));
        s.token = None;
        s.expires = 0;
        s.error = None;
        if let Some(v) = s.vault.as_mut() {
            v.refresh_token = None;
            v.account = None;
            if self.save(v).is_err() {
                std::fs::remove_file(&self.path)
                    .map_err(|_| "Windows could not clear the stored Google credential")?;
                s.vault = None;
            }
        }
        Ok(reply.result.unwrap_or(json!({"state":"disconnected"})))
    }
    fn install(&self, generation: u64, mut vault: Vault, value: Value) -> Result<(), String> {
        let token = value
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() < 16384)
            .ok_or("Google sign-in needed")?
            .to_owned();
        let expiry = value
            .get("expires_in")
            .and_then(Value::as_u64)
            .filter(|s| *s > 0 && *s <= 86400)
            .ok_or("Invalid Google token lifetime")?;
        let account = identity(&token)?;
        if vault.account.as_ref().is_some_and(|a| a.id != account.id) {
            return Err("Google account changed; reconnect Google Drive".into());
        }
        if let Some(refresh) = value.get("refresh_token").and_then(Value::as_str) {
            vault.refresh_token = Some(refresh.into());
        }
        if vault.refresh_token.is_none() {
            return Err("Reconnect Google Drive to grant offline access".into());
        }
        vault.account = Some(account.clone());
        let mut s = self.state.lock().unwrap();
        if generation != self.generation.load(Ordering::SeqCst) || self.stop.load(Ordering::SeqCst)
        {
            return Err("Google connection cancelled".into());
        }
        self.save(&vault)?;
        let reply=self.runtime.request_internal("drive.session",json!({"accountId":account.id,"email":account.email,"accessToken":token,"expiresAt":(now()+expiry)*1000}));
        if !reply.ok {
            return Err("Drive runtime unavailable".into());
        }
        s.vault = Some(vault);
        s.token = Some(token);
        s.expires = now() + expiry;
        s.error = None;
        Ok(())
    }
    fn refresh(&self, generation: u64) -> Result<(), String> {
        let vault = {
            let s = self.state.lock().unwrap();
            if generation != self.generation.load(Ordering::SeqCst)
                || self.stop.load(Ordering::SeqCst)
            {
                return Err("Google connection cancelled".into());
            }
            if s.token.is_some() && s.expires > now() + 120 {
                return Ok(());
            }
            s.vault
                .clone()
                .ok_or("Configure a Google Desktop OAuth client first")?
        };
        let refresh = vault
            .refresh_token
            .as_ref()
            .ok_or("Connect Google Drive first")?;
        let value = response(
            http()?
                .post(TOKEN)
                .form(&[
                    ("client_id", vault.config.client_id.as_str()),
                    ("client_secret", vault.config.client_secret.as_str()),
                    ("grant_type", "refresh_token"),
                    ("refresh_token", refresh),
                ])
                .send()
                .map_err(|_| "Google connection unavailable")?,
        )?;
        self.install(generation, vault, value)
    }
    pub fn connect(&self) -> Result<AuthStatus, String> {
        if self.signing.swap(true, Ordering::SeqCst) {
            return Err("Google sign-in is already open".into());
        }
        struct Reset<'a>(&'a AtomicBool);
        impl Drop for Reset<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _reset = Reset(&self.signing);
        let _op = self
            .operation
            .lock()
            .map_err(|_| "Google connection unavailable")?;
        if self.state.lock().unwrap().vault.is_none() {
            return Err("Import a Google Desktop OAuth client JSON first".into());
        }
        self.disconnect()?;
        let generation = self.generation.load(Ordering::SeqCst);
        let vault = self
            .state
            .lock()
            .unwrap()
            .vault
            .clone()
            .ok_or("Import a Google Desktop OAuth client JSON first")?;
        let listener =
            TcpListener::bind("127.0.0.1:0").map_err(|_| "Google sign-in callback unavailable")?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "Google callback unavailable")?;
        let port = listener
            .local_addr()
            .map_err(|_| "Google callback unavailable")?
            .port();
        let redirect = format!("http://127.0.0.1:{port}/oauth/callback");
        let state = random();
        let verifier = random();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut url = tauri::Url::parse(AUTH).unwrap();
        url.query_pairs_mut().extend_pairs([
            ("client_id", vault.config.client_id.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("response_type", "code"),
            ("scope", SCOPE),
            ("state", state.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("access_type", "offline"),
            ("prompt", "consent"),
        ]);
        open_auth(url.as_str())?;
        let code = self.await_code(listener, &state, port, generation, Duration::from_secs(180))?;
        let value = response(
            http()?
                .post(TOKEN)
                .form(&[
                    ("client_id", vault.config.client_id.as_str()),
                    ("client_secret", vault.config.client_secret.as_str()),
                    ("grant_type", "authorization_code"),
                    ("code", code.as_str()),
                    ("code_verifier", verifier.as_str()),
                    ("redirect_uri", redirect.as_str()),
                ])
                .send()
                .map_err(|_| "Google connection unavailable")?,
        )?;
        self.install(generation, vault, value)?;
        let _ = self
            .runtime
            .request_internal("drive.sync", json!({"force":false}));
        Ok(self.status())
    }
    fn await_code(
        &self,
        listener: TcpListener,
        state: &str,
        port: u16,
        generation: u64,
        timeout: Duration,
    ) -> Result<String, String> {
        let deadline = Instant::now() + timeout;
        loop {
            if Instant::now() >= deadline {
                return Err("Google sign-in timed out; try Connect again".into());
            }
            if generation != self.generation.load(Ordering::SeqCst)
                || self.stop.load(Ordering::SeqCst)
            {
                return Err("Google sign-in cancelled".into());
            }
            match listener.accept() {
                Ok((mut stream, peer)) => {
                    if !peer.ip().is_loopback() {
                        continue;
                    }
                    let request_deadline = deadline.min(Instant::now() + Duration::from_secs(2));
                    let mut bytes = Vec::new();
                    let mut buf = [0u8; 1024];
                    while bytes.len() < 8192 {
                        let remaining = request_deadline.saturating_duration_since(Instant::now());
                        if remaining.is_zero() {
                            break;
                        }
                        let _ = stream.set_read_timeout(Some(remaining));
                        match stream.read(&mut buf) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                bytes.extend_from_slice(&buf[..n]);
                                if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                                    break;
                                }
                            }
                        }
                    }
                    if Instant::now() >= deadline {
                        return Err("Google sign-in timed out; try Connect again".into());
                    }
                    if generation != self.generation.load(Ordering::SeqCst)
                        || self.stop.load(Ordering::SeqCst)
                    {
                        return Err("Google sign-in cancelled".into());
                    }
                    let code = std::str::from_utf8(&bytes)
                        .map_err(|_| String::from("Invalid Google callback"))
                        .and_then(|raw| callback(raw, &state, port));
                    let body = if code.is_ok() {
                        "Google authorization received. Return to Pantheon."
                    } else {
                        "Invalid callback. Return to the Google sign-in browser tab."
                    };
                    let _=write!(stream,"HTTP/1.1 {}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",if code.is_ok(){"200 OK"}else{"400 Bad Request"},body.len(),body);
                    if code
                        .as_ref()
                        .err()
                        .is_some_and(|e| e == "Google authorization was declined")
                    {
                        return Err("Google authorization was declined".into());
                    }
                    if let Ok(code) = code {
                        return Ok(code);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100))
                }
                Err(_) => return Err("Google sign-in callback unavailable".into()),
            }
        }
    }
    pub fn sync(&self, force: bool) -> Result<Value, String> {
        self.sync_with_refresh(force, |generation| self.refresh(generation))
    }
    fn sync_with_refresh(
        &self,
        force: bool,
        mut refresh: impl FnMut(u64) -> Result<(), String>,
    ) -> Result<Value, String> {
        let _op = self
            .operation
            .lock()
            .map_err(|_| "Google connection unavailable")?;
        let generation = self.generation.load(Ordering::SeqCst);
        for attempt in 0..2 {
            refresh(generation)
                .inspect_err(|error| self.publish_refresh_error(generation, error))?;
            // Serialize against disconnect so an old request cannot schedule work for a replacement session.
            let result = {
                let _state = self.state.lock().unwrap();
                if generation != self.generation.load(Ordering::SeqCst)
                    || self.stop.load(Ordering::SeqCst)
                {
                    return Err("Google connection cancelled".into());
                }
                let reply = self
                    .runtime
                    .request_internal("drive.sync", json!({"force":force}));
                if !reply.ok {
                    return Err("Drive sync unavailable".into());
                }
                reply.result.unwrap_or(Value::Null)
            };
            if result
                .get("status")
                .and_then(|s| s.get("state"))
                .and_then(Value::as_str)
                != Some("signin")
            {
                return Ok(result);
            }
            // Google may reject an unexpired bearer token. Force a real refresh rather than trusting its cached expiry.
            {
                let mut state = self.state.lock().unwrap();
                if generation != self.generation.load(Ordering::SeqCst)
                    || self.stop.load(Ordering::SeqCst)
                {
                    return Err("Google connection cancelled".into());
                }
                state.token = None;
                state.expires = 0;
            }
            if attempt == 1 {
                self.publish_refresh_error(generation, "Google sign-in needed");
                return Err("Google sign-in needed".into());
            }
        }
        unreachable!("Drive authorization recovery is bounded to one retry")
    }
    fn publish_refresh_error(&self, generation: u64, error: &str) {
        let mut s = self.state.lock().unwrap();
        if generation != self.generation.load(Ordering::SeqCst) || self.stop.load(Ordering::SeqCst)
        {
            return;
        }
        s.error = Some(error.into());
        if error == "Google sign-in needed" {
            s.token = None;
            s.expires = 0;
        }
        let state = if error == "Google sign-in needed" {
            "signin"
        } else {
            "offline"
        };
        let _ = self
            .runtime
            .request_internal("drive.authState", json!({"state":state}));
    }
    pub fn control(&self, method: &str) -> Result<Value, String> {
        let reply = self.runtime.request_internal(method, json!({}));
        if !reply.ok {
            return Err("Drive control unavailable".into());
        }
        Ok(reply.result.unwrap_or(Value::Null))
    }
    pub fn start(self: &Arc<Self>) {
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            let mut next = Instant::now();
            while !this.stop.load(Ordering::SeqCst) {
                if Instant::now() >= next {
                    if this
                        .state
                        .lock()
                        .unwrap()
                        .vault
                        .as_ref()
                        .and_then(|v| v.refresh_token.as_ref())
                        .is_some()
                    {
                        let _ = this.sync(false);
                    }
                    next = Instant::now() + Duration::from_secs(300);
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        });
    }
    pub fn shutdown(&self) {
        self.stop.store(true, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
    }
}
fn open_auth(raw: &str) -> Result<(), String> {
    let url = tauri::Url::parse(raw).map_err(|_| "Invalid Google authorization URL")?;
    if url.scheme() != "https"
        || url.host_str() != Some("accounts.google.com")
        || url.path() != "/o/oauth2/v2/auth"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err("Invalid Google authorization URL".into());
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        let target: Vec<u16> = raw.encode_utf16().chain(Some(0)).collect();
        let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        if unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        } as isize
            <= 32
        {
            return Err("Windows could not open Google sign-in".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("Google browser authorization requires Windows".into())
    }
}
