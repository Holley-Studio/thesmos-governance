/**
 * Prometheus CLI entry point.
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
import { cmdSkillCreate } from './commands/skill-create.ts';
import { cmdDrift } from './commands/drift.ts';
import { cmdBaseline } from './commands/baseline.ts';
import { cmdExplain } from './commands/explain.ts';
import { cmdSuppressions } from './commands/suppressions.ts';
import { cmdMetrics } from './commands/metrics.ts';
import { cmdPacks } from './commands/packs.ts';
import { cmdHealth } from './commands/health.ts';
import { cmdCiGate } from './commands/ci-gate.ts';
import { cmdFix } from './commands/fix.ts';
import { cmdUpdate } from './commands/update.ts';

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
  'suppressions:audit': (argv) => cmdSuppressions('audit', argv),
  metrics: cmdMetrics,
  'pack:list': (argv) => cmdPacks('list', argv),
  'pack:validate': (argv) => cmdPacks('validate', argv),
  health: cmdHealth,
  ci: cmdCiGate,
  fix: cmdFix,
  update: cmdUpdate,
  'catalog:list': (argv) => cmdCatalog(['list', ...argv]),
  'catalog:validate': (argv) => cmdCatalog(['validate', ...argv]),
  'catalog:enable': (argv) => cmdCatalog(['enable', ...argv]),
  'catalog:disable': (argv) => cmdCatalog(['disable', ...argv]),
  'catalog:profiles': (argv) => cmdCatalog(['profiles', ...argv]),
  'agent:create': cmdAgentCreate,
  'skill:create': cmdSkillCreate,
};

const argv = process.argv.slice(2); // ['command', ...flags]
const command = argv[0];

if (!command || command === '--help' || command === 'help') {
  console.log(`
Prometheus — AI Repo Governance

  A governance layer for AI coding assistants (Claude, Gemini, Cursor, Copilot, Codex).
  Detects unsafe patterns, keeps adapter files fresh, and gates CI automatically.

SETUP
  init                     Scaffold .prometheus/ governance folder
  scan                     Analyse repo structure → .prometheus/report.json
  adapters                 Regenerate all AI adapter files (CLAUDE.md, etc.)
  update                   Convenience: scan + adapters + drift check in one command

REVIEW & VALIDATE
  review                   Run all rules, print findings
  validate                 Run rules, exit 1 on BLOCKER/HIGH (use in CI)
    --base=<branch>          Only check files changed vs. <branch>
    --no-baseline            Ignore baseline when computing exit code
  validate --json          Machine-readable findings
  validate --markdown      Markdown summary for PR comments

BASELINES  (suppress known debt, focus CI on new issues)
  baseline:create          Snapshot current findings as baseline
    --force                  Overwrite existing baseline
  baseline:update          Update baseline with resolved/new findings
  baseline:report          Show baselined findings

DRIFT DETECTION
  drift                    Detect stale adapters and missing required files
  drift --json

GOVERNANCE HEALTH
  health                   Governance score 0–100 with grade and priority actions
    --fail --threshold=<n>   Exit 1 if score is below n (default 60)
  health --json
  ci                       Combined gate: validate + drift + suppressions + health
    --base=<branch>
    --no-baseline
    --health-threshold=<n>
  ci --json

SUPPRESSIONS
  suppressions:audit       Find expired, missing-reason, or blanket suppressions
  suppressions:audit --json

EXPLAIN & DISCOVER
  explain <rule-id>        Why a rule exists, examples, agents, skills
  explain <category>       Explain by category name
  explain file <path>      Rules active on a specific file
  explain finding <fp>     Rule for a baseline fingerprint
  explain --list           All rules with severity and description

FIX
  fix                      Auto-fix safe violations (dry-run by default)
    --apply                  Write changes to disk
    --rule=<id>              Fix only this rule

METRICS
  metrics                  Governance analytics (local-first, no telemetry)
  metrics --record         Append snapshot to .prometheus/metrics-history.jsonl
  metrics --history        Show trend over last N snapshots
  metrics --json

PACKS
  pack:list                Show installed rule packs
  pack:validate            Validate pack manifests

CATALOG
  catalog:list             List all agents and skills
  catalog:validate         Validate catalog frontmatter
  catalog:enable           Enable agents/skills into .prometheus/registry.json
  catalog:disable          Disable agents/skills
  catalog:profiles         List profiles
  agent:create             Scaffold a new agent file
  skill:create             Scaffold a new skill file

DIAGNOSTICS
  doctor                   Check installation health
  audit                    Detailed file-level audit report
  ci-check                 Adapter freshness CI check (legacy; use 'ci' instead)

GLOBAL FLAGS
  --json                   Machine-readable JSON output
  --markdown               Markdown output (great for PR comments)
  --dry-run                Preview changes without writing files

EXAMPLES
  prometheus scan && prometheus validate --base=main
  prometheus ci --base=main --health-threshold=75
  prometheus explain missing_api_auth
  prometheus baseline:create && prometheus validate
  prometheus metrics --record
  prometheus fix --apply
`);
  process.exit(0);
}

const handler = COMMANDS[command];
if (!handler) {
  process.stderr.write(`prometheus: unknown command "${command}"\n`);
  process.stderr.write(`Available: ${Object.keys(COMMANDS).join(', ')}\n`);
  process.exit(1);
}

handler(argv.slice(1)).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`prometheus ${command}: ${msg}\n`);
  process.exit(1);
});
