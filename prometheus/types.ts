/**
 * Prometheus shared types — imported by all lib/prometheus/ modules and scripts.
 * Do not add logic here. Types only.
 */

export type Severity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'TECH_DEBT';
export type AuditLevel = 'ERROR' | 'WARN' | 'INFO';

export interface SeverityRule {
  category: string;
  severity: Severity;
}

export interface PrometheusConfig {
  name: string;
  version: string;
  project: string;
  generatedAt?: string;

  // Folder scanning
  ignoredFolders: string[];
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
}

export interface Finding {
  severity: Severity;
  file: string;
  line?: number;
  category: string;
  message: string;
  suggestion?: string;
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
  config: PrometheusConfig;
  changedFiles?: ChangedFile[];
}

export interface RuleExplanation {
  why: string;
  commonViolations: string[];
  goodExample: string;
  badExample: string;
  relatedPlaybooks: string[];
  relatedAgents: string[];
  relatedSkills: string[];
}

export interface PrometheusRule {
  id: string;
  category: string;
  description: string;
  severity: Severity;
  tags: string[];
  example?: string;
  sinceVersion: string;
  explain?: RuleExplanation;
  detect(input: DetectInput): Finding[];
}
