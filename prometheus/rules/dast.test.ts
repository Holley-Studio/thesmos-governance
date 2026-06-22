// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DAST_RULES } from './dast';
import { CONFIG_DEFAULTS } from '../config';
import type { ScanResult } from '../types';

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
  pages: [],
  apiRoutes: [],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

function detect(ruleId: string, files: Array<{ path: string; content: string }>) {
  const r = DAST_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({ scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files });
}

// ── DAST_001 — XML entity expansion (XXE) ────────────────────────────────────

describe('DAST_001 — XML entity expansion', () => {
  it('fires on xml2js.parseString without entity protection', () => {
    const findings = detect('DAST_001', [{
      path: 'src/api/parse.ts',
      content: `
import xml2js from 'xml2js';
xml2js.parseString(req.body.xml, (err, result) => { res.json(result); });
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('fires on fast-xml-parser without allowDtd guard', () => {
    const findings = detect('DAST_001', [{
      path: 'src/parser.ts',
      content: `
import { XMLParser } from 'fast-xml-parser';
const parser = new XMLParser();
const result = parser.parse(xmlData);
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when allowDtd is false', () => {
    const findings = detect('DAST_001', [{
      path: 'src/parser.ts',
      content: `
import { XMLParser } from 'fast-xml-parser';
const parser = new XMLParser({ allowBooleanAttributes: true });
// allowDtd: false is default when not specified
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── DAST_002 — CORS wildcard with auth ───────────────────────────────────────

describe('DAST_002 — CORS wildcard with auth', () => {
  it('fires on wildcard CORS with Authorization header', () => {
    const findings = detect('DAST_002', [{
      path: 'src/api/route.ts',
      content: `
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
const token = req.headers.authorization;
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on cors() default (implicit wildcard) with session auth nearby', () => {
    const findings = detect('DAST_002', [{
      path: 'src/api/middleware.ts',
      content: `
app.use(cors());
app.use(cookieParser());
const session = req.cookies.sessionId;
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on wildcard CORS on public endpoint without auth', () => {
    const findings = detect('DAST_002', [{
      path: 'src/api/public.ts',
      content: `
res.setHeader('Access-Control-Allow-Origin', '*');
res.json({ status: 'ok' });
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── DAST_003 — Express without helmet ────────────────────────────────────────

describe('DAST_003 — missing helmet middleware', () => {
  it('fires on Express app without helmet', () => {
    const findings = detect('DAST_003', [{
      path: 'src/app.ts',
      content: `
import express from 'express';
const app = express();
app.use(express.json());
app.listen(3000);
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when helmet is used', () => {
    const findings = detect('DAST_003', [{
      path: 'src/app.ts',
      content: `
import express from 'express';
import helmet from 'helmet';
const app = express();
app.use(helmet());
app.listen(3000);
`,
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on non-server files', () => {
    const findings = detect('DAST_003', [{
      path: 'src/utils/format.ts',
      content: `
export function formatDate(date: Date) { return date.toISOString(); }
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── DAST_004 — sensitive param in GET ────────────────────────────────────────

describe('DAST_004 — sensitive GET parameter', () => {
  it('fires on password in GET query parameter', () => {
    const findings = detect('DAST_004', [{
      path: 'src/api/auth.ts',
      content: `
app.get('/api/login', (req, res) => {
  const password = req.query.password;
  const user = db.findUser(req.query.username, password);
});
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on token in GET query handler', () => {
    const findings = detect('DAST_004', [{
      path: 'src/api/verify.ts',
      content: `
router.get('/verify', async (req, res) => {
  const token = req.query.token;
  await verifyToken(token);
});
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire for GET with non-sensitive params', () => {
    const findings = detect('DAST_004', [{
      path: 'src/api/search.ts',
      content: `
app.get('/search', (req, res) => {
  const query = req.query.q;
  const page = req.query.page;
  res.json(search(query, page));
});
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── DAST_005 — eval with user input (RCE) ────────────────────────────────────

describe('DAST_005 — eval with user input', () => {
  it('fires on eval() near user input', () => {
    const findings = detect('DAST_005', [{
      path: 'src/api/calc.ts',
      content: `
app.post('/calculate', (req, res) => {
  const expr = req.body.expression;
  const result = eval(expr);
  res.json({ result });
});
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('fires on new Function() with user-controlled string', () => {
    const findings = detect('DAST_005', [{
      path: 'src/sandbox.ts',
      content: `
const fn = new Function('x', req.body.code);
fn(userInput);
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on eval in safe context without user input', () => {
    const findings = detect('DAST_005', [{
      path: 'test/helpers.ts',
      content: `
const result = eval('2 + 2');
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── DAST_006 — missing X-Frame-Options ───────────────────────────────────────

describe('DAST_006 — missing X-Frame-Options', () => {
  it('fires when response headers set but no X-Frame-Options', () => {
    const findings = detect('DAST_006', [{
      path: 'src/api/dashboard.ts',
      content: `
res.setHeader('Content-Type', 'text/html');
res.setHeader('Cache-Control', 'no-cache');
res.send(htmlContent);
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when X-Frame-Options is set', () => {
    const findings = detect('DAST_006', [{
      path: 'src/api/dashboard.ts',
      content: `
res.setHeader('X-Frame-Options', 'SAMEORIGIN');
res.setHeader('Content-Type', 'text/html');
res.send(htmlContent);
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── DAST_007 — methodOverride without auth ───────────────────────────────────

describe('DAST_007 — methodOverride without auth', () => {
  it('fires on methodOverride without auth middleware nearby', () => {
    const findings = detect('DAST_007', [{
      path: 'src/api/app.ts',
      content: `
import methodOverride from 'method-override';
app.use(methodOverride('_method'));
app.use(express.json());
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when auth middleware is present', () => {
    const findings = detect('DAST_007', [{
      path: 'src/api/app.ts',
      content: `
import methodOverride from 'method-override';
app.use(authenticate);
app.use(methodOverride('_method'));
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── DAST_008 — template injection (SSTI) ─────────────────────────────────────

describe('DAST_008 — template injection', () => {
  it('fires on template engine render with user-controlled template', () => {
    const findings = detect('DAST_008', [{
      path: 'src/api/render.ts',
      content: `
const template = req.body.template;
const html = ejs.render(template, { user: req.user });
res.send(html);
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('fires on nunjucks renderString with req.query template', () => {
    const findings = detect('DAST_008', [{
      path: 'src/render.ts',
      content: `
nunjucks.renderString(req.query.tpl, context);
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on static template file rendering', () => {
    const findings = detect('DAST_008', [{
      path: 'src/views.ts',
      content: `
res.render('dashboard', { user: req.user, data });
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── DAST_009 — extended body parser (prototype pollution) ────────────────────

describe('DAST_009 — express urlencoded extended:true', () => {
  it('fires on express.urlencoded with extended:true', () => {
    const findings = detect('DAST_009', [{
      path: 'src/app.ts',
      content: `
app.use(express.urlencoded({ extended: true }));
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire on extended:false', () => {
    const findings = detect('DAST_009', [{
      path: 'src/app.ts',
      content: `
app.use(express.urlencoded({ extended: false }));
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── DAST_010 — response splitting ────────────────────────────────────────────

describe('DAST_010 — response splitting', () => {
  it('fires on res.setHeader with user-controlled value', () => {
    const findings = detect('DAST_010', [{
      path: 'src/api/redirect.ts',
      content: `
res.setHeader('Location', req.query.destination);
res.status(302).send();
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on setHeader with req.body value', () => {
    const findings = detect('DAST_010', [{
      path: 'src/api/header.ts',
      content: `
res.setHeader('X-Custom-Header', req.body.headerValue);
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on static header values', () => {
    const findings = detect('DAST_010', [{
      path: 'src/api/route.ts',
      content: `
res.setHeader('Content-Type', 'application/json');
res.setHeader('Cache-Control', 'no-store');
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});
