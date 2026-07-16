# Federated Agent Architecture — Implementation Plan

## Principle

Thesmos governs what an agent does, not whether the agent is allowed to exist.

## Current writers of `.claude/agents/`

| Path | Behavior today |
|---|---|
| `thesmos/scripts/install-agents-local.ts` | Overwrites `~/.claude/agents/*.md` by filename |
| Manual / kit copy | User or docs `cp` into project `.claude/agents/` |
| `scope.ts` + `.thesmos/scope.json` | Blocks `.claude/` (and allowedPaths excludes it) |
| `adapters.ts` | Does **not** write `.claude/agents/` (docs claim otherwise) |
| `pantheon:install --write` | Writes `.thesmos/agents/` + registry only |

## Design

1. **Ownership manifest** (`.thesmos/managed-agents.json`) — sole proof of Thesmos ownership
2. **Managed fallback path** — `.claude/agents/thesmos/<id>.md` (+ `~/.claude/agents/thesmos/`)
3. **Discovery** — project > user > plugin; never mutates registry
4. **Scope** — allow external agent writes; block only managed overwrites
5. **Sync** — ownership-aware; never touch unowned files
6. **CLI** — adopt / release / list / doctor / conflicts
7. **Plugin** — `pantheon-plugin/` package for Claude Code
8. **Zeus** — unrestricted `Agent` + interoperability doctrine

## Module layout

- `thesmos/agent-ownership.ts` — manifest I/O, hashes, path safety
- `thesmos/agent-discovery.ts` — federated discovery + conflicts
- `thesmos/agent-sync.ts` — managed Claude Code sync + migration
- `thesmos/bin/commands/agents-federation.ts` — list/doctor/conflicts/adopt/release
