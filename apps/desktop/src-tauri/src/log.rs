// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
//! Local diagnostics log.
//!
//! The release shell is a GUI-subsystem process, so stderr goes nowhere. Without
//! a file, a runtime that failed to start or crashed left no trace at all. This
//! writes plain lines to `<data dir>/logs/pantheon.log`, rotated once at 1 MB so
//! the folder holds at most two files.
//!
//! Callers pass diagnostics only. Request parameters, prompts, tokens and
//! document text never reach this module.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 1024 * 1024;
const MAX_LINE: usize = 2000;

struct Sink {
    path: PathBuf,
    file: File,
    written: u64,
}

static SINK: OnceLock<Mutex<Option<Sink>>> = OnceLock::new();

fn open(path: &Path) -> Option<Sink> {
    let file = OpenOptions::new().create(true).append(true).open(path).ok()?;
    let written = file.metadata().map(|m| m.len()).unwrap_or(0);
    Some(Sink { path: path.to_path_buf(), file, written })
}

/// Start logging under `data_dir`. Failure is silent: diagnostics must never be
/// the reason the app does not open.
pub fn init(data_dir: &Path) {
    let dir = data_dir.join("logs");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let slot = SINK.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = slot.lock() {
        *guard = open(&dir.join("pantheon.log"));
    }
}

/// Seconds since the Unix epoch, formatted as a UTC timestamp without pulling
/// in a date crate.
fn timestamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let days = secs / 86_400;
    let (h, m, s) = ((secs % 86_400) / 3600, (secs % 3600) / 60, secs % 60);
    // Civil-from-days (Howard Hinnant), valid for the proleptic Gregorian calendar.
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!("{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}Z")
}

pub fn line(tag: &str, message: &str) {
    let Some(slot) = SINK.get() else { return };
    let Ok(mut guard) = slot.lock() else { return };
    let Some(sink) = guard.as_mut() else { return };
    if sink.written > MAX_BYTES {
        let rotated = sink.path.with_extension("log.1");
        let _ = std::fs::remove_file(&rotated);
        let _ = std::fs::rename(&sink.path, &rotated);
        match open(&sink.path) {
            Some(fresh) => *sink = fresh,
            None => { *guard = None; return; }
        }
    }
    // One record per line: control characters would let a diagnostic forge entries.
    let clean: String = message.chars().take(MAX_LINE).map(|c| if c.is_control() { ' ' } else { c }).collect();
    let record = format!("{} [{tag}] {clean}\n", timestamp());
    if sink.file.write_all(record.as_bytes()).is_ok() {
        sink.written += record.len() as u64;
    }
}

#[cfg(test)]
mod tests {
    use super::timestamp;

    #[test]
    fn timestamp_is_iso_utc() {
        let stamp = timestamp();
        assert_eq!(stamp.len(), 20);
        assert!(stamp.ends_with('Z') && stamp.as_bytes()[10] == b'T');
        assert!(stamp[..4].parse::<u32>().unwrap() >= 2026);
    }
}
