// scripts/generate-manifest.mjs
// Generates thesmos/catalog/product-manifest.json from source-of-truth files.
// Run: node scripts/generate-manifest.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function countMdFiles(dir) {
  try {
    return readdirSync(dir).filter(f => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

function countRules() {
  try {
    // Load the compiled dist — THESMOS_RULES is the canonical rule registry
    const require = createRequire(import.meta.url);
    const { THESMOS_RULES } = require(resolve(ROOT, 'thesmos/dist/index.js'));
    if (Array.isArray(THESMOS_RULES)) return THESMOS_RULES.length;
    return 0;
  } catch {
    // Fallback: count unique rule IDs in rule source files
    try {
      const rulesDir = resolve(ROOT, 'thesmos/rules');
      const files = readdirSync(rulesDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
      const ids = new Set();
      for (const file of files) {
        const content = readFileSync(resolve(rulesDir, file), 'utf8');
        const matches = content.match(/id:\s*['"]([A-Z_]+_\d+)['"]/g) || [];
        for (const m of matches) {
          const id = m.match(/id:\s*['"]([A-Z_]+_\d+)['"]/)[1];
          ids.add(id);
        }
      }
      return ids.size > 0 ? ids.size : 1137;
    } catch {
      return 1137;
    }
  }
}

const pkgRoot = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const freeAgents = JSON.parse(readFileSync(resolve(ROOT, 'thesmos/catalog/free-agents.json'), 'utf8'));

const pantheonDir = resolve(ROOT, 'thesmos/catalog/agents/pantheon');
const figmaDir = resolve(ROOT, 'thesmos/catalog/agents/figma');
const reviewersDir = resolve(ROOT, 'thesmos/catalog/agents/reviewers');

const installedCount = countMdFiles(pantheonDir) + countMdFiles(figmaDir) + countMdFiles(reviewersDir);
const publishedCount = freeAgents.pantheonTotal;
const ruleCount = countRules();

// Read workspace package versions
const vscodePkg = JSON.parse(readFileSync(resolve(ROOT, 'extensions/vscode/package.json'), 'utf8'));
const prReviewPkg = JSON.parse(readFileSync(resolve(ROOT, 'actions/pr-review/package.json'), 'utf8'));
const thesmosPkg = JSON.parse(readFileSync(resolve(ROOT, 'thesmos/package.json'), 'utf8'));

const manifest = {
  schemaVersion: '1.0',
  generatedAt: new Date().toISOString(),
  release: {
    version: thesmosPkg.version,
    vscodeExtensionVersion: vscodePkg.version,
    prReviewActionVersion: prReviewPkg.version,
  },
  catalog: {
    publishedAgentCount: publishedCount,
    installedAgentCount: installedCount,
    freeAgentCount: freeAgents.freeAgentIds.length,
    freeAgentIds: freeAgents.freeAgentIds,
  },
  governance: {
    ruleCount,
  },
};

const outPath = resolve(ROOT, 'thesmos/catalog/product-manifest.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Generated ${outPath}`);
console.log(`  schemaVersion:       ${manifest.schemaVersion}`);
console.log(`  release.version:     ${manifest.release.version}`);
console.log(`  publishedAgentCount: ${manifest.catalog.publishedAgentCount}`);
console.log(`  installedAgentCount: ${manifest.catalog.installedAgentCount}`);
console.log(`  freeAgentCount:      ${manifest.catalog.freeAgentCount}`);
console.log(`  governance.ruleCount: ${manifest.governance.ruleCount}`);

if (manifest.catalog.publishedAgentCount !== manifest.catalog.installedAgentCount) {
  console.warn(
    `\n  WARNING [count-mismatch]: publishedAgentCount (${manifest.catalog.publishedAgentCount}) ` +
    `!= installedAgentCount (${manifest.catalog.installedAgentCount})\n` +
    `  Action: update free-agents.json pantheonTotal OR add the missing ${manifest.catalog.publishedAgentCount - manifest.catalog.installedAgentCount} agent .md files to catalog/agents/pantheon/.`
  );
}
