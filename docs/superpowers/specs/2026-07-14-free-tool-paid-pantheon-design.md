# Free Tool, Paid Pantheon — Revenue Model Design

**Date:** 2026-07-14
**Status:** Approved
**Owner:** Matthew Holley

## Problem

thesmos-governance has a $79 "premium tier" that is honor-system only: the full
rule engine is gated by a marker file anyone can create with an env var, and the
npm tarball ships every premium Pantheon agent to free users. Zero sales, zero
publicity, near-zero funnel. The gate is neither honest (it pretends to gate
public source) nor effective (the content leaks in the free download).

## Goal

A reputable, near-zero-maintenance revenue model. One-time low price, no license
infrastructure, no support burden. The user's scarce resource is time.

## Decisions (made during brainstorming)

1. **Revenue shape:** one-time purchase, $24 lifetime. No subscription.
2. **Boundary:** the *tool* is 100% free; the *content* (Pantheon agents) is paid.
3. **Mechanism:** content gate — premium agents are physically absent from the
   free distribution. No keys, no server, no activation.

## The Boundary

| Capability | Free (npm + VS Code Marketplace) | Paid ($24, Gumroad) |
|---|---|---|
| Full rule engine — all 1,137 rules including GDPR/HIPAA/EU AI Act/DORA packs | ✅ | — |
| Hooks, brain, autopilot, scan/review/validate, all CLI commands | ✅ | — |
| VS Code extension + Pantheon Chat | ✅ | — |
| Starter gods: Zeus (executive + orchestrators), Athena, Argus, Apollo, Hephaestus, Hebe | ✅ | — |
| Full Pantheon — all 67 god agents + READMEs + starter prompts | ✗ absent from download | ✅ |

The free-tier *rule* restriction is removed entirely. `activeRulesForTier()`
returns all rules for everyone. Tier machinery (`tiers.ts`, `premium/pack.json`
marker) remains for backward compatibility but no longer restricts rules.
Rationale: a security tool that withholds safety rules for money is not honest;
the rule source is public on GitHub anyway. Public source becomes a feature.

`FREE_AGENT_IDS` in `thesmos/scripts/package-agents.ts` is the canonical list of
free agents (already defined: zeus-executive-agent, athena-strategy-agent,
argus-security-agent, apollo-content-agent, hephaestus-design-agent,
zeus-pantheon-orchestrator, zeus-receptionist, zeus-figma-card,
hebe-support-agent).

## Mechanics

### 1. npm tarball stops shipping premium agents

The published package includes only `FREE_AGENT_IDS` catalog files. Premium
agent `.md` files are excluded from the tarball via a `prepack` script that
moves them out of the packaged catalog (and `postpack` restores them) —
chosen over `files` globs because the free list is ID-based, not
path-pattern-based, and a script can assert the result. Consequence:
`pantheon:install --all --write` on a free install can only find and install
the free gods — the gate is physical.

After a free `pantheon:install --all`, the CLI prints (counts computed from
the installed catalog and the canonical pantheon map, never hardcoded):

```
6 of 67 gods installed. The full Pantheon — 67 specialists orchestrated
by Zeus — is $24 (one-time): https://holleystudio.gumroad.com/l/thesmos-pantheon
```

### 2. New `thesmos pantheon:install --pack <zip|dir>`

Installs agents from the purchased Gumroad pack:

- Accepts a path to the downloaded `.zip` or an extracted directory
- Validates agent frontmatter using the existing `agent-lifecycle` validation
- Writes agents to `.thesmos/agents/`, registers each in `registry.json`,
  syncs adapters once at the end (existing `--write` machinery)
- Drops `~/.thesmos/premium/pack.json` marker (back-compat with any existing
  tier checks)
- Idempotent: re-running over an existing install updates files in place
  (`--force` semantics for pack installs)
- Clear errors for: missing file, corrupt zip, no agents found, frontmatter
  validation failures (partial-success reporting per existing batch install)

### 3. VS Code extension

- "Unlock Full Pantheon — $24" action in the Agents panel welcome view and the
  Pantheon Chat empty state; opens the Gumroad URL in the browser
- New command "Thesmos Agents: Install Pantheon Pack…" — file picker for the
  downloaded zip, then runs `npx thesmos pantheon:install --pack <path>` in a
  terminal
- CTA hidden once the full Pantheon is detected (registry count or pack marker)

### 4. Gumroad product

- Price: $79 → **$24**
- Zip build already exists (`npm run agents:pack` → `dist-packs/thesmos-pantheon-agents.zip`)
- Description regenerated and synced (`npm run gumroad:sync`)
- Gumroad grants buyers permanent re-download access to updated files — this is
  the "free updates forever" story with zero infrastructure

## Buyer Experience

```
Buy ($24) → download zip → thesmos pantheon:install --pack ~/Downloads/… → 67 gods live
```

or in VS Code: Buy → download → "Install Pantheon Pack…" → pick file → done.

No account, no key, no activation server, no email verification. Refunds via
Gumroad. Updates via re-download. Support: Hebe (ships free) + GitHub
discussions.

## Piracy stance

Someone can share the zip. Accepted. This is true of all digital content
products; fighting it costs more (time, goodwill, support pain) than it saves
at this stage. The purchase is priced at impulse level precisely so paying is
easier than pirating.

## Rollout

1. **CLI 5.0.0** — de-gate rules, tarball filter, `--pack` flag, upsell message.
   Major bump: the tier semantics change is breaking-ish and "5.0: the tool is
   free, the gods are $24" is the launch story.
2. **Extension** — CTA + pack installer command, next minor version.
3. **Gumroad** — reprice to $24, regenerate + sync description.
4. **Copy flip** — README(s), website pricing section, extension marketplace
   description.

## Error handling

- `--pack` with bad path/corrupt zip → actionable error, no partial writes
  before validation (preflight-then-mutate per existing agent-install pattern)
- Pack from a newer/older CLI version → agents are markdown with frontmatter;
  existing validation covers format skew; no version lock
- Free user runs `--pack` without buying → they simply don't have the file;
  error says where to get it

## Testing

- Unit tests: `--pack` from zip and from directory; corrupt zip; empty pack;
  partial validation failure
- Tarball guard test: assert no premium agent IDs appear in the `npm pack`
  file list (prevents regression of the content gate)
- Rule de-gating test: `activeRulesForTier({tier:'free'})` returns all rules
- Existing 3,208 tests continue to pass

## Out of scope (YAGNI)

- License keys, activation servers, telemetry on installs
- Subscriptions, team licensing, seat management
- Marketing/publicity execution (separate effort; this spec is the product side)
- Website redesign beyond copy changes
