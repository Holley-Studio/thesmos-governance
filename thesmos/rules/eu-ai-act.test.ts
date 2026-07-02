// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { EU_AI_ACT_RULES } from './eu-ai-act';
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
  const r = EU_AI_ACT_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({
    scan: EMPTY_SCAN,
    config: CONFIG_DEFAULTS,
    changedFiles: files,
    root: '/nonexistent-thesmos-test-root',
  });
}

// ── EU_AI_002 — prohibited biometric ─────────────────────────────────────────

describe('EU_AI_002 — eu_ai_prohibited_biometric', () => {
  it('does NOT fire on a CLI-shaped file: ai-fingerprint import + distant vendor help text', () => {
    // Mirrors thesmos/bin/cli.ts — "fingerprint" here is AI-authorship
    // detection, and "anthropic"/"gemini" are help-text words, not API calls.
    const helpFiller = Array.from({ length: 30 }, (_, i) => `// help line ${i}`).join('\n');
    const findings = detect('EU_AI_002', [{
      path: 'bin/cli.ts',
      content: [
        "import { cmdAiFingerprint } from './commands/ai-fingerprint.ts';",
        "const commands = { 'ai:fingerprint': cmdAiFingerprint };",
        helpFiller,
        'const HELP = `',
        '  --provider anthropic     System prompt block for Claude',
        '  --target gemini          Paste-ready text for Gemini Gems',
        '  ai:fingerprint           Detect AI-generated files',
        '`;',
      ].join('\n'),
    }]);
    expect(findings).toHaveLength(0);
  });

  it('fires on facial recognition adjacent to an Anthropic API call', () => {
    const findings = detect('EU_AI_002', [{
      path: 'src/vision.ts',
      content: [
        'export async function identify(frame: Buffer) {',
        '  const match = await llm.facialRecognition(frame);',
        '  const explained = await anthropic.messages.create({ messages: [] });',
        '  return { match, explained };',
        '}',
      ].join('\n'),
    }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('BLOCKER');
    expect(findings[0]?.line).toBe(2);
  });

  it('fires on verifyFingerprint within 10 lines of openai.chat.completions', () => {
    const findings = detect('EU_AI_002', [{
      path: 'src/auth/bio.ts',
      content: [
        'export async function login(user: User) {',
        '  const ok = verifyFingerprint(user);',
        '  if (!ok) throw new Error("denied");',
        '  // categorise the user with a model',
        '  const res = await openai.chat.completions.create({ messages: [] });',
        '  return res;',
        '}',
      ].join('\n'),
    }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('does NOT fire when biometric term and LLM call are 50+ lines apart', () => {
    const filler = Array.from({ length: 55 }, (_, i) => `const pad${i} = ${i};`).join('\n');
    const findings = detect('EU_AI_002', [{
      path: 'src/mixed.ts',
      content: [
        'const scanner = fingerprintScanner.init();',
        filler,
        'const res = await openai.chat.completions.create({ messages: [] });',
      ].join('\n'),
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when the only biometric mention is on an import line', () => {
    const findings = detect('EU_AI_002', [{
      path: 'src/imports.ts',
      content: [
        "import { fingerprintScanner } from './biometrics';",
        'const res = await anthropic.messages.create({ messages: [] });',
      ].join('\n'),
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on code-fingerprinting identifiers even next to an API call', () => {
    const findings = detect('EU_AI_002', [{
      path: 'src/authorship.ts',
      content: [
        'const fingerprintFinding = computeCodeFingerprint(file);',
        'const summary = await openai.chat.completions.create({ messages: [] });',
      ].join('\n'),
    }]);
    expect(findings).toHaveLength(0);
  });

  it('matches fingerprint_auth (biometric context via suffix)', () => {
    const findings = detect('EU_AI_002', [{
      path: 'src/gate.ts',
      content: [
        'const ok = fingerprint_auth(user);',
        'await anthropic.messages.create({ messages: [] });',
      ].join('\n'),
    }]);
    expect(findings).toHaveLength(1);
  });
});

// ── LLM_CALL_RE tightening — shared by EU_AI_005/006/008 ─────────────────────

describe('LLM_CALL_RE precision — dependent rules still fire on real API calls', () => {
  it('EU_AI_006 fires on a high-risk decision with a real OpenAI call and no audit log', () => {
    const findings = detect('EU_AI_006', [{
      path: 'src/credit.ts',
      content: [
        'export async function decideHire(app: Application) {',
        '  const rec = await openai.chat.completions.create({ messages: [] });',
        '  await hire(app.candidate);',
        '}',
      ].join('\n'),
    }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('EU_AI_006 does NOT fire when only bare vendor words appear (help text)', () => {
    const findings = detect('EU_AI_006', [{
      path: 'src/help.ts',
      content: [
        '// use gemini or another llm for completion of drafts before you hire',
        'export const docs = "manual process";',
      ].join('\n'),
    }]);
    expect(findings).toHaveLength(0);
  });

  it('EU_AI_007 fires on hiring decision via messages.create( with no human gate', () => {
    const findings = detect('EU_AI_007', [{
      path: 'src/hiring.ts',
      content: [
        'const recruitScore = await client.messages.create({ messages: [] });',
        'await hire(candidate);',
      ].join('\n'),
    }]);
    expect(findings).toHaveLength(1);
  });
});
