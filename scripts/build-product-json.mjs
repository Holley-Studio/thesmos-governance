#!/usr/bin/env node
/**
 * Builds content/products/thesmos.json for the Holley Studio storefront sync
 * (contract: Holley-Studio/HolleyStudios docs/product-sync.md).
 *
 * Every fact below is derived from a real source in this repo at build time —
 * never a hand-typed constant. That's the contract's whole point: hand-typed
 * counts are exactly how "1,075 rules" went stale in three places before this
 * script existed (see docs/roadmap.md's headcount/rule-count entries).
 *
 * Usage:
 *   node scripts/build-product-json.mjs            # print JSON to stdout
 *   node scripts/build-product-json.mjs --check     # build + validate, no output
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const THESMOS_DIR = join(ROOT, "thesmos");

// ---- version: package.json is the only source of truth ----
const pkg = JSON.parse(readFileSync(join(THESMOS_DIR, "package.json"), "utf8"));
const version = pkg.version;

// ---- rule count: import the built registry (dist/index.js), don't count
// files or re-parse TypeScript — this is the exact array the CLI ships with,
// and plain `node` can load it with no extra loader. Requires `npm run
// build:lib` to have run first (it always has, earlier in the release job).
const { THESMOS_RULES } = await import(join(THESMOS_DIR, "dist", "index.js"));
const ruleCount = THESMOS_RULES.length;

// ---- ecosystem count: explicit family map over the registry's own rule-module
// imports (thesmos/rules/registry.ts). Cross-cutting modules (ai, gdpr, mcp,
// rag, supply-chain, dast, self, eu-ai-act, hipaa, dora, local-llm, license,
// agents, performance, database, quality) apply across ecosystems and are not
// counted as one themselves. Adding a rule module without an entry here throws
// — that's deliberate, so this count can't silently drift the way "12" did.
const RULE_ID_PREFIX_TO_FAMILY = {
  // JS/TS/Node web ecosystem — one family, many rule modules
  SEC: "js-ts", AUTH: "js-ts", TS: "js-ts", REACT: "js-ts", NEXT: "js-ts",
  NODE: "js-ts", ERR: "js-ts", IMPORT: "js-ts", STATE: "js-ts", FORM: "js-ts",
  LOG: "js-ts", CSS: "js-ts", VIBE: "js-ts", SLOP: "js-ts", DESIGN: "js-ts",
  DEBT: "js-ts", COMMIT: "js-ts", VERCEL: "js-ts", ZOD: "js-ts", TRPC: "js-ts",
  PRISMA: "js-ts", DEPS: "js-ts", WS: "js-ts", PROTO: "js-ts", JWT: "js-ts",
  ASYNC: "js-ts", A11Y: "js-ts", GATE: "js-ts", COMP: "js-ts", DS: "js-ts",
  ENV: "js-ts",
  // distinct language ecosystems
  PY: "python", DJG: "python",
  GO: "go",
  RB: "ruby",
  PHP: "php",
  JAVA: "java",
  RUST: "rust",
  CS: "csharp",
  // platform/infra ecosystems
  DOCKER: "docker",
  GHA: "github-actions",
  TF: "terraform",
  GQL: "graphql",
  K8S: "kubernetes",
  GIT: "git",
  // cross-cutting — not an ecosystem of their own
  AI: null, PERF: null, DB: null, API: null, GDPR: null, MCP: null, RAG: null,
  SC: null, DAST: null, SELF: null, EU_AI: null, HIPAA: null, DORA: null,
  LOCAL_LLM: null, LIC: null, AGNT: null, DEP: null, TEST: null, QUAL: null,
};

const families = new Set();
for (const rule of THESMOS_RULES) {
  const prefix = rule.id.replace(/_\d+$/, "");
  if (!(prefix in RULE_ID_PREFIX_TO_FAMILY)) {
    throw new Error(
      `build-product-json: rule id prefix "${prefix}" (from ${rule.id}) has no ` +
      `entry in RULE_ID_PREFIX_TO_FAMILY — add it (or null if cross-cutting) ` +
      `before regenerating the product JSON.`
    );
  }
  const family = RULE_ID_PREFIX_TO_FAMILY[prefix];
  if (family) families.add(family);
}
const ecosystemCount = families.size;

// ---- test count: run the actual suite, don't hardcode last-known-good ----
const vitestOutfile = join(THESMOS_DIR, ".product-json-vitest-report.json");
// vitest lives in the workspace root's node_modules (npm workspaces hoist it),
// not thesmos/node_modules — resolve from ROOT, run from THESMOS_DIR so
// vitest.config picks up the right test glob.
execFileSync(
  join(ROOT, "node_modules", ".bin", "vitest"),
  ["run", "--reporter=json", `--outputFile=${vitestOutfile}`],
  { cwd: THESMOS_DIR, stdio: ["ignore", "ignore", "inherit"] }
);
const vitestReport = JSON.parse(readFileSync(vitestOutfile, "utf8"));
unlinkSync(vitestOutfile);
const testCount = vitestReport.numPassedTests;
if (!testCount || vitestReport.numFailedTests > 0) {
  throw new Error(
    `build-product-json: test suite did not pass cleanly ` +
    `(${vitestReport.numPassedTests} passed, ${vitestReport.numFailedTests} failed) — ` +
    `refusing to publish a product fact sheet from a red build.`
  );
}

const fmt = (n) => n.toLocaleString("en-US");

const product = {
  $schema: "./product.schema.json",
  slug: "thesmos",
  name: "Thesmos",
  tagline: "Governance engine",
  version,
  status: "live",
  license: pkg.license,
  install: "npm install --save-dev thesmos-governance",
  requires: "Node.js 18+",
  pricing: {
    model: "free",
    notes: "Free for open source and internal use. FSL-1.1-MIT (→ MIT 2030).",
  },
  links: {
    github: "https://github.com/Holley-Studio/thesmos-governance",
    purchase: "https://holleystudio.gumroad.com/l/thesmos-pantheon",
  },
  stats: [
    { value: fmt(ruleCount), label: "Rules" },
    { value: fmt(ecosystemCount), label: "Ecosystems" },
    { value: fmt(testCount), label: "Tests" },
  ],
  updatedAt: new Date().toISOString().slice(0, 10),
  sourceRepo: "Holley-Studio/thesmos-governance",
};

const json = JSON.stringify(product, null, 2) + "\n";

if (process.argv.includes("--check")) {
  console.error(`Built thesmos.json: v${version}, ${ruleCount} rules, ${ecosystemCount} ecosystems, ${testCount} tests.`);
} else {
  process.stdout.write(json);
}
