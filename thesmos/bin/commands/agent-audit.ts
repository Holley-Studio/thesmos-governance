/**
 * thesmos agent:audit:log     — append an audit entry (called from hooks)
 * thesmos agent:audit:verify  — verify hash chain integrity
 * thesmos agent:audit:report  — human-readable action summary
 * thesmos agent:audit:export  — export for compliance (JSON / CSV)
 *
 * Usage:
 *   thesmos agent:audit:log Write src/auth.ts --status BLOCKED --findings SEC_001,SEC_002
 *   thesmos agent:audit:verify
 *   thesmos agent:audit:report [--limit=100]
 *   thesmos agent:audit:export --format json
 *   thesmos agent:audit:export --format csv > audit.csv
 */
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import {
  appendAuditEntry,
  readAuditLog,
  verifyAuditChain,
  rotateAuditLog,
  formatAuditReport,
  formatAuditCsv,
  type AuditStatus,
} from '../../agent-audit.ts';

const VALID_STATUSES: AuditStatus[] = ['PASS', 'BLOCKED', 'WARN', 'INFO'];

export async function cmdAgentAudit(argv: string[]): Promise<void> {
  const sub = argv[0];
  const rest = argv.slice(1);
  const root = process.cwd();

  switch (sub) {
    case 'log': {
      const { flags, positionals } = parseArgs(rest);
      const tool = positionals[0] ?? 'Unknown';
      const file = positionals[1] ?? '-';
      const statusRaw = (flagVal(flags, 'status') ?? 'INFO').toUpperCase() as AuditStatus;
      const status: AuditStatus = VALID_STATUSES.includes(statusRaw) ? statusRaw : 'INFO';
      const findingsRaw = flagVal(flags, 'findings') ?? '';
      const findings = findingsRaw ? findingsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const session = flagVal(flags, 'session') ?? process.env['THESMOS_SESSION_ID'] ?? 'unknown';

      const entry = appendAuditEntry(root, tool, file, status, findings, session);
      process.stdout.write(`${entry.status}  ${entry.tool}  ${entry.file}  ${entry.hash.slice(0, 20)}...\n`);
      break;
    }

    case 'verify': {
      const result = verifyAuditChain(root);
      if (result.valid) {
        process.stdout.write(`Audit chain valid: ${result.totalEntries} entries verified.\n`);
      } else {
        process.stderr.write(`Audit chain INVALID at entry ${result.firstBrokenAt}: ${result.error}\n`);
        process.exit(1);
      }
      break;
    }

    case 'report': {
      const { flags } = parseArgs(rest);
      const json = flag(flags, 'json');
      const limitStr = flagVal(flags, 'limit');
      const limit = limitStr ? parseInt(limitStr, 10) : 50;
      const entries = readAuditLog(root, limit);

      if (json) {
        process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
      } else {
        process.stdout.write(formatAuditReport(entries) + '\n');
      }
      break;
    }

    case 'export': {
      const { flags } = parseArgs(rest);
      const format = flagVal(flags, 'format') ?? 'json';
      const entries = readAuditLog(root, 10000); // export all

      if (format === 'csv') {
        process.stdout.write(formatAuditCsv(entries));
      } else {
        process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
      }
      break;
    }

    case 'rotate': {
      const archived = rotateAuditLog(root);
      if (archived) {
        process.stdout.write(`Audit log archived to: ${archived}\n`);
        process.stdout.write(`Fresh log started at: .thesmos/audit.jsonl\n`);
      } else {
        process.stdout.write(`No audit log to rotate.\n`);
      }
      break;
    }

    default: {
      process.stderr.write(
        `Usage: thesmos agent:audit:<log|verify|report|export|rotate>\n` +
        `  log <tool> <file> --status <PASS|BLOCKED|WARN|INFO> --findings <id,...>\n` +
        `  verify\n` +
        `  report [--json] [--limit=50]\n` +
        `  export [--format json|csv]\n` +
        `  rotate\n`,
      );
      process.exit(1);
    }
  }
}
