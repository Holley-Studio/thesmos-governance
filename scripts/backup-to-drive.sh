#!/usr/bin/env bash
# scripts/backup-to-drive.sh
#
# Backs up this repo to the owner's own Google Drive (via rclone remote
# "gdrive"): a full git bundle (all tracked history + local-only branches)
# plus a working-tree tar.gz (everything on disk, including untracked paid
# content under pantheon/exports/ and dist-packs/ — these are the sellable
# product and exist only on local disk since being untracked from git).
#
# Invoked by .githooks/pre-push on every push to main (see that file), or
# manually via `npm run backup:now`. Requires rclone configured with a
# "gdrive" remote — see docs/backup-recovery.md for one-time setup.
#
# Never blocks git push: failures are logged, not raised, unless
# THESMOS_BACKUP_STRICT=1 is set (see .githooks/pre-push).
set -uo pipefail

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
REMOTE="gdrive:Thesmos-Governance-Backups"
LOG="$REPO_ROOT/.git/thesmos-backup.log"
MARKER_DIR="$REPO_ROOT/.git/thesmos-backup"
MARKER="$MARKER_DIR/last-snapshot-date"
TODAY="$(date +%Y-%m-%d)"

mkdir -p "$MARKER_DIR"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >>"$LOG"; }

fail() {
  log "FAIL: $1"
  exit 1
}

command -v rclone >/dev/null 2>&1 || fail "rclone not installed — see docs/backup-recovery.md"
rclone lsd "$REMOTE" >/dev/null 2>&1 || fail "rclone remote 'gdrive' not reachable/configured (offline, or setup incomplete)"

log "START backup"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

BUNDLE="$TMPDIR/thesmos-governance-repo.bundle"
ARCHIVE="$TMPDIR/thesmos-governance-workdir.tar.gz"

git -C "$REPO_ROOT" bundle create "$BUNDLE" --all \
  || fail "git bundle create failed"

tar -C "$REPO_ROOT" \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' --exclude='.env.*' \
  --exclude='*.tsbuildinfo' \
  --exclude='.DS_Store' --exclude='**/.DS_Store' \
  --exclude='coverage' --exclude='.next' --exclude='out' \
  -czf "$ARCHIVE" . \
  || fail "workdir tar failed"

rclone copyto "$BUNDLE" "$REMOTE/thesmos-governance-repo-latest.bundle" \
  || fail "rclone upload of bundle failed"
rclone copyto "$ARCHIVE" "$REMOTE/thesmos-governance-workdir-latest.tar.gz" \
  || fail "rclone upload of workdir archive failed"

# Throttled dated snapshot: at most once per calendar day.
if [ "$(cat "$MARKER" 2>/dev/null || true)" != "$TODAY" ]; then
  rclone copyto "$BUNDLE" "$REMOTE/snapshots/$TODAY/thesmos-governance-repo.bundle" \
    && rclone copyto "$ARCHIVE" "$REMOTE/snapshots/$TODAY/thesmos-governance-workdir.tar.gz" \
    && echo "$TODAY" >"$MARKER" \
    && log "snapshot for $TODAY written"
fi

log "OK backup complete"
