/**
 * Thesmos AI Behavior File Linter
 *
 * Reads AI behavior files (CLAUDE.md, .cursorrules, GEMINI.md, etc.) and
 * checks them for governance gaps: missing security guidance, anti-patterns,
 * and divergence from the active Thesmos config.
 *
 * Also provides initFromAiConfig() for `thesmos init --from-ai-config`,
 * which reads these files and generates a starter .thesmos/config.json
 * using the best matching preset.
 */

import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Finding } from './types.js';

// ── AI config file discovery ──────────────────────────────────────────────────

export type AiTool = 'claude' | 'cursor' | 'gemini' | 'codex' | 'copilot' | 'agents' | 'unknown';

export interface AiConfigFile {
  relPath: string;
  absPath: string;
  tool: AiTool;
  content: string;
  bytes: number;
}

const AI_CONFIG_CANDIDATES: Array<{ relPath: string; tool: AiTool }> = [
  { relPath: 'CLAUDE.md',                tool: 'claude'  },
  { relPath: '.claude/CLAUDE.md',        tool: 'claude'  },
  { relPath: '.claude/README.md',        tool: 'claude'  },
  { relPath: '.cursorrules',             tool: 'cursor'  },
  { relPath: '.cursor/rules',            tool: 'cursor'  },
  { relPath: '.cursor/rules.md',         tool: 'cursor'  },
  { relPath: 'GEMINI.md',               tool: 'gemini'  },
  { relPath: '.gemini/GEMINI.md',        tool: 'gemini'  },
  { relPath: 'AGENTS.md',               tool: 'agents'  },
  { relPath: 'CODEX.md',                tool: 'codex'   },
  { relPath: '.github/copilot-instructions.md', tool: 'copilot' },
  { relPath: 'COPILOT.md',              tool: 'copilot' },
];

export function discoverAiConfigFiles(root: string): AiConfigFile[] {
  const files: AiConfigFile[] = [];

  for (const { relPath, tool } of AI_CONFIG_CANDIDATES) {
    const absPath = join(root, relPath);
    if (!existsSync(absPath)) continue;

    try {
      const stat = statSync(absPath);
      if (!stat.isFile()) continue;
      const content = readFileSync(absPath, 'utf8');
      files.push({ relPath, absPath, tool, content, bytes: stat.size });
    } catch {
      // Unreadable — skip
    }
  }

  return files;
}

// ── Lint rules ────────────────────────────────────────────────────────────────

const SECURITY_KEYWORDS = /security|auth(?:entication|orization)?|csrf|xss|sql\s?injection|rate[- ]?limit|sanitiz|validat|escape|encrypt/i;
const TEST_KEYWORDS = /\btest(?:s|ing)?\b|\bspec\b|\bvitest\b|\bjest\b|\bunit test\b/i;
const SKIP_TESTS_RE = /(?:don['']?t|never|skip|no)\s+(?:write\s+)?tests?|tests?\s+(?:are\s+)?(?:not\s+)?(?:needed|required|necessary)/i;
const FORCE_PUSH_RE = /\bgit\s+push\s+[^#\n]*--force\b|force[- ]?push(?!\s+(?:is\s+)?(?:not|never|disallowed|forbidden|prohibited))/i;
const SKIP_REVIEW_RE = /(?:skip|bypass|don['']?t|never)\s+(?:code\s+)?review|no\s+(?:code\s+)?review\s+(?:needed|required)/i;
const SECRET_COMMIT_MATCH_RE = /(?:commit|push|store|add)\s+(?:secrets?|api\s*keys?|passwords?|credentials?)\s+(?:in|to|into)\s+(?:code|git|repo)/i;
const SECRET_NEGATION_RE = /\b(?:never|don['']?t|avoid|not|prohibit)\b/i;
const API_KEYWORDS = /\bapi\b|\broute\b|\bendpoint\b/i;
const API_SECURITY_KEYWORDS = /\bauth(?:entication|orization)?\b|\brate\s*limit\b|\bbearer\b|\bjwt\b|\bsession\b/i;
const ARCH_KEYWORDS = /\bnext(?:js|\.js)?\b|\breact\b|\bnode\b|\bprisma\b|\bpostgres\b|\btypescript\b|\bapi\b|\bcomponent\b|\bservice\b|\bdatabase\b|\bexpress\b/ig;
const THESMOS_KEYWORDS = /thesmos|governance|guardrail/i;

export interface AiLintFinding extends Finding {
  file: string;
}

export function lintAiConfigFiles(
  root: string,
  files: AiConfigFile[],
): AiLintFinding[] {
  const findings: AiLintFinding[] = [];
  const thesmosConfigExists = existsSync(join(root, '.thesmos', 'config.json'));

  // AICFG_001: No AI behavior files at all
  if (files.length === 0) {
    findings.push({
      severity: 'MEDIUM',
      category: 'ai_config_missing',
      file: '.',
      message: 'No AI behavior files found (CLAUDE.md, .cursorrules, GEMINI.md, etc.).',
      suggestion:
        'Run "thesmos adapters" to generate AI behavior files for all your AI tools, ' +
        'or run "thesmos init --from-ai-config" if you have existing config files.',
    });
    return findings;
  }

  for (const f of files) {
    const loc = { file: f.relPath };

    // AICFG_002: Placeholder / too short
    if (f.bytes < 200) {
      findings.push({
        severity: 'LOW',
        category: 'ai_config_placeholder',
        ...loc,
        message: `${f.relPath} is very short (${f.bytes} bytes) — likely a placeholder with no real guidance.`,
        suggestion: 'Add security rules, architecture constraints, and testing guidelines. Run "thesmos adapters" to populate it.',
      });
      continue; // other checks won't be meaningful on a stub
    }

    // AICFG_003: No security section
    if (!SECURITY_KEYWORDS.test(f.content)) {
      findings.push({
        severity: 'HIGH',
        category: 'ai_config_no_security',
        ...loc,
        message: `${f.relPath} has no security guidance (no mention of auth, CSRF, XSS, rate limiting, or input validation).`,
        suggestion:
          'Add a Security section covering: CSRF protection, input validation, auth requirements, ' +
          'rate limiting, and secret handling. AI tools skip these controls 100% of the time without explicit instructions.',
      });
    }

    // AICFG_004: Discourages testing
    if (SKIP_TESTS_RE.test(f.content)) {
      findings.push({
        severity: 'HIGH',
        category: 'ai_config_discourages_tests',
        ...loc,
        message: `${f.relPath} appears to instruct the AI to skip writing tests.`,
        suggestion:
          'Remove test-discouraging instructions. AI-generated code without tests is a primary source of silent regressions. ' +
          'Add: "Always write unit tests for new functions and API routes."',
      });
    }

    // AICFG_005: Permits force push (heuristic — mentions it without "never")
    if (FORCE_PUSH_RE.test(f.content)) {
      findings.push({
        severity: 'MEDIUM',
        category: 'ai_config_permits_force_push',
        ...loc,
        message: `${f.relPath} may permit or instruct git force push, which can destroy history on shared branches.`,
        suggestion: 'Add an explicit rule: "Never force push to main or shared branches."',
      });
    }

    // AICFG_006: Skips code review
    if (SKIP_REVIEW_RE.test(f.content)) {
      findings.push({
        severity: 'HIGH',
        category: 'ai_config_skips_review',
        ...loc,
        message: `${f.relPath} appears to instruct the AI to skip or bypass code review.`,
        suggestion: 'Remove review-bypassing instructions. Require all AI-generated code to go through the standard review gate.',
      });
    }

    // AICFG_007: Permits committing secrets (skip lines that contain negation)
    {
      const secretLine = f.content.split('\n').find(
        (line) => SECRET_COMMIT_MATCH_RE.test(line) && !SECRET_NEGATION_RE.test(line),
      );
      if (secretLine !== undefined) {
        findings.push({
          severity: 'BLOCKER',
          category: 'ai_config_permits_secrets',
          ...loc,
          message: `${f.relPath} may instruct the AI to commit secrets or credentials to the repository.`,
          suggestion: 'Remove any instructions that involve storing secrets in code. Use environment variables and a secrets manager.',
        });
      }
    }

    // AICFG_008: Has API references but no auth/security guidance for them
    if (API_KEYWORDS.test(f.content) && !API_SECURITY_KEYWORDS.test(f.content)) {
      findings.push({
        severity: 'HIGH',
        category: 'ai_config_no_api_security',
        ...loc,
        message: `${f.relPath} mentions API/routes but has no authentication or rate-limiting guidance.`,
        suggestion:
          'Add: "All API routes must require authentication unless explicitly marked public. ' +
          'Add rate limiting to all public-facing endpoints."',
      });
    }

    // AICFG_009: No testing guidelines at all in a substantial file
    if (f.bytes > 500 && !TEST_KEYWORDS.test(f.content)) {
      findings.push({
        severity: 'LOW',
        category: 'ai_config_no_testing_guidelines',
        ...loc,
        message: `${f.relPath} has no testing guidelines — AI tools won't know when or how to write tests.`,
        suggestion:
          'Add a Testing section: specify the test runner (vitest/jest), expected coverage, ' +
          'and which types of tests are required for new features.',
      });
    }

    // AICFG_010: .thesmos/config.json exists but AI config doesn't mention Thesmos
    if (thesmosConfigExists && !THESMOS_KEYWORDS.test(f.content)) {
      findings.push({
        severity: 'MEDIUM',
        category: 'ai_config_not_synced',
        ...loc,
        message: `${f.relPath} doesn't mention Thesmos governance, but .thesmos/config.json exists.`,
        suggestion:
          'Run "thesmos adapters" to regenerate AI behavior files with the Thesmos governance rules ' +
          'embedded so the AI knows to follow them.',
      });
    }

    // AICFG_011: No architectural constraints (tech stack) in a substantial file
    const archMatches = f.content.match(ARCH_KEYWORDS) ?? [];
    if (f.bytes > 1000 && archMatches.length < 2) {
      findings.push({
        severity: 'LOW',
        category: 'ai_config_no_architecture',
        ...loc,
        message: `${f.relPath} has no architectural constraints — AI tools may make inconsistent tech-stack choices.`,
        suggestion:
          'Add an Architecture section that specifies: framework (e.g. Next.js), ORM (e.g. Prisma), ' +
          'state management, and any forbidden libraries.',
      });
    }
  }

  return findings;
}

// ── Tech-stack detection for init --from-ai-config ────────────────────────────

interface DetectedStack {
  frameworks: string[];
  isAiHeavy: boolean;
  hasSecurityRules: boolean;
  hasGovGaps: boolean;
  recommendedPreset: 'thesmos/recommended' | 'thesmos/vibe-coding' | 'thesmos/ai-strict';
  confidence: 'high' | 'medium' | 'low';
}

const VIBE_SIGNALS = /vibe[- ]?cod|ai[- ]?generat|claude|gpt|copilot|cursor|gemini|llm|ai[- ]?assist/i;
const AI_STRICT_SIGNALS = /100%\s+ai|fully\s+ai[- ]?generat|all\s+code\s+(?:is\s+)?ai/i;

function detectStack(files: AiConfigFile[]): DetectedStack {
  const combined = files.map((f) => f.content).join('\n');

  const frameworks: string[] = [];
  if (/\bnext(?:js|\.js)?\b/i.test(combined)) frameworks.push('Next.js');
  if (/\bremix\b/i.test(combined)) frameworks.push('Remix');
  if (/\breact\b/i.test(combined)) frameworks.push('React');
  if (/\bvite\b|\bvitejs\b/i.test(combined)) frameworks.push('Vite');
  if (/\bexpress\b/i.test(combined)) frameworks.push('Express');
  if (/\bfastify\b/i.test(combined)) frameworks.push('Fastify');
  if (/\bprisma\b/i.test(combined)) frameworks.push('Prisma');
  if (/\bdrizzle\b/i.test(combined)) frameworks.push('Drizzle');
  if (/\btrpc\b/i.test(combined)) frameworks.push('tRPC');
  if (/\bsupabase\b/i.test(combined)) frameworks.push('Supabase');

  const isAiHeavy = files.length > 0 || VIBE_SIGNALS.test(combined);
  const isAiStrict = AI_STRICT_SIGNALS.test(combined);
  const hasSecurityRules = SECURITY_KEYWORDS.test(combined);
  const hasGovGaps = !hasSecurityRules || SKIP_TESTS_RE.test(combined);

  let recommendedPreset: DetectedStack['recommendedPreset'];
  if (isAiStrict) {
    recommendedPreset = 'thesmos/ai-strict';
  } else if (isAiHeavy || !hasSecurityRules) {
    recommendedPreset = 'thesmos/vibe-coding';
  } else {
    recommendedPreset = 'thesmos/recommended';
  }

  const confidence =
    files.length >= 2 ? 'high' : files.length === 1 && files[0]!.bytes > 500 ? 'medium' : 'low';

  return { frameworks, isAiHeavy, hasSecurityRules, hasGovGaps, recommendedPreset, confidence };
}

// ── init --from-ai-config ─────────────────────────────────────────────────────

export interface InitFromAiConfigResult {
  filesRead: string[];
  stack: DetectedStack;
  configPath: string;
  configWritten: boolean;
  configAlreadyExisted: boolean;
  lintFindings: AiLintFinding[];
}

export function initFromAiConfig(root: string, dryRun = false): InitFromAiConfigResult {
  const files = discoverAiConfigFiles(root);
  const stack = detectStack(files);
  const lintFindings = lintAiConfigFiles(root, files);

  const configPath = join(root, '.thesmos', 'config.json');
  const configAlreadyExisted = existsSync(configPath);
  let configWritten = false;

  if (!configAlreadyExisted && !dryRun) {
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

    const generatedConfig = {
      $schema: '../node_modules/thesmos-governance/config.schema.json',
      extends: stack.recommendedPreset,
      project: 'my-project',
      ...(stack.frameworks.length > 0 ? { _detected_frameworks: stack.frameworks } : {}),
    };

    writeFileSync(configPath, JSON.stringify(generatedConfig, null, 2) + '\n', 'utf8');
    configWritten = true;
  }

  return {
    filesRead: files.map((f) => f.relPath),
    stack,
    configPath,
    configWritten,
    configAlreadyExisted,
    lintFindings,
  };
}

// ── Formatters ────────────────────────────────────────────────────────────────

const SEVERITY_ICON: Record<string, string> = {
  BLOCKER: '🔴',
  HIGH: '🟠',
  MEDIUM: '🟡',
  LOW: '🔵',
  TECH_DEBT: '⚪',
};

export function formatAiLintConsole(
  findings: AiLintFinding[],
  fileCount: number,
  projectName = 'Repo',
): string {
  const SEP = '─'.repeat(60);
  const lines: string[] = [];

  lines.push(`Thesmos AI-Lint — ${projectName}`);
  lines.push(`  ${fileCount} AI behavior file${fileCount === 1 ? '' : 's'} scanned`);
  lines.push(SEP);
  lines.push('');

  if (findings.length === 0) {
    lines.push('  ✅  All AI behavior files pass governance checks.');
    lines.push('');
    lines.push(SEP);
    return lines.join('\n');
  }

  for (const f of findings) {
    const icon = SEVERITY_ICON[f.severity] ?? '⬜';
    lines.push(`  ${icon}  [${f.severity}]  ${f.category}`);
    lines.push(`       ${f.file}`);
    lines.push(`       ${f.message}`);
    if (f.suggestion) lines.push(`       → ${f.suggestion}`);
    lines.push('');
  }

  lines.push(SEP);
  const byCat = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});

  const summary = Object.entries(byCat)
    .map(([sev, n]) => `${n} ${sev}`)
    .join('  ·  ');
  lines.push(`  ${findings.length} finding${findings.length === 1 ? '' : 's'}  ·  ${summary}`);

  return lines.join('\n');
}

export function formatInitFromAiConfigConsole(result: InitFromAiConfigResult): string {
  const SEP = '─'.repeat(60);
  const lines: string[] = [];

  lines.push('Thesmos — init from AI config');
  lines.push(SEP);
  lines.push('');

  if (result.filesRead.length === 0) {
    lines.push('  ⚠️   No AI behavior files found in this repository.');
    lines.push('       Create CLAUDE.md, .cursorrules, or GEMINI.md first,');
    lines.push('       then re-run "thesmos init --from-ai-config".');
    lines.push('');
    lines.push(SEP);
    return lines.join('\n');
  }

  lines.push('  AI behavior files detected:');
  for (const f of result.filesRead) {
    lines.push(`    ✓  ${f}`);
  }
  lines.push('');

  const { stack } = result;
  if (stack.frameworks.length > 0) {
    lines.push(`  Tech stack detected: ${stack.frameworks.join(', ')}`);
  }
  lines.push(
    `  AI-assisted project: ${stack.isAiHeavy ? 'Yes' : 'No'}  ·  ` +
    `Confidence: ${stack.confidence}`,
  );
  lines.push(`  Recommended preset: ${stack.recommendedPreset}`);
  lines.push('');

  if (result.configAlreadyExisted) {
    lines.push(`  ℹ️   .thesmos/config.json already exists — skipped.`);
  } else if (result.configWritten) {
    lines.push(`  ✅  Generated ${result.configPath}`);
    lines.push(`       extends: "${stack.recommendedPreset}"`);
  } else {
    lines.push(`  🔍  Dry run — would generate .thesmos/config.json`);
    lines.push(`       extends: "${stack.recommendedPreset}"`);
  }

  if (result.lintFindings.length > 0) {
    lines.push('');
    lines.push(`  ⚠️   ${result.lintFindings.length} governance gap${result.lintFindings.length === 1 ? '' : 's'} found in AI config files:`);
    for (const f of result.lintFindings.slice(0, 5)) {
      const icon = SEVERITY_ICON[f.severity] ?? '⬜';
      lines.push(`    ${icon}  ${f.file} — ${f.message}`);
    }
    if (result.lintFindings.length > 5) {
      lines.push(`    … and ${result.lintFindings.length - 5} more (run "thesmos ai-lint" for full report)`);
    }
  }

  lines.push('');
  lines.push(SEP);
  lines.push('  Next steps:');
  if (!result.configAlreadyExisted && result.configWritten) {
    lines.push('    1. Run "thesmos scan" to generate your baseline report');
    lines.push('    2. Run "thesmos adapters" to sync AI behavior files with governance rules');
    lines.push('    3. Add "thesmos:review" to your CI pipeline');
  } else if (result.configAlreadyExisted) {
    lines.push('    1. Run "thesmos adapters" to sync AI behavior files with governance rules');
    lines.push('    2. Run "thesmos ai-lint" to fix governance gaps in your AI config files');
  }

  return lines.join('\n');
}
