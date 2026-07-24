// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos CLI entry point.
 * Dispatches to command handlers; each handler is a thin wrapper over core modules.
 *
 * Usage:  vite-node bin/cli.ts <command> [flags] [files...]
 */

import { cmdInit } from './commands/init.ts';
import { cmdScan } from './commands/scan.ts';
import { cmdReview } from './commands/review.ts';
import { cmdValidate } from './commands/validate.ts';
import { cmdAudit } from './commands/audit.ts';
import { cmdDoctor } from './commands/doctor.ts';
import { cmdAdapters } from './commands/adapters.ts';
import { cmdCiCheck } from './commands/ci-check.ts';
import { cmdCatalog } from './commands/catalog.ts';
import { cmdAgentCreate } from './commands/agent-create.ts';
import { cmdAgentInstall } from './commands/agent-install.ts';
import { cmdAgentRun } from './commands/agent-run.ts';
import {
  cmdAgentAdopt,
  cmdAgentRelease,
  cmdAgents,
  cmdAgentsConflicts,
  cmdAgentsDoctor,
  cmdAgentsList,
} from './commands/agents-federation.ts';
import { cmdSkillCreate } from './commands/skill-create.ts';
import { cmdDrift } from './commands/drift.ts';
import { cmdBaseline } from './commands/baseline.ts';
import { cmdExplain } from './commands/explain.ts';
import { cmdAdvise } from './commands/advise.ts';
import { cmdSavings } from './commands/savings.ts';
import { cmdSuppressions } from './commands/suppressions.ts';
import { cmdMetrics } from './commands/metrics.ts';
import { cmdPacks } from './commands/packs.ts';
import { cmdHealth } from './commands/health.ts';
import { cmdTier } from './commands/tier.ts';
import { cmdCiGate } from './commands/ci-gate.ts';
import { cmdFix } from './commands/fix.ts';
import { cmdUpdate } from './commands/update.ts';
import { cmdHooks } from './commands/hooks.ts';
import { cmdWatch } from './commands/watch.ts';
import { cmdDiff } from './commands/diff.ts';
import { cmdReport } from './commands/report.ts';
import { cmdAiLint } from './commands/ai-lint.ts';
import { cmdPackCreate } from './commands/pack-create.ts';
import { cmdPackPublish } from './commands/pack-publish.ts';
import { cmdAutopilot } from './commands/autopilot.ts';
import { cmdClaudeGovern } from './commands/claude-govern.ts';
import { cmdImportScan } from './commands/import-scan.ts';
import { cmdScope } from './commands/scope.ts';
import { cmdTokens } from './commands/tokens.ts';
import { cmdDebtScan } from './commands/debt.ts';
import { cmdContext } from './commands/context.ts';
import { cmdCommitLint, cmdCommitCreate } from './commands/commit-lint.ts';
import { cmdVercelLint } from './commands/vercel-lint.ts';
import { cmdCiGithubSecurity } from './commands/ci-github-security.ts';
import { cmdCertificate } from './commands/certificate.ts';
import { cmdMcp } from './commands/mcp.ts';
import { cmdAgentAudit } from './commands/agent-audit.ts';
import { cmdDeps } from './commands/deps.ts';
import { cmdCompliance } from './commands/compliance.ts';
import { cmdAiFingerprint } from './commands/ai-fingerprint.ts';
import { cmdPantheon } from './commands/pantheon.ts';
import { cmdTeams } from './commands/teams.ts';
import { cmdProfile } from './commands/profile.ts';
import { cmdSuppress } from './commands/suppress.ts';
import { cmdVault } from './commands/secrets.ts';
import { cmdNotify } from './commands/notify.ts';
import { cmdGithubComment } from './commands/github-comment.ts';
import { cmdSelf } from './commands/self.ts';
import { cmdBrain } from './commands/brain.ts';
import { cmdPrompt } from './commands/prompt.ts';
import { cmdBuild } from './commands/build.ts';
import { cmdEval } from './commands/eval.ts';
import { cmdScore } from './commands/score.ts';
import { cmdCompile } from './commands/compile.ts';
import { startLspServer } from '../lang-server.ts';
import { makeLogger } from '../logger.ts';
import { checkForUpdate } from './lib/update-check.ts';

const log = makeLogger('cli');

const COMMANDS: Record<string, (argv: string[]) => Promise<void>> = {
  init: cmdInit,
  scan: cmdScan,
  review: cmdReview,
  validate: cmdValidate,
  audit: cmdAudit,
  doctor: cmdDoctor,
  adapters: cmdAdapters,
  'ci-check': cmdCiCheck,
  drift: cmdDrift,
  'baseline:create': (argv) => cmdBaseline('create', argv),
  'baseline:update': (argv) => cmdBaseline('update', argv),
  'baseline:report': (argv) => cmdBaseline('report', argv),
  explain: cmdExplain,
  advise: cmdAdvise,
  tier: cmdTier,
  'suppressions:audit': (argv) => cmdSuppressions('audit', argv),
  metrics: cmdMetrics,
  'pack:list': (argv) => cmdPacks('list', argv),
  'pack:validate': (argv) => cmdPacks('validate', argv),
  'pack:create': cmdPackCreate,
  'pack:publish': cmdPackPublish,
  health: cmdHealth,
  ci: cmdCiGate,
  'ci:github-security': cmdCiGithubSecurity,
  'certificate:generate': cmdCertificate,
  'certificate:verify': (argv) => cmdCertificate(['--verify', ...argv]),
  'mcp:serve': (argv) => cmdMcp(['serve', ...argv]),
  // Documented alias: `thesmos mcp --stdio` (package.json mcp.args) → mcp:serve
  mcp: async (argv) => {
    const rest = argv.filter((a) => a !== '--stdio');
    if (argv.includes('--stdio') || rest.length === 0 || rest[0] === 'serve') {
      await cmdMcp(['serve', ...rest.filter((a) => a !== 'serve')]);
      return;
    }
    await cmdMcp(rest);
  },
  'mcp:install': (argv) => cmdMcp(['install', ...argv]),
  'mcp:uninstall': (argv) => cmdMcp(['uninstall', ...argv]),
  'mcp:status': (argv) => cmdMcp(['status', ...argv]),
  'deps:audit': (argv) => cmdDeps(['audit', ...argv]),
  'agent:audit:log': (argv) => cmdAgentAudit(['log', ...argv]),
  'agent:audit:verify': (argv) => cmdAgentAudit(['verify', ...argv]),
  'agent:audit:report': (argv) => cmdAgentAudit(['report', ...argv]),
  'agent:audit:export': (argv) => cmdAgentAudit(['export', ...argv]),
  'agent:audit:rotate': (argv) => cmdAgentAudit(['rotate', ...argv]),
  'compliance:report': (argv) => cmdCompliance(['report', ...argv]),
  'ai:fingerprint': cmdAiFingerprint,
  'pantheon:list':        (argv) => cmdPantheon(['list', ...argv]),
  'pantheon:install':     (argv) => cmdPantheon(['install', ...argv]),
  'pantheon:status':      (argv) => cmdPantheon(['status', ...argv]),
  'pantheon:export':      (argv) => cmdPantheon(['export', ...argv]),
  'pantheon:orchestrate': (argv) => cmdPantheon(['orchestrate', ...argv]),
  'pantheon:memory':      (argv) => cmdPantheon(['memory', ...argv]),
  'pantheon:upgrade':     (argv) => cmdPantheon(['upgrade', ...argv]),
  'pantheon:remove':      (argv) => cmdPantheon(['remove', ...argv]),
  'pantheon:mode':        (argv) => cmdPantheon(['mode', ...argv]),
  fix: cmdFix,
  savings: cmdSavings,
  report: cmdReport,
  'ai-lint': cmdAiLint,
  'ai-lint:init': (argv) => cmdAiLint(['--from-ai-config', ...argv]),
  update: cmdUpdate,
  watch: cmdWatch,
  diff: cmdDiff,
  'hooks': (argv) => cmdHooks(['install', ...argv]),
  'hooks:install':   (argv) => cmdHooks(['install',   ...argv]),
  'hooks:uninstall': (argv) => cmdHooks(['uninstall', ...argv]),
  'hooks:status':    (argv) => cmdHooks(['status',    ...argv]),
  'catalog:list': (argv) => cmdCatalog(['list', ...argv]),
  'catalog:validate': (argv) => cmdCatalog(['validate', ...argv]),
  'catalog:enable': (argv) => cmdCatalog(['enable', ...argv]),
  'catalog:disable': (argv) => cmdCatalog(['disable', ...argv]),
  'catalog:profiles': (argv) => cmdCatalog(['profiles', ...argv]),
  'agent:create': cmdAgentCreate,
  'agent:install': cmdAgentInstall,
  'agent:run': cmdAgentRun,
  'agent:adopt': cmdAgentAdopt,
  'agent:release': cmdAgentRelease,
  'agents': cmdAgents,
  'agents:list': cmdAgentsList,
  'agents:doctor': cmdAgentsDoctor,
  'agents:conflicts': cmdAgentsConflicts,
  'skill:create': cmdSkillCreate,
  'autopilot': (argv) => cmdAutopilot(argv),
  'autopilot:validate': (argv) => cmdAutopilot(['validate', ...argv]),
  'autopilot:start': (argv) => cmdAutopilot(['start', ...argv]),
  'autopilot:resume': (argv) => cmdAutopilot(['resume', ...argv]),
  'autopilot:cancel': () => cmdAutopilot(['cancel']),
  'autopilot:status': () => cmdAutopilot(['status']),
  'autopilot:revert': (argv) => cmdAutopilot(['revert', ...argv]),
  'autopilot:open-pr':  (argv) => cmdAutopilot(['open-pr', ...argv]),
  'autopilot:generate': (argv) => cmdAutopilot(['generate', ...argv]),
  'autopilot:review':   (argv) => cmdAutopilot(['review', ...argv]),
  'autopilot:stats':    ()     => cmdAutopilot(['stats']),
  'claude:govern':          (argv) => cmdClaudeGovern(argv),
  'claude:govern:install':  ()     => cmdClaudeGovern(['install']),
  'claude:govern:uninstall': ()    => cmdClaudeGovern(['uninstall']),
  'claude:govern:status':   ()     => cmdClaudeGovern(['status']),
  'claude:govern:check':        ()     => cmdClaudeGovern(['check']),
  'claude:govern:budget-check': ()     => cmdClaudeGovern(['budget-check']),
  'import:scan':            (argv) => cmdImportScan(argv),
  'scope:init':             (argv) => cmdScope(['init', ...argv]),
  'scope:status':           ()     => cmdScope(['status']),
  'scope:check':            (argv) => cmdScope(['check', ...argv]),
  'tokens:report':          (argv) => cmdTokens(['report', ...argv]),
  'tokens:reset':           (argv) => cmdTokens(['reset', ...argv]),
  'tokens:budget':          (argv) => cmdTokens(['budget', ...argv]),
  'debt:scan':              (argv) => cmdDebtScan(argv),
  'commit:lint':            (argv) => cmdCommitLint(argv),
  'commit:create':          (argv) => cmdCommitCreate(argv),
  'vercel:lint':            (argv) => cmdVercelLint(argv),
  'context:snapshot':       (argv) => cmdContext(['snapshot', ...argv]),
  'context:health':         (argv) => cmdContext(['health', ...argv]),
  'context:compact':        (argv) => cmdContext(['compact', ...argv]),
  'github:comment':         (argv) => cmdGithubComment(argv),
  'self:check':             (argv) => cmdSelf(['check', ...argv]),
  'self:update':            (argv) => cmdSelf(['update', ...argv]),
  'self:repair':            (argv) => cmdSelf(['repair', ...argv]),
  'self:improve':           ()     => cmdSelf(['improve']),
  'brain:snapshot':         (argv) => cmdBrain(['snapshot', ...argv]),
  'brain:compact':          ()     => cmdBrain(['compact']),
  'brain:hook-install':     ()     => cmdBrain(['hook-install']),
  'brain:observe':          (argv) => cmdBrain(['observe', ...argv]),
  'brain:learn':            (argv) => cmdBrain(['learn', ...argv]),
  'brain:evolve':           (argv) => cmdBrain(['evolve', ...argv]),
  'brain:report':           ()     => cmdBrain(['report']),
  'brain:disable':          ()     => cmdBrain(['disable']),
  'brain:enable':           ()     => cmdBrain(['enable']),
  'brain:promote':          (argv) => cmdBrain(['promote', ...argv]),
  'prompt:list':            (argv) => cmdPrompt(['list', ...argv]),
  'prompt:show':            (argv) => cmdPrompt(['show', ...argv]),
  // prompt:render is the honest name — it interpolates variables and prints;
  // it does not execute anything. prompt:run remains as a deprecated alias.
  'prompt:render':          (argv) => cmdPrompt(['run', ...argv]),
  'prompt:run':             (argv) => cmdPrompt(['run', ...argv]),
  'prompt:suggest':         ()     => cmdPrompt(['suggest']),
  'prompt:import':          (argv) => cmdPrompt(['import', ...argv]),
  'build:agent':            (argv) => cmdBuild(['agent', ...argv]),
  'build:skill':            (argv) => cmdBuild(['skill', ...argv]),
  'build:dashboard':        (argv) => cmdBuild(['dashboard', ...argv]),
  'build:workflow':         (argv) => cmdBuild(['workflow', ...argv]),
  'build:rag':              (argv) => cmdBuild(['rag', ...argv]),
  'build:voice':            (argv) => cmdBuild(['voice', ...argv]),
  'build:mcp-tool':         (argv) => cmdBuild(['mcp-tool', ...argv]),
  'build:automation':       (argv) => cmdBuild(['automation', ...argv]),
  'lsp':                    async () => { startLspServer(); },
  eval:                     (argv) => cmdEval(argv),
  score:                    (argv) => cmdScore(argv),
  compile:                  (argv) => cmdCompile(argv),
  notify:                   (argv) => cmdNotify(argv),
  'pantheon:council':       (argv) => cmdPantheon(['council', ...argv]),
  'pantheon:team':          (argv) => cmdTeams(argv),
  'profile:init':           (argv) => cmdProfile('init', argv),
  'profile:view':           (argv) => cmdProfile('view', argv),
  'profile:correct':        (argv) => cmdProfile('correct', argv),
  'profile:disable':        (argv) => cmdProfile('disable', argv),
  'profile:enable':         (argv) => cmdProfile('enable', argv),
  'profile:set':            (argv) => cmdProfile('set', argv),
  'profile:reset':          (argv) => cmdProfile('reset', argv),
  'suppress':               (argv) => cmdSuppress(argv),
  'secrets:vault':          (argv) => cmdVault('list', argv),
  'secrets:vault:init':     (argv) => cmdVault('init', argv),
  'secrets:vault:set':      (argv) => cmdVault('set', argv),
  'secrets:vault:get':      (argv) => cmdVault('get', argv),
  'secrets:vault:list':     (argv) => cmdVault('list', argv),
  'secrets:vault:delete':   (argv) => cmdVault('delete', argv),
  'secrets:vault:inject':   (argv) => cmdVault('inject', argv),
  'secrets:vault:destroy':  (argv) => cmdVault('destroy', argv),
};

const argv = process.argv.slice(2); // ['command', ...flags]
const command = argv[0];

if (!command || command === '--help' || command === 'help') {
  console.log(`
Thesmos — AI Repo Governance

  A governance layer for AI coding assistants (Claude, Gemini, Cursor, Copilot, Codex).
  Detects unsafe patterns, keeps adapter files fresh, and gates CI automatically.

SETUP
  init                     Scaffold .thesmos/ + generate AI adapter files (--no-adapters to skip)
  init --interactive        Interactive wizard — detect framework, pick adapters, configure CI
  init --from-ai-config    Read CLAUDE.md/.cursorrules and generate .thesmos/config.json
  scan                     Analyse repo structure → .thesmos/report.json
  adapters                 Regenerate all AI adapter files (CLAUDE.md, etc.)
  update                   Convenience: scan + adapters + drift check in one command
  watch                    Real-time review — re-runs on every file change
    --clear                  Clear terminal on each update
    --debounce=<ms>          Debounce delay (default: 400ms)

HOOKS  (governance checks in git hooks — no extra dependencies)
  hooks install            Install pre-commit + pre-push hooks in .git/hooks/
  hooks install --husky    Install in .husky/ (committed, team-wide)
  hooks uninstall          Remove thesmos blocks from hooks
  hooks status             Show current hook state

MCP SERVER  (governance-before-writing — AI calls scan_file before generating code)
  mcp:install              Add thesmos to ~/.claude/settings.json as an MCP server
  mcp:serve                Start the MCP server (stdio JSON-RPC 2.0 — used by mcp:install)
  mcp [--stdio]            Alias for mcp:serve (matches package.json mcp.args)
  mcp:status               Show whether MCP server is configured
  mcp:uninstall            Remove MCP server from ~/.claude/settings.json

  MCP tools (called by AI agents during sessions):
    scan_file(path, content)    Scan file for violations before Write/Edit — logs to governance.log
    check_path(tool, path)      Validate path before write/delete — blocks .env, keys, credentials
    explain_rule(ruleId)        Rule metadata + fix examples
    get_context()               .thesmos/context.md contents
    get_token_budget()          Session/daily/project token spend vs. configured limits
    check_model_cost(tokens)    Haiku/Sonnet/Opus cost comparison for a token count

CLAUDE CODE AUTO MODE  (real-time governance when Claude Code runs autonomously)
  claude:govern install    Install PreToolUse + Stop hooks into .claude/settings.json
  claude:govern uninstall  Remove governance hooks
  claude:govern status     Show hook installation state

AGENT AUDIT TRAIL  (tamper-evident log of every AI agent action)
  agent:audit:log <tool> <file>   Append an audit entry (called from PostToolUse hooks)
    --status <PASS|BLOCKED|WARN>    Governance decision
    --findings <id,...>             Comma-separated finding IDs
  agent:audit:verify               Verify hash chain integrity — detect tampering
  agent:audit:report               Human-readable action summary (last 20 entries)
    --json                           Machine-readable JSON
    --limit=<n>                      Show last n entries (default: 50)
  agent:audit:export --format csv  Export all entries for compliance reporting
  agent:audit:rotate               Archive current log and start fresh

SUPPLY CHAIN SECURITY
  import:scan              Check all package imports against npm and PyPI registries
  import:scan --strict     Also flag packages < 30 days old and missing READMEs
  import:scan --ci         Exit 1 on any BLOCKER (phantom) finding
  import:scan [files...]   Scan specific files

AGENT SCOPE ENFORCEMENT
  scope:init               Scaffold .thesmos/scope.json with safe defaults
  scope:status             Show current scope boundaries and operation limits
  scope:check <path|cmd>   Test if a file path or command would be blocked

TOKEN BUDGET GOVERNANCE
  tokens:report            Show AI token usage by session / day / project
  tokens:report --json     Machine-readable output
  tokens:reset --session   Reset current session budget counter
  tokens:reset --all       Clear all token usage logs
  tokens:budget            Show current budget configuration

AI DEBT FINGERPRINTING
  debt:scan                Scan source files for AI-generated debt patterns (DEBT_001–020)
  debt:scan <path>         Scan a specific file or directory
  debt:scan --ci           Exit 1 on HIGH+ findings (CI gate)
  debt:scan --json         Machine-readable output

CONTEXT HEALTH + SESSION HANDOFF
  context:snapshot         Generate .thesmos/context.md from current stack + patterns
  context:health           Check freshness of context snapshot and adapter files
  context:health --fail    Exit 1 if health score is below threshold (default 60)
  context:health --json    Machine-readable JSON output

REVIEW & VALIDATE
  review                   Run all rules, print findings (logs to governance.log)
  validate                 Run rules, exit 1 on BLOCKER/HIGH (use in CI)
    --base=<branch>          Only check files changed vs. <branch>
    --no-baseline            Ignore baseline when computing exit code
    --no-log                 Skip appending events to governance.log.jsonl
  validate --json          Machine-readable findings
  validate --sarif         SARIF 2.1.0 output (GitHub Code Scanning, VS Code, JetBrains)
  validate --markdown      Markdown summary for PR comments

REPORT
  report                   Generate a visual governance report
  report --html            Self-contained HTML report (default)
  report --out=<path>      Write to file (default: .thesmos/report.html)
  report --open            Open in browser after writing
  report --json            Machine-readable findings JSON
  report --markdown        Markdown summary

BASELINES  (suppress known debt, focus CI on new issues)
  baseline:create          Snapshot current findings as baseline
    --force                  Overwrite existing baseline
  baseline:update          Update baseline with resolved/new findings
  baseline:report          Show baselined findings

DIFF
  diff                     Compare stored findings baseline vs. current scan
    --baseline=<path>        Path to baseline findings JSON (default: .thesmos/findings.json)
    --base=<branch>          Only review files changed vs. <branch>
    --all                    Review all files (default: scan-based checks only)
    --fail-on=<severity>     Exit 1 when new findings meet this severity (default: BLOCKER)
    --save                   Save current findings as the new baseline after diffing
    --json                   Machine-readable JSON output

DRIFT DETECTION
  drift                    Detect stale adapters and missing required files
  drift --json

GOVERNANCE EVALUATION
  eval                     Governance visibility report — compliance score + blocked actions
    --since=<duration>       Time window: 24h (default), 7d, 30d
    --json                   Machine-readable JSON
    --markdown               Markdown (for PR comments, docs)
    --all                    Full log — all recorded events
    Exit 1 if any blocked or bypassed events exist (use in CI)

  score                    Governance maturity score (0–100) + shields.io badge URL
    --badge                  Print only the Markdown badge snippet
    --json                   Machine-readable JSON
    Paste badge into README: [![Thesmos Score](url)](https://holley.studio/thesmos)

  compile                  Compile rules to provider-specific instruction format
    --provider anthropic     System prompt block for Claude / Claude Code (default)
    --provider openai        System instructions for GPT-4 / Assistants API
    --provider google        System instructions for Gemini / Gemini CLI
    --provider all           All three → .thesmos/compiled/
    --categories <csv>       Only include rules from these categories (e.g. sec,auth)
    --severity <level>       Minimum severity: BLOCKER, HIGH, MEDIUM, LOW
    --out <dir>              Write to custom directory
    --json                   Machine-readable JSON

GOVERNANCE HEALTH
  health                   Governance score 0–100 with grade and priority actions
    --fail --threshold=<n>   Exit 1 if score is below n (default 60)
    --badge                  Print shield.io badge URL to stdout
  health --json
  ci                       Combined gate: validate + drift + suppressions + health
    --base=<branch>
    --no-baseline
    --health-threshold=<n>
  ci --json
  ci:github-security       Generate GitHub Actions workflow that uploads SARIF to Security tab
    --write                  Write to .github/workflows/thesmos-security.yml
  certificate:generate     Generate a signed governance certificate for this delivery
    --write                  Write to .thesmos/certificate.json
  certificate:verify       Verify hash integrity of .thesmos/certificate.json

DEPENDENCY SECURITY
  deps:audit               Query OSV.dev for CVEs in all project dependencies
    --sbom                   Also write CycloneDX 1.4 SBOM to thesmos.sbom.json
    --no-cache               Force refresh (bypass 24h cache)

GDPR COMPLIANCE
  compliance:report --standard gdpr   Generate audit-ready GDPR evidence report
    --write                              Write to .thesmos/compliance-gdpr.md
    --output=<path>                      Write to custom path

THESMOS PANTHEON  (governed AI business team — 40 agents, 6 platforms)
  pantheon:list                       List Pantheon agents with roles and mythology
  pantheon:install --all              Add all agents to .thesmos/registry.json
  pantheon:install <id> [id...]       Install specific agents
  pantheon:status                     Show active Pantheon agents in this project
  pantheon:export --target <platform> Export agents to platform-specific format
    --target claude-code                pantheon/exports/claude-code/*.md (native sub-agents)
    --target claude-project             Paste-ready text for Claude Projects
    --target chatgpt                    Paste-ready text for ChatGPT Custom GPT
    --target openai-assistant          JSON for OpenAI Assistants API
    --target cursor                     pantheon/exports/cursor/*.mdc
    --target copilot                    pantheon/exports/copilot/*.instructions.md
    --target gemini                     Paste-ready text for Gemini Gems
    --target codex                      pantheon/exports/codex/*.md (plain instructions, no frontmatter)
    --target agents-md                  AGENTS.md (Linux Foundation standard — Codex, Copilot, Windsurf, Zed, Aider)
    --target all                        All 9 formats → pantheon/exports/ + AGENTS.md at repo root
    --agent <id>                        Export a single agent only
    --out <dir>                         Custom output directory
  pantheon:orchestrate "<task>"       Zeus routes your task to the right agents
    --out <file>                        Write brief to file
  pantheon:memory save --agent <id> "<note>"   Save persistent context for an agent
  pantheon:memory show --agent <id>            View agent's memory file
  pantheon:memory clear --agent <id>           Clear agent's memory
  pantheon:upgrade                    Check for newer agent versions
  pantheon:remove --all               Remove all agents from registry
  pantheon:remove <id> [id...]        Remove specific agents
  pantheon:mode                       Show current Pantheon power mode
  pantheon:mode normal                Conservative, token-saving mode (power: lean)
  pantheon:mode god                   Full "feel of the gods" ceremony mode (power: god)

AI CODE FINGERPRINTING
  ai:fingerprint           Detect AI-generated files using git co-author markers and
                           content heuristics (comment style, structural patterns)
    --format json|text       Output format (default: text)
    --output=<path>          Write to file
    --min-confidence=<n>     Only show files above n% confidence (default: 0)

AI BEHAVIOR FILE LINTER
  ai-lint                  Lint CLAUDE.md/.cursorrules/GEMINI.md for governance gaps
    --json                   Machine-readable JSON
    --markdown               Markdown report
  ai-lint --from-ai-config Detect stack from AI config and generate .thesmos/config.json
    --dry-run                Preview without writing

SUPPRESSIONS
  suppressions:audit       Find expired, missing-reason, or blanket suppressions
  suppressions:audit --json

EXPLAIN & DISCOVER
  explain <rule-id>        Why a rule exists, examples, agents, skills
  explain <category>       Explain by category name
  explain file <path>      Rules active on a specific file
  explain finding <fp>     Rule for a baseline fingerprint
  explain --list           All rules with severity and description

SECRETS VAULT  (local encrypted secrets — never transmitted)
  secrets:vault init              Create vault + store master key in system keychain
  secrets:vault set <KEY> [VAL]   Encrypt and store a secret (prompts if VAL omitted)
  secrets:vault get <KEY>         Decrypt and print a secret value
  secrets:vault list              List key names and timestamps (values never shown)
  secrets:vault delete <KEY>      Remove a secret
  secrets:vault inject            List keys, or use --export for shell-sourceable export
  secrets:vault destroy           Permanently delete vault + keychain entry

FIX
  fix                      Auto-fix safe violations (dry-run by default)
    --apply                  Write changes to disk
    --rule=<id>              Fix only this rule

METRICS
  metrics                  Governance analytics (local-first, no telemetry)
  metrics --record         Append snapshot to .thesmos/metrics-history.jsonl
  metrics --history        Show trend over last N snapshots
  metrics --json

PACKS
  pack:list                Show installed rule packs
  pack:validate            Validate pack manifests
  pack:create <@scope/name>  Scaffold a new pack with rules/, agents/, skills/
    --author="My Org"        Set author field in pack.json
    --dry-run                Preview files without writing
  pack:publish [name]       Compile, validate, and npm publish a pack
    --compile                  Run tsup to compile rules/index.ts first
    --dry-run                  Preview without publishing
    --access=<level>           npm publish access (default: public)
    --tag=<tag>                npm dist-tag (e.g. --tag=beta)

CUSTOM AGENTS
  agent:create "<Name>"    Scaffold a new agent in .thesmos/agents/ and register it
    --no-sync                Skip adapter synchronization after creation
  agent:install <file>     Install an agent .md file into .thesmos/agents/ and register it
  agent:install <dir>      Install all .md files in a directory (non-recursive, sorted order)
    --force                  Overwrite an existing canonical file
    --dry-run                Validate and show proposed operations without mutating files
    --no-sync                Install and register but skip adapter synchronization
  agent:adopt <path>       Adopt an external agent into Thesmos ownership
    --force --dry-run --no-sync
  agent:release <id>       Stop managing an agent (preserves file by default)
    --dry-run --delete

FEDERATED AGENTS
  agents:list [--all] [--json]     List project, user, plugin, and Pantheon agents
  agents:doctor [--json] [--strict]
  agents:conflicts [--json] [--strict]
    Exit 2 with --strict when conflicts/shadows exist (CI)

CATALOG
  catalog:list             List all agents and skills
  catalog:validate         Validate catalog frontmatter
  catalog:enable           Enable agents/skills into .thesmos/registry.json
  catalog:disable          Disable agents/skills
  catalog:profiles         List profiles
  skill:create             Scaffold a new skill file

AUTOPILOT  (disabled by default — enable in .thesmos/config.json)
  autopilot validate <plan>     Validate plan file, generate .review.md
  autopilot start <plan>        Run plan autonomously (prompts CONFIRMED)
    --yes                         Skip CONFIRMED prompt (warnings still shown)
    --dry-run                     Parse and display without executing
  autopilot resume <plan>       Resume from last completed task
  autopilot cancel              Stop running session after current task
  autopilot status              Show current session state
  autopilot revert [session]    Delete autopilot branch, archive journal
  autopilot open-pr [session]   Push branch, create draft PR

DIAGNOSTICS
  doctor [--json] [--soft] Check installation health (exit 1 on failure; --soft = exit 0)
  audit                    Detailed file-level audit report
  ci-check                 Adapter freshness CI check (legacy; use 'ci' instead)

PLANNING
  advise <plan-file>       Recommend a model + Pantheon agents to execute a plan
  advise --text="..."      Same, for inline text instead of a file
    --json                   Machine-readable JSON output

GLOBAL FLAGS
  --json                   Machine-readable JSON output
  --markdown               Markdown output (great for PR comments)
  --dry-run                Preview changes without writing files

EXAMPLES
  thesmos scan && thesmos validate --base=main
  thesmos ci --base=main --health-threshold=75
  thesmos explain missing_api_auth
  thesmos advise plans/my-feature.md
  thesmos baseline:create && thesmos validate
  thesmos metrics --record
  thesmos fix --apply
`);
  process.exit(0);
}

const handler = COMMANDS[command];
if (!handler) {
  process.stderr.write(`thesmos: unknown command "${command}"\n`);
  process.stderr.write(`Available: ${Object.keys(COMMANDS).join(', ')}\n`);
  process.exit(1);
}

const cliStart = Date.now();
log.info('command start', { command });

// Skip update check for machine-readable commands and update itself
const SKIP_UPDATE_CHECK = new Set(['tokens:report', 'health', 'self:check', 'self:update', 'self:improve', 'profile:view', 'lsp']);

handler(argv.slice(1))
  .then(() => {
    log.info('command complete', { command, durationMs: Date.now() - cliStart });
    if (!SKIP_UPDATE_CHECK.has(command)) void checkForUpdate();
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('command failed', {
      command,
      error: msg,
      stack: err instanceof Error ? err.stack : undefined,
      durationMs: Date.now() - cliStart,
    });
    process.stderr.write(`thesmos ${command}: ${msg}\n`);
    process.exit(1);
  });
