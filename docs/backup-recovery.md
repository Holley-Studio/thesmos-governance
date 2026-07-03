# Backup & Recovery

## Why this exists

`pantheon/exports/` (the full 67-agent paid roster, per-platform) and
`dist-packs/` (the sellable Gumroad ZIPs) are deliberately **untracked** from
git (see `.gitignore`) so the paid product isn't casually browsable on the
now-public GitHub repo. That means those files exist **only on this local
machine's disk** — nowhere else. Git history itself is already safe the
moment it's pushed to GitHub; this backup exists to cover the untracked
paid content, plus give a second copy of history, in case of local disk
failure or corruption.

GitHub Actions cannot do this: CI runners only ever see git-tracked content
from a fresh clone, never the untracked local files. This has to run from
the machine where the full working directory actually lives.

## What it does

On every `git push` that includes `refs/heads/main`, a `pre-push` git hook
runs `scripts/backup-to-drive.sh` in the background (never blocks or slows
down the push). It uploads two artifacts to your own Google Drive, via
`rclone`:

1. **`thesmos-governance-repo-latest.bundle`** — a full `git bundle --all`:
   every tracked commit, branch, and tag, restorable with `git clone`.
2. **`thesmos-governance-workdir-latest.tar.gz`** — the entire working
   directory as it exists on disk right now, including the untracked
   `pantheon/exports/` and `dist-packs/`. Excludes `node_modules/`, `.git/`,
   build/cache junk, and **`.env`** (see Security note below).

Both are overwritten on every push (Drive's own revision history gives
~30 days of rollback for free). A dated copy under `snapshots/YYYY-MM-DD/`
is also written, but at most once per calendar day, to bound Drive storage
growth regardless of how many times you push in a session.

## One-time setup (you have to do this — it's tied to your Google account)

1. Install rclone:
   ```bash
   curl https://rclone.org/install.sh | sudo bash
   ```
2. Authorize it against your own Google Drive (opens a browser, you log in
   and grant consent — the token is stored only in
   `~/.config/rclone/rclone.conf` on this machine, never committed, never
   seen by anyone else):
   ```bash
   rclone config
   ```
   - `n` for new remote, name it **`gdrive`**
   - Storage type: **`drive`**
   - Client ID / secret: leave blank
   - Scope: **`drive.file`** — least-privilege; this token can only touch
     files/folders rclone itself creates, not your whole Drive
   - `Use auto config? Y`
3. Create the destination folder (must be created *by* rclone for the
   `drive.file` scope to have write access to it):
   ```bash
   rclone mkdir gdrive:Thesmos-Governance-Backups
   ```
   Confirm it shows up in your own Google Drive under "My Drive".
4. Wire up the hook (repo root):
   ```bash
   npm run hooks:install
   ```
   (equivalent to `git config core.hooksPath .githooks`)
5. Sanity check:
   ```bash
   rclone about gdrive:
   ```
   should print your quota with no error.

**You must redo steps 4 on any fresh clone or new machine** — `core.hooksPath`
lives in local `.git/config`, which nothing brings with it automatically.

## Manual use

```bash
npm run backup:now      # run a backup immediately, any time
npm run backup:status   # tail the backup log
```

Force a synchronous, push-blocking backup (rare — only when you want a hard
guarantee before doing something risky):
```bash
THESMOS_BACKUP_STRICT=1 git push
```

## Restoring from a backup

```bash
npm run backup:restore -- /path/to/restore/into
```

This pulls both latest artifacts, `git clone`s the bundle, and untars the
workdir archive. Then, inside the restored copy, re-run:
```bash
git config core.hooksPath .githooks
```
to reactivate the backup mechanism on the recovered copy, and recreate
`.env` manually (see Security note).

## Security note: `.env` is deliberately excluded

`.env` holds `GUMROAD_TOKEN` and `GUMROAD_PRODUCT_ID` — live secrets.
Uploading them into a Drive backup would widen the blast radius if the
Drive account itself is ever compromised. Losing `.env` locally is a small,
easily-fixed problem (recreate/rotate) compared to that risk, so it's
excluded on purpose, not by oversight.

## Compatibility note: `thesmos hooks install`

The `thesmos-governance` npm package itself ships a `thesmos hooks install`
command that writes governance-check hooks into `.git/hooks/` (or
`.husky/`). Setting `core.hooksPath` to `.githooks` (step 4 above) makes git
stop reading `.git/hooks/` entirely — if you ever run `thesmos hooks
install` on this repo, those hooks would silently never fire. If you want
both, add the governance-check invocation directly inside
`.githooks/pre-push` rather than running both hook mechanisms side by side.

## Pruning old snapshots

Dated snapshots accumulate indefinitely by design (only the `-latest` files
are ever deleted, via overwrite). Periodically prune manually:
```bash
rclone delete gdrive:Thesmos-Governance-Backups/snapshots --min-age 60d
```
