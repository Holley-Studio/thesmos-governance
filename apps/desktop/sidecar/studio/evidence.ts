import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Finding, SourceEvidence, StudioProject } from '../../shared/studio.js';
import { sha256 } from './store.js';

const MAX_FILE_BYTES = 100_000;
export function readEvidence(root: string, path: string, id: string): SourceEvidence | null {
  const candidate = join(root, path);
  if (!existsSync(candidate)) return null;
  const rel = relative(realpathSync(root), realpathSync(candidate));
  if (rel === '..' || rel.startsWith(`..${sep}`) || /^[A-Za-z]:/.test(rel) || lstatSync(candidate).isSymbolicLink()) throw new Error('Evidence path escapes the granted project');
  const stat = statSync(candidate);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  const text = readFileSync(candidate, 'utf8');
  // Read only the curated public website files, never credentials or general client folders.
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[a-zA-Z0-9_-]{20,}/.test(text)) throw new Error('Potential credential found in a source file. Remove it before continuing.');
  return { id, path: path.replaceAll('\\', '/'), sha256: sha256(text), capturedAt: new Date().toISOString(), excerpt: text.slice(0, 4000), content: text };
}

export function captureEvidence(project: StudioProject): { sources: SourceEvidence[]; findings: Finding[]; routes: string[] } {
  const paths = ['README.md', 'package.json', 'docs/growth-strategy.md', 'src/content/site.ts', 'src/content/testimonials.ts', 'src/lib/metadata.ts', 'src/lib/schema.ts', 'src/app/robots.ts', 'src/app/sitemap.ts', 'src/components/ui/ContactForm.tsx'];
  const sources = paths.map((p, i) => readEvidence(project.root, p, `S${i + 1}`)).filter((s): s is SourceEvidence => s !== null);
  const findings: Finding[] = [];
  const add = (severity: Finding['severity'], title: string, source: SourceEvidence, evidence: string, recommendation: string) => {
    findings.push({ id: `F${findings.length + 1}`, severity, title, sourceId: source.id, evidence, recommendation });
  };
  const form = sources.find((s) => s.path.endsWith('ContactForm.tsx'));
  if (form && /preventDefault/.test(form.content ?? form.excerpt) && /Demo.*not connected|no backend/i.test(form.content ?? form.excerpt)) add('blocker', 'Intake form is a demo stub', form, 'ContactForm prevents submission and explicitly marks itself as a disconnected demo or having no backend.', 'Choose the approved intake service, assess its data handling, wire the form, and verify submission and error behavior before launch.');
  const quotes = sources.find((s) => s.path.endsWith('testimonials.ts'));
  if (quotes && /isPlaceholder:\s*true/.test(quotes.excerpt)) add('blocker', 'Testimonials are illustrative placeholders', quotes, 'The source explicitly declares isPlaceholder: true.', 'Replace with client-approved authentic testimonials and approved attribution, or remove the section.');
  const config = sources.find((s) => s.path.endsWith('site.ts'));
  if (config && /https:\/\/demo\./.test(config.excerpt)) add('blocker', 'Canonical domain is configured for a demo', config, 'siteConfig.url references a demo subdomain.', 'Confirm the production hostname; verify canonical, metadata, sitemap, schema URLs, redirects, and crawl settings together.');
  const readme = sources.find((s) => s.path === 'README.md');
  if (readme && /pitch demo|placeholder|not a production/i.test(readme.excerpt)) add('attention', 'Photography and production scope need acceptance', readme, 'The README identifies the project as a pitch demo with placeholder photography.', 'Obtain final assets and a signed-off scope. Treat the demo as an internal sample until client review.');
  const historical = sources.find((s) => s.path.includes('growth-strategy'));
  if (historical) add('attention', 'Historical growth audit needs revalidation', historical, 'A supplied growth strategy was inspected locally; its observation dates and live-site claims have not been independently verified. This run has not crawled the live website.', 'Re-check each live-site claim and link fresh evidence. Do not describe an inferred spam risk as a confirmed Google penalty.');
  const schema = sources.find((s) => s.path.endsWith('schema.ts'));
  if (schema) add('info', 'Structured-data helpers exist; eligibility is unverified', schema, 'The source contains schema generation functions; no rendered validation or rich-result eligibility test ran.', 'Check rendered JSON-LD against visible content and current Google guidance. Structured data alone does not prove eligibility or improved rankings.');
  if (!form && project.kind === 'ohw') findings.push({ id: `F${findings.length + 1}`, severity: 'attention', title: 'Intake implementation was not inspected', sourceId: sources[0]?.id ?? 'none', evidence: 'The expected ContactForm source was not available.', recommendation: 'Locate the actual form implementation and test it before accepting a website release.' });
  const routes: string[] = [];
  const app = join(project.root, 'src', 'app');
  const walk = (dir: string, depth: number) => {
    if (depth > 5 || routes.length >= 80 || !existsSync(dir)) return;
    const rel = relative(realpathSync(project.root), realpathSync(dir));
    if (rel === '..' || rel.startsWith(`..${sep}`) || /^[A-Za-z]:/.test(rel)) throw new Error('Route folder escapes the granted project');
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path, depth + 1);
      if (entry.isFile() && /^page\.(tsx|jsx|ts|js)$/.test(entry.name)) routes.push('/' + relative(app, dir).split(sep).filter(Boolean).join('/'));
    }
  };
  walk(app, 0);
  return { sources, findings, routes: routes.sort() };
}
