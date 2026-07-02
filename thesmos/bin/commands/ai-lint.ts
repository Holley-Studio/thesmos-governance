// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos ai-lint — lint AI behavior files for governance gaps.
 *
 * Reads CLAUDE.md, .cursorrules, GEMINI.md, AGENTS.md, and other AI
 * behavior files and reports governance issues: missing security guidance,
 * anti-patterns (skip tests, permit force push), and divergence from
 * the active Thesmos config.
 *
 * Flags:
 *   --json      output findings as JSON
 *   --markdown  output as Markdown
 *   --fix       print suggested fixes inline (default: true)
 */

import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import {
  discoverAiConfigFiles,
  lintAiConfigFiles,
  formatAiLintConsole,
  initFromAiConfig,
  formatInitFromAiConfigConsole,
  type AiLintFinding,
} from '../../ai-lint.ts';

export async function cmdAiLint(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);

  const json      = flag(flags, 'json');
  const markdown  = flag(flags, 'markdown');
  const fromAi   = flag(flags, 'from-ai-config');
  const dryRun   = flag(flags, 'dry-run');

  // --from-ai-config: detect stack and generate config
  if (fromAi) {
    const result = initFromAiConfig(root, dryRun);

    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            filesRead: result.filesRead,
            stack: result.stack,
            configPath: result.configPath,
            configWritten: result.configWritten,
            configAlreadyExisted: result.configAlreadyExisted,
            lintFindings: result.lintFindings,
          },
          null,
          2,
        ) + '\n',
      );
    } else {
      process.stdout.write(formatInitFromAiConfigConsole(result) + '\n');
    }
    return;
  }

  // Default: lint AI config files
  const files = discoverAiConfigFiles(root);
  const findings = lintAiConfigFiles(root, files);

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          total: findings.length,
          filesScanned: files.map((f) => f.relPath),
          findings,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  if (markdown) {
    process.stdout.write(formatMarkdown(findings, files.length, config.project) + '\n');
    return;
  }

  process.stdout.write(formatAiLintConsole(findings, files.length, config.project) + '\n');

  if (findings.some((f) => f.severity === 'BLOCKER' || f.severity === 'HIGH')) {
    process.exit(1);
  }
}

function formatMarkdown(findings: AiLintFinding[], fileCount: number, project = 'Repo'): string {
  const lines: string[] = [];
  lines.push(`## Thesmos AI-Lint — ${project}`);
  lines.push('');
  lines.push(`> ${fileCount} AI behavior file${fileCount === 1 ? '' : 's'} scanned`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('**✅ All AI behavior files pass governance checks.**');
    lines.push('');
    return lines.join('\n');
  }

  const ICON: Record<string, string> = {
    BLOCKER: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🔵', TECH_DEBT: '⚪',
  };

  lines.push(`**${findings.length} finding${findings.length === 1 ? '' : 's'}**`);
  lines.push('');
  lines.push('| Severity | Rule | File | Message |');
  lines.push('|---|---|---|---|');

  for (const f of findings) {
    const icon = ICON[f.severity] ?? '⬜';
    lines.push(
      `| ${icon} **${f.severity}** | \`${f.category}\` | \`${f.file}\` | ${f.message} |`,
    );
  }

  lines.push('');

  if (findings.some((f) => f.suggestion)) {
    lines.push('### Suggestions');
    lines.push('');
    for (const f of findings.filter((x) => x.suggestion)) {
      lines.push(`**\`${f.category}\`** · \`${f.file}\``);
      lines.push(`> ${f.suggestion}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
