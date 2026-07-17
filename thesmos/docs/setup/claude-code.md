# Claude Code Setup Guide

## Federated agents

Claude Code discovers agents from several locations. Thesmos does **not** own `.claude/agents/` as a whole. Thesmos governs agent **tool actions** (scope, hooks, destructive commands). Existence of an agent file is open.

**Precedence (Claude Code order):**

1. Project agents (`.claude/agents/`)
2. User agents (`~/.claude/agents/`)
3. Plugin agents (for example Pantheon via `pantheon-plugin/`)

Thesmos mirrors this precedence in `thesmos agents:list` and conflict reporting.

| Kind | Typical path | Ownership |
|---|---|---|
| Your project agent | `.claude/agents/my-agent.md` | External (yours) |
| Your user agent | `~/.claude/agents/my-agent.md` | External (yours) |
| Pantheon fallback (managed) | `.claude/agents/thesmos/<id>.md` | Managed (manifest) |
| Pantheon plugin | Claude Code plugin | External / plugin |
| Adopted into registry | `.thesmos/agents/<id>.md` | Adopted |

Core rule: **Thesmos governs what an agent does, not whether the agent is allowed to exist.**

---

## Preferred: Pantheon as a Claude Code plugin

Install the Pantheon plugin from `pantheon-plugin/` so agents are not copied into every repository. Scoped names look like:

```text
pantheon:zeus-executive-agent
pantheon:argus-security-agent
```

See [pantheon-plugin/README.md](../../../pantheon-plugin/README.md).

---

## Fallback: ownership-aware local sync

If you need files on disk (no plugin), Thesmos writes **only** under a managed namespace:

```text
.claude/agents/thesmos/<agent-id>.md
~/.claude/agents/thesmos/<agent-id>.md
```

Ownership is recorded in `.thesmos/managed-agents.json` (project) or `~/.thesmos/managed-agents.json` (user). Filename alone is never proof of ownership.

```bash
# User-level fallback (never overwrites untracked files)
npm run agents:install:local
npm run agents:install:local -- --dry-run

# After pantheon:install --write / agent:install, adapters also sync managed Claude agents
thesmos adapters
```

Synchronization rules:

- Update only files Thesmos owns and that still match the recorded hash
- Never overwrite or delete untracked files
- Preserve modified managed files and report a conflict
- Remove stale managed files only when unmodified

---

## Custom agents (create freely)

Create agents directly. Scope allows writes to unmanaged paths under `.claude/agents/`:

```bash
mkdir -p .claude/agents
# Create .claude/agents/my-blender-director.md with Claude Code frontmatter
```

These remain **external**. They are not added to `.thesmos/registry.json` until you adopt them.

Optional adoption into Thesmos ownership:

```bash
thesmos agent:adopt .claude/agents/my-blender-director.md
thesmos agent:adopt .claude/agents/my-blender-director.md --dry-run
thesmos agent:release my-blender-director
```

Adoption copies into `.thesmos/agents/`, registers the agent, and marks ownership. The original file is kept unless you request otherwise.

---

## Managed install into the registry

To install into `.thesmos/agents/` and the registry (Cursor / AGENTS.md / etc.):

```bash
thesmos agent:install path/to/agent.md
thesmos agent:install claude-code/ --dry-run
thesmos pantheon:install --all --write
```

This updates canonical registry agents and regenerates adapters. Claude Code **managed** copies land under `.claude/agents/thesmos/`, not the root of `.claude/agents/`.

Direct copies into `.claude/agents/*.md` are supported: they are external agents. They stay outside Thesmos ownership unless you adopt them. Adapter sync will not overwrite them.

---

## Discovery, conflicts, and doctor

```bash
thesmos agents:list --all
thesmos agents:list --all --json
thesmos agents:conflicts
thesmos agents:doctor
thesmos agents:doctor --strict   # exit 2 when CI-relevant conflicts exist
```

Example conflict:

```text
argus-security-agent
Status: shadowed
Pantheon invocation: pantheon:argus-security-agent
Active override: .claude/agents/argus-security-agent.md
```

Exit codes: `0` success, `1` hard error, `2` conflicts when `--strict` is set.

---

## Zeus and external agents

Zeus may use the Agent tool without a Pantheon-only allowlist. Project, user, and third-party plugin agents are valid specialists when available. Prefer an explicitly requested external agent over a Pantheon equivalent. External agents do not need registry membership. Governance still applies to their tool calls.

---

## Legacy migration

Older installs may have Pantheon files at `.claude/agents/<id>.md`. Migration to `.claude/agents/thesmos/` runs only with strong evidence (managed marker or exact known hash). Filename alone never triggers ownership. Modified legacy files are preserved. Prefer `--dry-run` before mutating.

```bash
thesmos agents:doctor
npm run agents:install:local -- --dry-run
```

---

## Governance hooks (cross-platform guard)

```bash
thesmos claude:govern install
thesmos claude:govern status
```

**Source of truth:** `node dist/thesmos-guard.js <check|budget-check|drift>`. Install writes Node-direct commands (quoted `process.execPath` + absolute entry). Thin wrappers `thesmos/bin/thesmos-guard.sh` / `.cmd` only forward to that entry — optional for manual invoke.

| Platform | Needs Bash / WSL? | How hooks run |
|---|---|---|
| Windows | No | Node-direct (or `.cmd` wrapper) |
| macOS / Linux | No for guard | Node-direct (or `.sh` wrapper) |

**`autoMode.failClosed` (default `true`):** malformed hook stdin, unreadable/malformed `.thesmos/config.json`, or internal guard exceptions exit `2` and block the tool call. Diagnose from stderr (resolved path, category, checklist). Explicit opt-out only:

```json
{ "autoMode": { "failClosed": false } }
```

Legitimate allows (not infrastructure failures): unknown tool names, empty file content, ignored extensions, empty Bash command, clean findings.

**Statusline** (`.claude/statusline-pantheon.sh`) still requires Bash — it is not on the PreToolUse critical path.

---

## Tips

- Install or enable Zeus for orchestration; he can route to Pantheon and external agents
- Read `setup/zeus-orchestration-guide.md` before your first multi-agent session
- Use `God Agent [Name]` or the exact registered name for best results
- Keep governance hooks active so external agents stay governed at execution time

## Support

Email [hello@holley.studio](mailto:hello@holley.studio) with setup questions.
