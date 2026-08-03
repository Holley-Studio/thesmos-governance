// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos doctor — verify Thesmos installation health and show fix hints.
 *
 * Exit codes:
 *   0  all checks passed
 *   1  one or more checks failed (honest contract — CI can gate on this)
 *
 * Flags:
 *   --json           output as JSON
 *   --markdown       output as Markdown
 *   --soft           always exit 0 (legacy informational mode)
 *   --only=<group>   scope BOTH output and exit code to one check group
 *
 * `--only` exists because doctor's aggregate exit code mixes tree-derived
 * checks (adapters, model registry) with TIME-derived ones (report freshness,
 * baseline age). A required status check must be deterministic — the same tree
 * must always produce the same result — and a time-derived check fails any PR
 * opened late enough, regardless of its contents. `--only=models` gives CI a
 * gate that is a pure function of the tree.
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import {
  DOCTOR_GROUPS,
  runDoctorForRoot,
  formatDoctorConsole,
  formatDoctorMarkdown,
  formatDoctorJson,
} from '../../doctor.ts';

export async function cmdDoctor(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const soft = flag(flags, 'soft');
  const only = flagVal(flags, 'only');

  const allChecks = runDoctorForRoot(root, config);

  let checks = allChecks;
  if (only) {
    const wanted = only.toLowerCase();
    const groups = Object.values(DOCTOR_GROUPS);
    // Match the full group name, or any word of it, in either direction — so
    // `--only=models` finds "Model registry" and `--only=adapters` finds
    // "AI adapters". Exact match is tried first so a precise name always wins.
    const match =
      groups.find((g) => g.toLowerCase() === wanted) ??
      groups.find((g) =>
        g
          .toLowerCase()
          .split(/\s+/)
          .some((word) => word.startsWith(wanted) || wanted.startsWith(word)),
      );
    if (!match) {
      console.error(`doctor: unknown group "${only}". Known groups: ${groups.join(', ')}`);
      process.exit(2);
    }
    checks = allChecks.filter((c) => c.group === match);
    if (checks.length === 0) {
      console.error(`doctor: group "${match}" produced no checks — nothing was verified.`);
      process.exit(2);
    }
  }

  const pass = checks.every((c) => c.pass);

  if (json) {
    process.stdout.write(formatDoctorJson(checks) + '\n');
  } else if (markdown) {
    process.stdout.write(formatDoctorMarkdown(checks, config.project));
  } else {
    console.log(formatDoctorConsole(checks, config.project));
  }

  if (!pass && !soft) process.exit(1);
}
