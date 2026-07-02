// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos ci:github-security — generate a GitHub Actions workflow step
 * that uploads thesmos.sarif to the GitHub Security tab.
 *
 * Usage:
 *   thesmos ci:github-security             print YAML to stdout
 *   thesmos ci:github-security --write     write to .github/workflows/thesmos-security.yml
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { flag } from '../lib/args.ts';
import { createContext } from '../lib/context.ts';

const WORKFLOW = `name: Thesmos Security Scan

on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]

permissions:
  contents: read
  security-events: write   # required for upload-sarif

jobs:
  thesmos:
    name: Governance Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run Thesmos scan
        run: npx thesmos scan

      - name: Export SARIF
        run: npx thesmos validate --sarif > thesmos.sarif

      - name: Upload to GitHub Security tab
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: thesmos.sarif
          category: thesmos-governance
`;

export async function cmdCiGithubSecurity(argv: string[]): Promise<void> {
  const flags = Object.fromEntries(
    argv.filter((a) => a.startsWith('--')).map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k!, v ?? true];
    }),
  );

  const write = flag(flags, 'write');

  if (write) {
    const { root } = createContext();
    const dir = join(root, '.github', 'workflows');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const dest = join(dir, 'thesmos-security.yml');
    writeFileSync(dest, WORKFLOW);
    process.stdout.write(`Wrote ${dest}\n`);
    process.stdout.write(`Commit and push — findings will appear in GitHub Security > Code scanning alerts.\n`);
  } else {
    process.stdout.write(WORKFLOW);
  }
}
