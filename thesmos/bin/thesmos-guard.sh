#!/usr/bin/env sh
# Thin POSIX wrapper — governance logic lives in dist/thesmos-guard.js only.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$SCRIPT_DIR/../dist/thesmos-guard.js" "$@"
