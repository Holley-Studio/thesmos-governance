/**
 * prometheus-governance — public API
 *
 * This barrel exports the stable, documented public surface.
 * Anything not exported here is an internal implementation detail.
 *
 * Layers:
 *   Types     — shared TypeScript types (re-export from types.ts)
 *   Config    — load and validate .prometheus/config.json
 *   Rules     — canonical rule registry and adapter generation
 *   Init      — scaffold .prometheus/ governance folder
 *   Scanner   — repo structure analysis
 *   Review    — per-file code-review findings
 *   Severity  — CI exit-code helpers
 *   Doctor    — installation health checks
 *   CI Check  — lightweight CI-gate checks (adapter freshness, required files)
 *   Output    — PROMETHEUS:GENERATED section markers
 *   Report    — report.json merge utilities
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type {
  Severity,
  AuditLevel,
  SeverityRule,
  PrometheusConfig,
  Finding,
  AuditFinding,
  DoctorCheck,
  PageRoute,
  ApiRoute,
  LargeFile,
  ClientBoundaryRisk,
  DetectorResult,
  ScanResult,
  ChangedFile,
  DetectInput,
  PrometheusRule,
} from './types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export { CONFIG_DEFAULTS, loadConfig, validateConfig } from './config.js';

// ── Rules & Adapters ──────────────────────────────────────────────────────────

export {
  PROMETHEUS_RULES,
  ADAPTER_OUTPUT_PATHS,
  getRulesByTag,
  getRulesBySeverity,
  getRulesByCategory,
  buildAdapterContent,
  writeAllAdapters,
  parseAdapterMeta,
  isAdapterFresh,
  generateClaudeRules,
  generateGeminiRules,
  generateCursorRules,
  generateCopilotRules,
  generateCodexRules,
  generateAgentsRules,
} from './adapters.js';

export type {
  Rule,
  AdapterTarget,
  AdapterMeta,
  AdapterManifest,
  AdapterCatalog,
  AdapterCatalogEntry,
} from './adapters.js';

// ── Init ──────────────────────────────────────────────────────────────────────

export { buildInitFiles, writePrometheusDir, INIT_FILE_PATHS } from './init.js';
export type { InitFileResult, InitOptions } from './init.js';

// ── Scanner ───────────────────────────────────────────────────────────────────

export { runScanner } from './scanner/index.js';

// ── Review ────────────────────────────────────────────────────────────────────

export {
  runReview,
  REVIEW_CATEGORIES,
  formatFindingsConsole,
  formatFindingsMarkdown,
  formatFindingsJson,
} from './review.js';
export type { ReviewInput } from './review.js';

// ── Severity ──────────────────────────────────────────────────────────────────

export {
  exitCodeFor,
  shouldWarn,
  shouldFail,
  SEVERITY_ORDER,
  SEVERITY_EMOJI,
} from './severity.js';

// ── Doctor ────────────────────────────────────────────────────────────────────

export {
  runDoctor,
  runDoctorForRoot,
  formatDoctorConsole,
  formatDoctorMarkdown,
  formatDoctorJson,
  DOCTOR_GROUPS,
} from './doctor.js';

export type { DoctorInput, DoctorGroup } from './doctor.js';

// ── CI Check ──────────────────────────────────────────────────────────────────

export {
  runCiCheck,
  runCiCheckForRoot,
  formatCiCheckConsole,
  formatCiCheckMarkdown,
  formatCiCheckJson,
  CI_CHECK_GROUPS,
} from './ci-check.js';

export type { CiCheckInput } from './ci-check.js';

// ── Output (section markers) ──────────────────────────────────────────────────

export { injectGeneratedSection, extractGeneratedSection } from './output.js';

// ── Report ────────────────────────────────────────────────────────────────────

export { applyGeneratedSections, sortReport, isReportStale } from './report.js';

// ── Drift Detection ───────────────────────────────────────────────────────────

export {
  runDrift,
  runDriftForRoot,
  formatDriftConsole,
  formatDriftMarkdown,
  formatDriftJson,
} from './drift.js';

export type { DriftFinding, DriftInput } from './drift.js';
export type { JsonValue } from './report.js';

// ── Registry ──────────────────────────────────────────────────────────────────

export {
  REGISTRY_DEFAULTS,
  REGISTRY_PATH,
  validateRegistryConfig,
  mergeRegistryConfig,
  loadRegistryConfig,
  resolveRegistry,
  loadAndResolveRegistry,
} from './registry.js';

export type {
  PrometheusRegistryConfig,
  AgentEntry,
  SkillEntry,
  ResolvedRegistry,
  RegistryValidationResult,
} from './registry.js';

// ── Packs ─────────────────────────────────────────────────────────────────────

export {
  discoverPacks,
  parsePackManifest,
  validatePack,
  validateAllPacks,
  formatPackListConsole,
  formatPackListJson,
  formatPackValidateConsole,
  formatPackValidateJson,
  LOCAL_PACKS_DIR,
  NPM_PACKS_SCOPE,
} from './packs.js';

export type {
  PackManifest,
  PackEntry,
  PackProvides,
  PackValidationResult,
} from './packs.js';

// ── Metrics ───────────────────────────────────────────────────────────────────

export {
  computeMetrics,
  collectMetricsForRoot,
  toMetricsSnapshot,
  appendMetricsSnapshot,
  loadMetricsHistory,
  formatMetricsConsole,
  formatMetricsMarkdown,
  formatMetricsJson,
  METRICS_HISTORY_PATH,
} from './metrics.js';

export type {
  PrometheusMetrics,
  MetricsInput,
  MetricsBySeverity,
  MetricsByRule,
  RiskyFile,
  AgentUsage,
  SkillUsage,
  MetricsSnapshot,
} from './metrics.js';

// ── Suppressions ──────────────────────────────────────────────────────────────

export {
  parseSuppression,
  extractSuppressions,
  resolveCategory,
  applySuppressions,
  auditSuppressions,
  formatSuppressionAuditConsole,
  formatSuppressionAuditMarkdown,
  formatSuppressionAuditJson,
  formatReviewWithSuppressions,
} from './suppress.js';

export type {
  Suppression,
  SuppressionResult,
  SuppressionAuditFinding,
  SuppressionAuditInput,
} from './suppress.js';

// ── Explain ───────────────────────────────────────────────────────────────────

export {
  findRule,
  findRulesForFile,
  findRuleForFingerprint,
  listRules,
  formatExplainConsole,
  formatExplainMarkdown,
  formatExplainJson,
  formatExplainListConsole,
  formatRuleListLine,
} from './explain.js';

export type { RuleExplanation } from './types.js';

// ── Baseline ──────────────────────────────────────────────────────────────────

export {
  BASELINE_PATH,
  BASELINE_VERSION,
  fingerprintFinding,
  createBaselineEntries,
  createBaseline,
  partitionFindings,
  updateBaseline,
  serializeBaseline,
  parseBaseline,
  loadBaseline,
  saveBaseline,
  formatBaselineConsole,
  formatBaselineMarkdown,
  formatBaselineJson,
} from './baseline.js';

export type {
  BaselineEntry,
  Baseline,
  BaselinePartition,
  BaselineUpdateResult,
} from './baseline.js';

// ── Health ────────────────────────────────────────────────────────────────────

export {
  computeHealthScore,
  computeHealthForRoot,
  formatHealthConsole,
  formatHealthMarkdown,
  formatHealthJson,
} from './health.js';

export type {
  HealthGrade,
  HealthScore,
  HealthInput,
  HealthDeduction,
  HealthBonus,
} from './health.js';

// ── Catalog ───────────────────────────────────────────────────────────────────

export {
  parseFrontmatter,
  validateFrontmatter,
  validateCatalog,
  loadCatalogDir,
  loadBuiltInCatalog,
  loadBuiltInProfiles,
  loadCatalogProfile,
  loadUserCatalog,
  getActiveCatalog,
  buildAgentStub,
  buildSkillStub,
} from './catalog.js';

export type {
  CatalogFrontmatter,
  CatalogEntry,
  CatalogProfile,
  CatalogValidationResult,
} from './catalog.js';
