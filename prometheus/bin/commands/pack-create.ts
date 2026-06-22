/**
 * prometheus pack:create <@scope/name> — scaffold a new rule pack
 *
 * Usage:
 *   prometheus pack:create @myorg/python
 *   prometheus pack:create @myorg/django --author="My Org"
 *
 * Creates:
 *   .prometheus/packs/<name>/
 *     pack.json           manifest
 *     rules/
 *       index.ts          example rule (compile to index.js before publishing)
 *     agents/             optional agent .md files
 *     skills/             optional skill .md files
 *     playbooks/          optional playbook .md files
 *     profiles/           optional profile .json files
 *     README.md           authoring and publishing guide
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';

const SCOPED_ID_RE = /^@[a-z0-9-]+\/[a-z0-9-]+$/;

function ruleStub(packId: string): string {
  // Derive a rule ID prefix from the pack name, e.g. @myorg/python → PY
  const suffix = packId.split('/')[1] ?? 'PKG';
  const prefix = suffix.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();

  return `/**
 * ${packId} — example rule
 *
 * To load pack rules at runtime:
 *   1. Compile this file:  tsc rules/index.ts --outDir rules/dist --module esnext --target es2022
 *      (or use esbuild / tsup / ncc)
 *   2. Point pack.json provides.rules to true
 *   3. The runtime will load rules/index.js (or dist/index.js — update path in pack.json)
 *
 * Export your rules as:
 *   export const PACK_RULES: PrometheusRule[] = [...];
 *   // OR: export default PACK_RULES;
 */

import type { PrometheusRule, Finding } from 'prometheus-governance';

export const PACK_RULES: PrometheusRule[] = [
  {
    id: '${prefix}_001',
    category: '${suffix}_example_violation',
    severity: 'HIGH',
    description: 'Example rule — replace with your rule logic.',
    tags: ['${suffix.toLowerCase()}', 'example'],
    sinceVersion: '1.0.0',
    explain: {
      why: 'Describe why this pattern is risky or important to govern.',
      commonViolations: [
        'Using the pattern without checking X.',
        'Omitting required Y in production code.',
      ],
      goodExample: '// Good: safe pattern\\nconst result = safeFunction(input);',
      badExample: '// Bad: unsafe pattern\\nconst result = unsafeFunction(rawInput);',
    },
    detect({ changedFiles }): Finding[] {
      const findings: Finding[] = [];
      for (const f of changedFiles) {
        // Replace with your detection logic
        if (!f.path.endsWith('.example')) continue;
        findings.push({
          severity: 'HIGH',
          category: '${suffix}_example_violation',
          file: f.path,
          line: 1,
          message: 'Example rule fired — edit detect() in rules/index.ts.',
          suggestion: 'Replace this example rule with your real detection logic.',
        });
      }
      return findings;
    },
  },
];
`;
}

function packJson(id: string, author: string): string {
  const name = id.split('/')[1] ?? id;
  return JSON.stringify(
    {
      schemaVersion: '1',
      id,
      name: name.charAt(0).toUpperCase() + name.slice(1) + ' Pack',
      version: '1.0.0',
      description: `Prometheus governance rules for ${name}.`,
      author,
      tags: [name],
      provides: {
        rules: true,
        agents: false,
        skills: false,
        playbooks: false,
        profiles: false,
      },
    },
    null,
    2,
  ) + '\n';
}

function readme(id: string): string {
  const name = id.split('/')[1] ?? id;
  return `# ${id}

Prometheus rule pack for ${name}.

## What's included

- \`rules/index.ts\` — custom \`PrometheusRule\` definitions

## Compiling rules

Pack rules must be compiled to JS before they can be loaded at runtime:

\`\`\`bash
# Using tsup (recommended)
npx tsup rules/index.ts --format esm --outDir rules

# Using tsc directly
npx tsc rules/index.ts --outDir rules --module esnext --target es2022 --moduleResolution bundler
\`\`\`

After compiling, \`rules/index.js\` must exist in the pack directory.

## Using locally

Install the pack by placing this directory in your project's \`.prometheus/packs/${name}/\`.

Then run:

\`\`\`bash
prometheus pack:list        # verify the pack is discovered
prometheus pack:validate    # check the manifest
prometheus review           # rules are merged with built-ins automatically
\`\`\`

## Publishing to npm

\`\`\`bash
# 1. Compile rules first
npx tsup rules/index.ts --format esm --outDir rules

# 2. Make sure pack.json and compiled rules/ are included in your package
#    Add to package.json: "files": ["pack.json", "rules/", "agents/", "skills/"]

# 3. Publish
npm publish --access public
\`\`\`

After publishing, users install with:

\`\`\`bash
npm install ${id}
\`\`\`

Prometheus auto-discovers packs under \`node_modules/@prometheus/\`.

## Authoring rules

See the [Prometheus rule authoring guide](https://github.com/Holley-Studio/prometheus-governance/blob/main/CONTRIBUTING.md#writing-rules)
for the full \`PrometheusRule\` API, severity levels, and best practices.
`;
}

export async function cmdPackCreate(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { positionals, flags } = parseArgs(argv);
  const dry = flag(flags, 'dry-run');
  const author = flagVal(flags, 'author') ?? '';

  const id = positionals[0];
  if (!id) {
    process.stderr.write(
      'pack:create: missing <@scope/name>\n' +
        'Usage: prometheus pack:create @myorg/python\n',
    );
    process.exit(1);
  }

  if (!SCOPED_ID_RE.test(id)) {
    process.stderr.write(
      `pack:create: invalid id "${id}"\n` +
        '  Pack IDs must be scoped: @scope/name (lowercase letters, hyphens allowed)\n' +
        '  Example: @myorg/python\n',
    );
    process.exit(1);
  }

  const packName = id.split('/')[1]!;
  const packDir = join(root, '.prometheus', 'packs', packName);

  if (existsSync(packDir)) {
    process.stderr.write(
      `pack:create: directory already exists: .prometheus/packs/${packName}/\n`,
    );
    process.exit(1);
  }

  const files: Array<[string, string]> = [
    [join(packDir, 'pack.json'), packJson(id, author || 'unknown')],
    [join(packDir, 'rules', 'index.ts'), ruleStub(id)],
    [join(packDir, 'agents', '.gitkeep'), ''],
    [join(packDir, 'skills', '.gitkeep'), ''],
    [join(packDir, 'playbooks', '.gitkeep'), ''],
    [join(packDir, 'profiles', '.gitkeep'), ''],
    [join(packDir, 'README.md'), readme(id)],
  ];

  if (dry) {
    console.log(`pack:create [dry-run] — would create .prometheus/packs/${packName}/`);
    for (const [path] of files) {
      console.log(`  ${path.replace(root + '/', '')}`);
    }
    return;
  }

  for (const [path, content] of files) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }

  console.log(`\npack:create — created .prometheus/packs/${packName}/`);
  console.log('');
  console.log('Files written:');
  console.log(`  .prometheus/packs/${packName}/pack.json`);
  console.log(`  .prometheus/packs/${packName}/rules/index.ts`);
  console.log(`  .prometheus/packs/${packName}/README.md`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Edit rules/index.ts — add your PrometheusRule definitions`);
  console.log(`  2. Compile:   npx tsup rules/index.ts --format esm --outDir rules`);
  console.log(`  3. Verify:    prometheus pack:list`);
  console.log(`  4. Test:      prometheus pack:validate`);
  console.log(`  5. Review:    prometheus review   (your rules are merged automatically)`);
  console.log('');
  console.log(`  To publish: npm publish (see .prometheus/packs/${packName}/README.md)`);
}
