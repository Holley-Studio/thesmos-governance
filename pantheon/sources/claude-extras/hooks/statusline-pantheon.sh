#!/usr/bin/env bash
# Pantheon statusline — ZERO API token cost, pure local rendering.
#
# Reads .thesmos/agent-activity.jsonl (the same file the VS Code Agent
# Activity panel reads — see extensions/vscode/src/agentActivityPanel.ts and
# the writer at .claude/hooks/agent-activity.cjs) and renders whichever
# Pantheon god is currently mid-dispatch:
#
#   ⚡ Zeus → 👁 Argus · inspecting the perimeter…
#
# Falls back to an idle line (branch + model) when nothing is running, the
# most recent spawn is stale (>5 min with no completion — presumed lost),
# or the log doesn't exist yet. Never makes a network call, never invokes
# an LLM — this line costs nothing.
#
# Wired via .claude/settings.json → "statusLine": { "type": "command", ... }
# Claude Code pipes a JSON payload on stdin (session_id, model, workspace,
# cwd, ...); see https://docs.claude.com/en/docs/claude-code/statusline.
#
# ASSUMPTION [flagged for Zeus]: the exact statusLine stdin JSON shape and
# settings.json schema are matched from documented examples as of this
# writing; if the payload shape differs, the "model"/"cwd" extraction below
# degrades gracefully to fallback values — it never errors or blocks.

set -u

INPUT="$(cat 2>/dev/null || true)"

# ---- best-effort model + cwd extraction from the stdin payload -----------
extract_json_field() {
  # $1 = input, $2 = key name. Matches "key":"value" (first occurrence).
  printf '%s' "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" 2>/dev/null | head -1 | sed -E "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/"
}

MODEL="$(extract_json_field "$INPUT" "display_name")"
CWD="$(extract_json_field "$INPUT" "current_dir")"
[ -z "$CWD" ] && CWD="$(extract_json_field "$INPUT" "cwd")"
[ -z "$CWD" ] && CWD="$PWD"
[ -z "$MODEL" ] && MODEL="claude"

LOG="$CWD/.thesmos/agent-activity.jsonl"
FIVE_MIN_SECONDS=300

idle_line() {
  local branch
  branch="$(git -C "$CWD" branch --show-current 2>/dev/null)"
  if [ -n "$branch" ]; then
    printf '⚡ Zeus · idle · %s · %s\n' "$branch" "$MODEL"
  else
    printf '⚡ Zeus · idle · %s\n' "$MODEL"
  fi
}

if [ ! -f "$LOG" ]; then
  idle_line
  exit 0
fi

# Bounded read — the writer hook caps the file at 500 lines and trims to
# 200, so the last 200 lines always cover everything relevant to "recent".
TAIL_LINES="$(tail -n 200 "$LOG" 2>/dev/null)"
if [ -z "$TAIL_LINES" ]; then
  idle_line
  exit 0
fi

# Single-pass AWK: find the most recent 'spawn' event (pantheon-only —
# identified by a godEmoji field) that has no later 'complete'/'error' for
# the same agentId. Numeric-indexed arrays preserve file order regardless of
# awk implementation (BSD awk on macOS, gawk elsewhere), so no reliance on
# for-in iteration order for the completed-set lookup.
RESULT="$(printf '%s\n' "$TAIL_LINES" | awk '
function extract(s, key,    re, val) {
  re = "\"" key "\":\"[^\"]*\""
  if (match(s, re)) {
    val = substr(s, RSTART, RLENGTH)
    sub("^\"" key "\":\"", "", val)
    sub("\"$", "", val)
    return val
  }
  return ""
}
{
  line = $0
  type = extract(line, "type")
  agentId = extract(line, "agentId")
  if (type == "complete" || type == "error") {
    completed[agentId] = 1
  } else if (type == "spawn") {
    emoji = extract(line, "godEmoji")
    if (emoji != "") {
      n++
      sp_id[n] = agentId
      sp_ts[n] = extract(line, "ts")
      sp_emoji[n] = emoji
      sp_verb[n] = extract(line, "progressVerb")
      subtype = extract(line, "subagentType")
      idx = index(subtype, " — ")
      if (idx == 0) idx = index(subtype, " – ")
      sp_name[n] = (idx > 0) ? substr(subtype, 1, idx - 1) : subtype
    }
  }
}
END {
  for (i = n; i >= 1; i--) {
    if (!(sp_id[i] in completed)) {
      print sp_ts[i] "\t" sp_emoji[i] "\t" sp_name[i] "\t" sp_verb[i]
      exit
    }
  }
}
')"

if [ -z "$RESULT" ]; then
  idle_line
  exit 0
fi

TS="$(printf '%s' "$RESULT" | cut -f1)"
EMOJI="$(printf '%s' "$RESULT" | cut -f2)"
NAME="$(printf '%s' "$RESULT" | cut -f3)"
VERB="$(printf '%s' "$RESULT" | cut -f4)"

# Staleness check: a spawn older than ~5 minutes with no completion is
# presumed lost (hook failure, crashed agent) — fall back to idle rather
# than showing a god frozen in place forever.
TS_EPOCH="$(date -u -j -f '%Y-%m-%dT%H:%M:%S' "${TS%%.*}" +%s 2>/dev/null || date -u -d "$TS" +%s 2>/dev/null || echo 0)"
NOW_EPOCH="$(date -u +%s)"

if [ "$TS_EPOCH" -eq 0 ] || [ $((NOW_EPOCH - TS_EPOCH)) -gt "$FIVE_MIN_SECONDS" ]; then
  idle_line
  exit 0
fi

if [ -n "$VERB" ]; then
  printf '⚡ Zeus → %s %s · %s…\n' "$EMOJI" "$NAME" "$VERB"
else
  printf '⚡ Zeus → %s %s\n' "$EMOJI" "$NAME"
fi
