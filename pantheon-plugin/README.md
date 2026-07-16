# Thesmos Pantheon — Claude Code Plugin

Distribute Pantheon agents as a Claude Code plugin so they do not need to be copied into every repository.

## Install

Use your Claude Code plugin marketplace / local plugin install flow pointing at this directory (or the published marketplace entry when available).

```bash
# From a clone of thesmos-governance:
# Install this folder as a local Claude Code plugin (exact command depends on your Claude Code version).
```

Pantheon plugin agents should appear with scoped names where the host supports them:

```text
pantheon:zeus-executive-agent
pantheon:argus-security-agent
```

## Relationship to Thesmos Core

| Concern | Owner |
|---|---|
| Agent definitions (Pantheon) | This plugin |
| Governance rules, hooks, scope | Thesmos Core (`thesmos-governance`) |
| Project custom agents | You (`.claude/agents/`) |
| Adoption into registry | Optional (`thesmos agent:adopt`) |

Thesmos governs what an agent does, not whether the agent is allowed to exist.

## Fallback (legacy copy)

If you cannot install plugins, the backward-compatible path remains:

```bash
npm run agents:install:local
# or project-level:
# thesmos pantheon:install --all --write
# then ownership-aware sync into .claude/agents/thesmos/
```

Legacy copies under `.claude/agents/<id>.md` are treated as external unless strong ownership evidence exists.

## Zeus and external agents

Zeus may invoke project, user, and third-party plugin agents by their exact registered names. External agents do not need to be in `.thesmos/registry.json`.
