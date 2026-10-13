// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
//! Updates from a shared folder.
//!
//! A release channel is a plain folder — normally inside Google Drive for
//! desktop, so every studio PC sees the same files — holding `latest.json` and
//! the package it names. This module only *reads* that folder: it compares the
//! published version with the running one, copies the package to local disk
//! while hashing it, and hands the verified copy to the bundled installer.
//!
//! Trust boundary: the SHA-256 in the manifest proves the package arrived
//! intact; it does not prove who published it. Anyone who can write to the
//! channel folder can ship code to every machine that follows it, so the folder
//! must stay owner-writable only.
//!
//! The webview can ask for the status and ask to install what the channel
//! offers. It cannot name a path, a version or a package.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Where the channel lives inside a Google Drive mount.
const CHANNEL_PATH: &[&str] = &["My Drive", "Holley Studio", "04 HS - Tools and Development", "Pantheon Releases"];
const MANIFEST: &str = "latest.json";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_PACKAGE_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub schema: u32,
    pub product: String,
    pub version: String,
    pub package: String,
    pub sha256: String,
    pub size: u64,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub published_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current: String,
    pub channel: Option<String>,
    /// Set only when the channel offers something newer than `current`.
    pub available: Option<Release>,
    pub latest: Option<String>,
    pub problem: Option<String>,
}

/// `major.minor.patch`, nothing else. A channel that publishes anything looser
/// is refused rather than guessed at.
pub fn parse_version(raw: &str) -> Option<(u32, u32, u32)> {
    let mut parts = raw.split('.');
    let mut next = || -> Option<u32> {
        let part = parts.next()?;
        if part.is_empty() || part.len() > 6 || !part.bytes().all(|b| b.is_ascii_digit()) { return None; }
        part.parse().ok()
    };
    let version = (next()?, next()?, next()?);
    if parts.next().is_some() { return None; }
    Some(version)
}

pub fn parse_manifest(text: &str) -> Result<Release, String> {
    let release: Release = serde_json::from_str(text).map_err(|_| "The release manifest is not valid")?;
    if release.schema != 1 { return Err("This release needs a newer Pantheon updater".into()); }
    if release.product != "Pantheon" { return Err("The release manifest is for a different product".into()); }
    if parse_version(&release.version).is_none() { return Err("The release version is not valid".into()); }
    // The package name is derived, never trusted: no separators, no traversal.
    if release.package != format!("Pantheon-{}.zip", release.version) { return Err("The release package name is not valid".into()); }
    if release.sha256.len() != 64 || !release.sha256.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("The release checksum is not valid".into()); }
    if release.size == 0 || release.size > MAX_PACKAGE_BYTES { return Err("The release size is not valid".into()); }
    if release.notes.len() > 4000 || release.published_at.len() > 40 { return Err("The release manifest is not valid".into()); }
    Ok(release)
}

fn read_manifest(channel: &Path) -> Result<Release, String> {
    let path = channel.join(MANIFEST);
    let size = std::fs::metadata(&path).map_err(|_| "No release has been published to the update folder yet")?.len();
    if size > MAX_MANIFEST_BYTES { return Err("The release manifest is too large".into()); }
    parse_manifest(&std::fs::read_to_string(&path).map_err(|_| "The release manifest could not be read")?)
}

/// An explicit folder in `update-channel.json` wins; otherwise look for the
/// studio's release folder on each fixed or network drive.
pub fn find_channel(data_dir: &Path) -> Option<PathBuf> {
    if let Ok(text) = std::fs::read_to_string(data_dir.join("update-channel.json")) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(dir) = value.get("dir").and_then(serde_json::Value::as_str).map(PathBuf::from) {
                if dir.is_absolute() && dir.is_dir() { return Some(dir); }
            }
        }
        // A configured folder that is missing is reported, not silently replaced.
        return None;
    }
    #[cfg(windows)]
    {
        for letter in b'C'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
            // Fixed (3) and network (4) only: probing an empty card reader or
            // optical drive can stall or raise a "no disk" prompt.
            let kind = unsafe { windows_sys::Win32::Storage::FileSystem::GetDriveTypeW(wide.as_ptr()) };
            if kind != 3 && kind != 4 { continue; }
            let candidate = CHANNEL_PATH.iter().fold(PathBuf::from(&root), |path, part| path.join(part));
            if candidate.join(MANIFEST).is_file() { return Some(candidate); }
        }
    }
    None
}

pub fn status(current: &str, data_dir: &Path) -> UpdateStatus {
    let mut out = UpdateStatus { current: current.to_string(), channel: None, available: None, latest: None, problem: None };
    let Some(channel) = find_channel(data_dir) else {
        out.problem = Some("No update folder was found. Sign in to Google Drive for desktop on this PC.".into());
        return out;
    };
    out.channel = Some(channel.to_string_lossy().to_string());
    match read_manifest(&channel) {
        Ok(release) => {
            out.latest = Some(release.version.clone());
            // Newer only: a channel can never move an install backwards.
            if parse_version(&release.version) > parse_version(current) { out.available = Some(release); }
        }
        Err(problem) => out.problem = Some(problem),
    }
    out
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Copy the package to local disk and hash the bytes actually written, so the
/// installer works from a verified copy the channel can no longer change.
pub fn stage(current: &str, data_dir: &Path) -> Result<(Release, PathBuf), String> {
    let channel = find_channel(data_dir).ok_or("No update folder was found")?;
    let release = read_manifest(&channel)?;
    if parse_version(&release.version) <= parse_version(current) { return Err("Pantheon is already up to date".into()); }
    let source = channel.join(&release.package);
    let size = std::fs::metadata(&source).map_err(|_| "The release package is missing from the update folder. It may still be syncing.")?.len();
    if size != release.size { return Err("The release package is incomplete. It may still be syncing; try again shortly.".into()); }

    let dir = data_dir.join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let local = dir.join(&release.package);
    let mut input = std::fs::File::open(&source).map_err(|_| "The release package could not be opened")?;
    let mut output = std::fs::File::create(&local).map_err(|e| format!("Could not prepare the update: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut copied = 0u64;
    loop {
        let read = input.read(&mut buffer).map_err(|_| "The release package could not be read")?;
        if read == 0 { break; }
        copied += read as u64;
        if copied > release.size { return Err("The release package does not match its manifest".into()); }
        hasher.update(&buffer[..read]);
        output.write_all(&buffer[..read]).map_err(|e| format!("Could not prepare the update: {e}"))?;
    }
    output.sync_all().map_err(|e| e.to_string())?;
    drop(output);
    if !hex(&hasher.finalize()).eq_ignore_ascii_case(&release.sha256) {
        let _ = std::fs::remove_file(&local);
        return Err("The release package failed its checksum and was not installed".into());
    }
    Ok((release, local))
}

/// Hand the verified package to the bundled installer, which waits for this
/// process to exit, swaps the install and starts the new version.
#[cfg(windows)]
pub fn launch_installer(script: &Path, release: &Release, package: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let powershell = PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into())).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut command = std::process::Command::new(powershell);
    command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]).arg(script)
        .arg("-Package").arg(package)
        .args(["-Sha256", &release.sha256, "-Version", &release.version, "-WaitForPid", &std::process::id().to_string(), "-Launch"])
        // Not this app's working directory: that is the "current" link the
        // installer is about to replace.
        .current_dir(std::env::temp_dir())
        // No console, and its own process group so it outlives this app.
        .creation_flags(0x08000000 | 0x00000200);
    command.spawn().map_err(|e| format!("Could not start the installer: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(version: &str, sha: &str, size: u64) -> String {
        format!(r#"{{"schema":1,"product":"Pantheon","version":"{version}","package":"Pantheon-{version}.zip","sha256":"{sha}","size":{size},"notes":"n","publishedAt":"2026-10-13T00:00:00Z"}}"#)
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pantheon-update-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sha(bytes: &[u8]) -> String { hex(&Sha256::digest(bytes)) }

    #[test]
    fn versions_are_strict_and_ordered() {
        assert_eq!(parse_version("0.2.0"), Some((0, 2, 0)));
        assert!(parse_version("0.10.0") > parse_version("0.9.9"));
        for bad in ["", "1", "1.2", "1.2.3.4", "1.2.x", "v1.2.3", "1.2.3-beta", "1..3", " 1.2.3", "1.2.3\n"] {
            assert_eq!(parse_version(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn manifest_rejects_anything_that_could_redirect_the_install() {
        let good = sha(b"x");
        assert!(parse_manifest(&manifest("0.2.0", &good, 5)).is_ok());
        assert!(parse_manifest(&manifest("0.2.0", "abc", 5)).is_err());
        assert!(parse_manifest(&manifest("0.2.0", &good, 0)).is_err());
        assert!(parse_manifest(&manifest("../0.2.0", &good, 5)).is_err());
        for edit in [("\"schema\":1", "\"schema\":2"), ("\"product\":\"Pantheon\"", "\"product\":\"Other\""), ("Pantheon-0.2.0.zip", "..\\\\evil.zip"), ("Pantheon-0.2.0.zip", "Pantheon-0.3.0.zip")] {
            assert!(parse_manifest(&manifest("0.2.0", &good, 5).replace(edit.0, edit.1)).is_err(), "{edit:?}");
        }
    }

    fn channel_with(name: &str, version: &str, body: &[u8], claimed_sha: &str, claimed_size: u64) -> PathBuf {
        let data = scratch(name);
        let channel = data.join("channel");
        std::fs::create_dir_all(&channel).unwrap();
        std::fs::write(channel.join(MANIFEST), manifest(version, claimed_sha, claimed_size)).unwrap();
        std::fs::write(channel.join(format!("Pantheon-{version}.zip")), body).unwrap();
        std::fs::write(data.join("update-channel.json"), serde_json::json!({"dir": channel}).to_string()).unwrap();
        data
    }

    #[test]
    fn newer_release_is_offered_and_staged_with_a_verified_copy() {
        let body = b"package-bytes";
        let data = channel_with("ok", "0.3.0", body, &sha(body), body.len() as u64);
        let seen = status("0.2.0", &data);
        assert_eq!(seen.available.as_ref().map(|r| r.version.as_str()), Some("0.3.0"));
        assert!(seen.problem.is_none());
        let (release, local) = stage("0.2.0", &data).unwrap();
        assert_eq!(release.version, "0.3.0");
        assert_eq!(std::fs::read(local).unwrap(), body);
        let _ = std::fs::remove_dir_all(data);
    }

    #[test]
    fn same_or_older_release_is_never_offered_or_installed() {
        let body = b"package-bytes";
        for published in ["0.2.0", "0.1.9"] {
            let data = channel_with(&format!("old-{published}"), published, body, &sha(body), body.len() as u64);
            assert!(status("0.2.0", &data).available.is_none());
            assert!(stage("0.2.0", &data).is_err());
            let _ = std::fs::remove_dir_all(data);
        }
    }

    #[test]
    fn tampered_or_partial_package_is_refused_and_not_left_behind() {
        let body = b"package-bytes";
        let wrong_hash = channel_with("hash", "0.3.0", body, &sha(b"something else"), body.len() as u64);
        assert!(stage("0.2.0", &wrong_hash).unwrap_err().contains("checksum"));
        assert!(!wrong_hash.join("updates").join("Pantheon-0.3.0.zip").exists());
        let partial = channel_with("size", "0.3.0", body, &sha(body), body.len() as u64 + 10);
        assert!(stage("0.2.0", &partial).unwrap_err().contains("incomplete"));
        for dir in [wrong_hash, partial] { let _ = std::fs::remove_dir_all(dir); }
    }

    #[test]
    fn configured_but_missing_folder_is_a_reported_problem() {
        let data = scratch("missing");
        std::fs::write(data.join("update-channel.json"), r#"{"dir":"Z:\\does\\not\\exist"}"#).unwrap();
        let seen = status("0.2.0", &data);
        assert!(seen.channel.is_none() && seen.available.is_none() && seen.problem.is_some());
        let _ = std::fs::remove_dir_all(data);
    }
}
