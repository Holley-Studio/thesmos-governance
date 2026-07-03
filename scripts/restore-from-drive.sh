#!/usr/bin/env bash
# scripts/restore-from-drive.sh
#
# Pulls the latest backup artifacts from the owner's Google Drive and
# reconstructs a working copy of the repo. Symmetric companion to
# backup-to-drive.sh. Used both for the restore verification test in
# docs/backup-recovery.md and for a real disaster recovery.
#
# Usage: bash scripts/restore-from-drive.sh <target-directory>
set -euo pipefail

TARGET="${1:?Usage: restore-from-drive.sh <target-directory>}"
REMOTE="gdrive:Thesmos-Governance-Backups"

command -v rclone >/dev/null 2>&1 || { echo "rclone not installed"; exit 1; }

mkdir -p "$TARGET"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "Fetching latest bundle + workdir archive from $REMOTE ..."
rclone copy "$REMOTE/thesmos-governance-repo-latest.bundle" "$TMPDIR"
rclone copy "$REMOTE/thesmos-governance-workdir-latest.tar.gz" "$TMPDIR"

echo "Cloning git history from bundle into $TARGET/restored-repo ..."
git clone "$TMPDIR/thesmos-governance-repo-latest.bundle" "$TARGET/restored-repo"

echo "Extracting working-tree archive into $TARGET/restored-workdir (includes paid content) ..."
mkdir -p "$TARGET/restored-workdir"
tar xzf "$TMPDIR/thesmos-governance-workdir-latest.tar.gz" -C "$TARGET/restored-workdir"

echo ""
echo "Restore complete."
echo "  Git history:    $TARGET/restored-repo"
echo "  Full workdir:   $TARGET/restored-workdir  (includes pantheon/exports/, dist-packs/)"
echo ""
echo "Note: .env was deliberately excluded from the backup — recreate it manually"
echo "(GUMROAD_TOKEN, GUMROAD_PRODUCT_ID) before running anything that needs it."
echo ""
echo "If this restore is replacing the original working copy, re-run inside it:"
echo "  git config core.hooksPath .githooks"
