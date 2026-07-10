// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mythic first-run output — pure string builders (no ANSI, no fs, no TTY
 * checks; the caller decides when to show these and whether to colorize).
 */

export function mythicBanner(): string {
  return [
    '',
    '  ⚡ T H E S M O S — the law the gods write for code',
    '  ────────────────────────────────────────────────',
    '',
  ].join('\n');
}

export interface OracleInput {
  grade: string;
  score: number;
  topFinding?: { severity: string; category: string; file: string };
  fileCount?: number;
}

export function formatOracleVerdict(input: OracleInput): string {
  const lines: string[] = [];
  lines.push('  ┌─ THE ORACLE SPEAKS ─────────────────────────────┐');
  lines.push(`  │  Health: ${input.grade} (${input.score}/100)`);
  if (input.fileCount !== undefined) {
    lines.push(`  │  👁 Argus surveyed ${input.fileCount} files`);
  }
  if (input.topFinding) {
    lines.push(`  │  First labor: [${input.topFinding.severity}] ${input.topFinding.category}`);
    lines.push(`  │    ${input.topFinding.file}`);
  } else {
    lines.push('  │  No new findings — the gates hold.');
  }
  lines.push('  └─────────────────────────────────────────────────┘');
  lines.push('');
  lines.push('  Next: thesmos review        — full findings');
  lines.push('        thesmos savings       — Credit Guardian report');
  lines.push('        VS Code extension     — summon the council (Pantheon Chat)');
  return lines.join('\n');
}
