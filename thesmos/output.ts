/**
 * Output mode helpers — JSON, Markdown, and human-readable console.
 * Import and call `applyOutputMode` at the end of each script's main().
 */

/** Emit structured JSON to stdout */
export function renderJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/** Emit a markdown summary to stdout */
export function renderMarkdown(data: unknown, title: string): void {
  const ts = new Date().toISOString().split('T')[0];
  let md = `# ${title} — ${ts}\n\n`;

  if (typeof data === 'object' && data !== null) {
    md += objectToMarkdown(data as Record<string, unknown>);
  } else {
    md += String(data);
  }

  process.stdout.write(md + '\n');
}

function objectToMarkdown(obj: Record<string, unknown>, depth = 0): string {
  let out = '';
  for (const [key, val] of Object.entries(obj)) {
    const heading = '#'.repeat(Math.min(depth + 2, 5));
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

    if (Array.isArray(val)) {
      if (val.length === 0) {
        out += `${heading} ${label}\n\n_None_\n\n`;
      } else if (val.every((v) => typeof v === 'string')) {
        out += `${heading} ${label}\n\n`;
        for (const item of val as string[]) {
          out += `- \`${item}\`\n`;
        }
        out += '\n';
      } else {
        out += `${heading} ${label} (${val.length})\n\n`;
        for (const item of val) {
          if (typeof item === 'object' && item !== null) {
            out += '- ' + Object.entries(item as Record<string, unknown>)
              .map(([k, v]) => `**${k}:** ${v}`)
              .join(', ') + '\n';
          } else {
            out += `- ${item}\n`;
          }
        }
        out += '\n';
      }
    } else if (typeof val === 'object' && val !== null) {
      out += `${heading} ${label}\n\n`;
      out += objectToMarkdown(val as Record<string, unknown>, depth + 1);
    } else {
      out += `**${label}:** ${val}\n\n`;
    }
  }
  return out;
}

/**
 * Check args for --json or --markdown flags and emit accordingly.
 * Defaults to process.argv when args is not provided (production path).
 * If neither flag is set, does nothing (caller handles its own console output).
 *
 * Returns true if a machine-readable mode was active (caller may skip its own output).
 */
export function applyOutputMode(
  data: unknown,
  title: string,
  args: string[] = process.argv.slice(2)
): boolean {
  if (args.includes('--json')) {
    renderJson(data);
    return true;
  }
  if (args.includes('--markdown')) {
    renderMarkdown(data, title);
    return true;
  }
  return false;
}

/**
 * Inject a generated section into a markdown document, respecting
 * <!-- PROMETHEUS:GENERATED START id --> / <!-- PROMETHEUS:GENERATED END id --> markers.
 *
 * If markers do not exist, appends the section at the end.
 * Content outside markers is never modified.
 */
export function injectGeneratedSection(
  document: string,
  id: string,
  content: string
): string {
  const start = `<!-- PROMETHEUS:GENERATED START ${id} -->`;
  const end = `<!-- PROMETHEUS:GENERATED END ${id} -->`;
  const generated = `${start}\n${content}\n${end}`;

  if (document.includes(start) && document.includes(end)) {
    const before = document.slice(0, document.indexOf(start));
    const after = document.slice(document.indexOf(end) + end.length);
    return before + generated + after;
  }

  return document + '\n\n' + generated + '\n';
}

/**
 * Extract the content between generated section markers.
 * Returns null if markers are not present.
 */
export function extractGeneratedSection(document: string, id: string): string | null {
  const start = `<!-- PROMETHEUS:GENERATED START ${id} -->`;
  const end = `<!-- PROMETHEUS:GENERATED END ${id} -->`;

  const startIdx = document.indexOf(start);
  const endIdx = document.indexOf(end);
  if (startIdx === -1 || endIdx === -1) return null;

  return document.slice(startIdx + start.length, endIdx).trim();
}
