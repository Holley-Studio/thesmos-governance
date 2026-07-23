// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos shared types — imported by all thesmos/ modules and scripts.
 * Do not add logic here. Types only.
 */

export type Severity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'TECH_DEBT';
export type AuditLevel = 'ERROR' | 'WARN' | 'INFO';

export interface SeverityRule {
  category: string;
  severity: Severity;
}

export interface DesignConfig {
  /** CSS framework in use. Currently informational — design rules detect Tailwind patterns automatically. Default: 'auto'. */
  cssFramework?: 'tailwind' | 'vanilla' | 'styled-components' | 'css-modules' | 'emotion' | 'auto';
  /** Extra icon library package names to track for DESIGN_016 (mixed icon libraries). Merged with the built-in set. */
  iconLibraries?: string[];
  /** Allowed border-radius pixel values for DESIGN_010. Default: Tailwind rounded scale [0,2,4,6,8,12,16,24,9999]. */
  borderRadiusScale?: number[];
  /** Allowed animation/transition duration values in ms for DESIGN_014. Default: Tailwind duration scale [75,100,150,200,300,500,700,1000]. */
  animationScale?: number[];
  /** Allowed opacity values (0–1) for DESIGN_018. Default: Tailwind 5% increment scale. */
  opacityScale?: number[];
}

export interface AutopilotConfig {
  enabled: boolean;
  adapter?: 'claude' | 'openai' | 'gemini' | 'http';
  maxCostUSD?: number;
  taskTimeoutMinutes?: number;
  maxRetriesPerTask?: number;
  requirePluggedIn?: boolean;
  stopOnCreditFailure?: boolean;
  retryBackoffSeconds?: [number, number, number];
  httpAdapterUrl?: string;
  /**
   * Opt-in only. When true, Claude adapter appends `--dangerously-skip-permissions`.
   * Default: false. Prefer the autopilot permission profile + claude:govern hooks.
   */
  dangerouslySkipPermissions?: boolean;
}

/** Local-first cost/token observability (AGNT_020). */
export interface MetricsConfig {
  enabled: boolean;
  /** Destination for session/task cost snapshots. Default: local-jsonl. */
  exportTo?: 'local-jsonl';
  /** Optional alert threshold in USD (advisory — recorded in export events). */
  costAlertThresholdUSD?: number;
}

export type DoneCriterionType = 'file_exists' | 'command_passes' | 'grep_matches' | 'grep_not_matches';

export interface DoneCriterion {
  type: DoneCriterionType;
  value: string;
  raw: string;
}

export interface AutopilotTask {
  index: number;
  title: string;
  context?: string;
  scope?: string[];
  allowedPackages?: string[];
  dependsOn?: number[];
  doneCriteria: DoneCriterion[];
  isCheckpoint: boolean;
}

export interface AutopilotPlan {
  project: string;
  adapter: 'claude' | 'openai' | 'gemini' | 'http';
  gates: string[];
  commitOnPass: boolean;
  maxRetries: number;
  branchPrefix?: string;
  tasks: AutopilotTask[];
  rawContent: string;
}

export type ParseIssueType = 'error' | 'warning';

export interface ParseIssue {
  type: ParseIssueType;
  message: string;
  field?: string;
}

export interface PlanParseResult {
  plan: AutopilotPlan | null;
  issues: ParseIssue[];
}

export interface TaskDecision {
  taskIndex: number;
  taskTitle: string;
  decision: string;
}

export interface AutopilotSession {
  id: string;
  planPath: string;
  planSlug: string;
  branch: string;
  restoreTag: string;
  startedAt: string;
  adapter: string;
  completedTaskIndexes: number[];
  blockedTasks: Array<{ index: number; reason: string }>;
  timedOutTaskIndexes: number[];
  decisionLog: string[];
  journalPath: string;
  permissionsBackupPath: string | null;
  lastTaskStash: string | null;
}

export interface ThesmosConfig {
  name: string;
  version: string;
  project: string;
  generatedAt?: string;

  /**
   * Active licensing tier. 'free' runs the Essentials rule set (all BLOCKERs +
   * the AI-code net); 'premium' runs the full engine. Resolved and stamped by
   * loadConfig — do not read the raw config value directly; the engines read
   * this resolved field. See tiers.ts.
   */
  tier?: 'free' | 'premium';

  /**
   * Pantheon orchestration power tier. 'lean' (default): one specialist, a
   * one-line Zeus header, no auto-council, no mandatory ceremony — most tasks
   * (80-90%) belong here. 'god': full council/ceremony available — adversarial
   * self-check, the full multi-line routing banners, deep-research escalation.
   * This governs agent-routing PROMPT BEHAVIOR (read by CLAUDE.md doctrine), not
   * rule enforcement — there is no runtime code gate, unlike `tier`.
   */
  power?: 'lean' | 'god';

  // Folder scanning
  ignoredFolders: string[];
  /**
   * Repo-relative path PREFIXES excluded from review/validate diffs
   * (e.g. "thesmos/rules/"). Unlike ignoredFolders (which matches any path
   * segment by name), a prefix targets one specific subtree. Intended for
   * sources that intentionally contain detection patterns — rule definitions,
   * governance templates — which would otherwise self-trigger the rules they
   * describe. Default: [] (nothing excluded).
   */
  reviewIgnorePaths: string[];
  /**
   * Minimum rule-confidence tier whose findings can FAIL a gate
   * (validate/ci/PR action). Findings below the tier still appear in output,
   * tagged, but never flip the exit code. 'medium' (default) gates high and
   * medium; 'high' gates only near-certain detections; 'low' gates everything.
   */
  gate: { minConfidence: Confidence };
  largeFileThreshold: number;
  criticalLibPaths: string[];
  requiredFiles: string[];

  // Secret detection
  secretPatterns: string[];

  // CI failure control
  failOnSeverity: Severity[];
  warnOnSeverity: Severity[];
  severityRules: SeverityRule[];

  // Rule filtering
  /** Rule IDs or category names to skip entirely (e.g. ["GATE_001", "monday_write_no_gate"]). */
  disabledRules?: string[];

  // Audit
  reportMaxAgeDays: number;
  protectedBranches: string[];

  // Doctor
  doctor: {
    reportMaxAgeDays: number;
    requiredScripts: string[];
    requiredFiles: string[];
    requiredIdeDirs: string[];
  };

  // Design governance
  design?: DesignConfig;

  // Autopilot autonomous build mode
  autopilot?: AutopilotConfig;

  /**
   * Cost/token metric export (AGNT_020).
   * Prefer `exportTo: "local-jsonl"` — writes `.thesmos/metrics-export.jsonl`.
   */
  metrics?: MetricsConfig;

  // Pantheon agent routing doctrine (AGNT_032/033)
  routing?: {
    /** auto: Zeus routes silently per tier rules · confirm: announce and await
     *  user go-ahead before ANY spawn · off: agents only on explicit invocation. */
    mode?: 'auto' | 'confirm' | 'off';
    /** Councils of this many agents or more require explicit user confirmation. */
    councilConfirmThreshold?: number;
  };

  // Context window governance (AGNT_037)
  context1M?: {
    /** Allow the 1M-token context window ([1m] model variants). Default false —
     *  long-context requests bill at premium rates; enabling must be deliberate. */
    allow1M?: boolean;
  };

  // Token budget governance (see token-budget.ts for full TokenBudgetConfig type)
  tokenBudget?: {
    enabled?: boolean;
    sessionMaxTokens?: number;
    sessionMaxCostUSD?: number;
    dailyMaxCostUSD?: number;
    projectMaxCostUSD?: number;
    alertAt?: number;
    hardStopAt?: number;
    modelCostTable?: Record<string, { inputPer1M: number; outputPer1M: number }>;
  };

  // Legacy nested compat
  review?: { defaultBase?: string };
  validate?: { gates?: string[]; outputPath?: string };
  github?: { workflow?: string; requiresSecrets?: string[] };
  ideTools?: Record<string, string>;
  scripts?: Record<string, string>;
  scan?: {
    generatedSections?: string[];
    riskyFilePatterns?: string[];
  };

  commitLint?: {
    enabled?: boolean;
    types?: string[];
    requireScope?: boolean;
    maxSubjectLength?: number;
    requireTicket?: boolean;
    ticketPattern?: string;
    allowedScopes?: string[];
  };

  vercel?: {
    enabled?: boolean;
    requiredEnvVars?: string[];
    plan?: 'hobby' | 'pro' | 'enterprise';
    requireCronAuth?: boolean;
  };

  autoMode?: {
    /** Whether Thesmos actively governs Claude Code Auto Mode sessions (default: true when hooks installed). */
    enabled?: boolean;
    /** Reserved — only affects the blockOn fallback in governance status reporting. */
    strictMode?: boolean;
    /** Minimum severity level to block on during Auto Mode sessions (default: "BLOCKER"). */
    blockOn?: 'BLOCKER' | 'HIGH' | 'MEDIUM';
    /** Show a VS Code notification when a write is blocked during Auto Mode (default: true). */
    notifyOnBlock?: boolean;
    /**
     * When true (default), guard infrastructure failures (malformed hook input,
     * unreadable config, internal exceptions) block the tool call. Set false
     * only as an explicit opt-out — never platform-auto-enabled.
     */
    failClosed?: boolean;
  };
}

/**
 * Detection confidence tier. `high` = the pattern is near-certain proof
 * (e.g. a committed secret); `medium` = a shape heuristic that can misfire
 * on innocent code (e.g. exec + template literal with static interpolants);
 * `low` = keyword/presence signals that suggest rather than demonstrate.
 * Rules without an explicit tier are treated as `high` (preserves behavior).
 */
export type Confidence = 'high' | 'medium' | 'low';

export interface Finding {
  severity: Severity;
  file: string;
  line?: number;
  category: string;
  message: string;
  suggestion?: string;
  /** Carried from the emitting rule at review time; absent = high. */
  confidence?: Confidence;
}

export interface AuditFinding {
  level: AuditLevel;
  category: string;
  message: string;
  file?: string;
}

export interface DoctorCheck {
  name: string;
  group?: string;
  pass: boolean;
  message: string;
  fixHint?: string;
}

export interface PageRoute {
  path: string;
  file: string;
  desc: string;
}

export interface ApiRoute {
  path: string;
  file?: string;
  methods: string[];
  auth: boolean;
  desc: string;
  role?: string;
}

export interface LargeFile {
  file: string;
  lines: number;
}

/** A 'use client' file that also contains a pattern that must not cross the boundary. */
export interface ClientBoundaryRisk {
  file: string;
  risk: 'admin-client' | 'server-only-import' | 'direct-env-access';
}

export interface DetectorResult {
  // Stack identity
  framework: 'next' | 'vite' | 'remix' | 'nuxt' | 'astro' | 'sveltekit' | 'express' | 'unknown';
  auth: 'supabase' | 'next-auth' | 'clerk' | 'auth0' | 'lucia' | 'better-auth' | 'none' | 'unknown';
  testingFramework: 'vitest' | 'jest' | 'playwright' | 'none';
  deployment: 'vercel' | 'netlify' | 'railway' | 'fly' | 'other' | 'unknown';
  apiConvention: 'next-app-router' | 'next-pages-router' | 'unknown';
  // Toolchain
  typescript: boolean;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';
  cssFramework: 'tailwind' | 'sass' | 'css-modules' | 'styled-components' | 'emotion' | 'none' | 'unknown';
  uiLibrary: 'shadcn' | 'chakra' | 'mantine' | 'radix' | 'headless-ui' | 'antd' | 'mui' | 'none' | 'unknown';
  // Env vars found across sampled source files
  envVars: string[];
}

export interface LanguageStats {
  language: string;   // "TypeScript", "Python", "Go", "Ruby", "Rust", "JavaScript", "Other"
  extension: string;  // ".ts", ".py", ".go", ".rb", ".rs", ".js"
  fileCount: number;
  lineCount: number;  // total lines across all files of this type
}

export interface ScanResult {
  _generatedSections: string[];
  generatedAt: string;
  scanVersion: string;
  // Routes
  pages: PageRoute[];
  apiRoutes: ApiRoute[];
  // Files
  componentCount: number;
  sharedUiFiles: string[];
  designSystemFiles: string[];
  storeFiles: string[];
  testFiles: string[];
  largeFiles: LargeFile[];
  riskyFiles: string[];
  scriptFiles: string[];
  envFiles: string[];
  clientBoundaryRisks: ClientBoundaryRisk[];
  // Language inventory
  languages?: LanguageStats[];
  detectedStacks?: string[];
  // Metadata
  detector?: DetectorResult;
}

export interface ChangedFile {
  path: string;
  content: string;
  /** Raw diff/patch text — when provided, secret-scan runs against the diff. */
  diff?: string;
}

export interface DetectInput {
  scan: ScanResult;
  config: ThesmosConfig;
  changedFiles?: ChangedFile[];
  /** Workspace root — used by rules that need filesystem checks. Defaults to process.cwd() when not provided. */
  root?: string;
}

export interface RuleExplanation {
  why: string;
  commonViolations: string[];
  goodExample: string;
  badExample: string;
  relatedPlaybooks?: string[];
  relatedAgents?: string[];
  relatedSkills?: string[];
}

export interface ThesmosRule {
  id: string;
  category: string;
  description: string;
  severity: Severity;
  tags: string[];
  frameworks?: string[];
  example?: string;
  sinceVersion: string;
  explain?: RuleExplanation;
  /** Detection confidence tier — absent means 'high'. See Confidence. */
  confidence?: Confidence;
  detect(input: DetectInput): Finding[];
}

export interface ContextHealth {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  issues: string[];
  contextAgeHours: number | null;
  adaptersFresh: boolean;
}

export interface ContextCapsule {
  project: string;
  snapshotAt: string;
  stack: string[];
  patterns: string[];
  constraints: string[];
  governance: {
    ruleCount: number;
    lastCleanScan: string | null;
    preset: string | null;
  };
  health: ContextHealth;
}
