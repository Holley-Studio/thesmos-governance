// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Brand registry and naming lint proof suite.
 *
 * These encode the naming decisions themselves, not the implementation. If
 * "Pantheon Pro" or a Nike-branded agent reappears on a public surface, or the
 * master brand is quietly marked cleared without an attorney decision, these
 * fail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BrandRegistry,
  excerptAround,
  isExempt,
  lintContent,
  loadBrandRegistry,
  runNamingLint,
  validateBrandRegistry,
} from './brand.ts';

// Two distinct roots: the naming lint walks the whole monorepo, while catalog
// files live under the thesmos package.
const REPO_ROOT = join(import.meta.dirname, '..');
const PKG_ROOT = import.meta.dirname;
const registry = loadBrandRegistry(REPO_ROOT);

describe('brand registry', () => {
  it('validates structurally', () => {
    expect(() => validateBrandRegistry(registry)).not.toThrow();
  });

  it('names Holley Studio LLC as the legal owner', () => {
    expect(registry.legal.owner).toBe('Holley Studio LLC');
  });

  it('keeps the master brand PROVISIONAL pending legal clearance', () => {
    // Only a recorded attorney decision may change this. A code change alone
    // must not be able to declare the mark cleared.
    expect(registry.masterBrand.status).toBe('provisional_pending_legal_clearance');
  });

  it('rejects a registry that declares the brand cleared', () => {
    const forged = { ...registry, masterBrand: { ...registry.masterBrand, status: 'cleared' } };
    expect(() => validateBrandRegistry(forged as BrandRegistry)).toThrow(/provisional_pending_legal_clearance/);
  });

  it('rejects a registry that changes the legal owner', () => {
    const forged = { ...registry, legal: { ...registry.legal, owner: 'Thesmos Inc.' } };
    expect(() => validateBrandRegistry(forged as BrandRegistry)).toThrow(/Holley Studio LLC/);
  });

  it('rejects an empty rule set — a lint that checks nothing is a false all-clear', () => {
    const forged = { ...registry, publicDisplayRules: [] };
    expect(() => validateBrandRegistry(forged as BrandRegistry)).toThrow(/non-empty/);
  });

  it('forbids trademark symbols during Phase 0', () => {
    expect(registry.legal.trademarkSymbolsAllowed).toBe(false);
  });

  it('marks Thesmos Business as future and not marketable', () => {
    const business = registry.tiers.find((t) => t.id === 'thesmos-business');
    expect(business?.status).toBe('future_not_available');
    expect(business?.marketingAllowed).toBe(false);
  });

  it('records Pro price as unverified rather than inventing a number', () => {
    const pro = registry.tiers.find((t) => t.id === 'thesmos-pro');
    expect(pro?.priceStatus).toBe('unverified');
  });

  it('classifies Pantheon and Nike as third-party review required', () => {
    for (const name of ['Pantheon', 'Nike']) {
      const entry = registry.nameClassifications.find((n) => n.name === name);
      expect(entry?.classification).toBe('third_party_review_required');
    }
  });

  it('permits Pantheon in the CLI namespace but not as a product or tier name', () => {
    const p = registry.nameClassifications.find((n) => n.name === 'Pantheon');
    expect(p?.allowedUses?.some((u) => u.includes('CLI'))).toBe(true);
    expect(p?.prohibitedUses).toContain('commercial tier name');
    expect(p?.prohibitedUses).toContain('primary product name');
  });

  it('records a non-affiliation statement and forbids logo use', () => {
    expect(registry.thirdPartyLanguage.nonAffiliationStatement).toMatch(/not affiliated with/i);
    expect(registry.thirdParties.every((t) => t.logoUseAuthorized === false)).toBe(true);
  });

  it('only allows interoperability verbs for third parties', () => {
    expect(registry.thirdPartyLanguage.allowedVerbs).toEqual(
      expect.arrayContaining(['Compatible with', 'Exports for', 'Connects to when configured']),
    );
    expect(registry.thirdPartyLanguage.prohibitedVerbs).toEqual(
      expect.arrayContaining(['Powered by', 'Official', 'Endorsed by']),
    );
  });
});

describe('naming lint', () => {
  it('reports ZERO errors across public surfaces', () => {
    const result = runNamingLint(REPO_ROOT);
    const detail = result.findings.slice(0, 10).map((f) => `${f.file}:${f.line} ${f.ruleId}`).join('\n');
    expect(result.errors, `naming violations:\n${detail}`).toBe(0);
    // A lint that scanned nothing would also report zero errors.
    expect(result.filesScanned).toBeGreaterThan(50);
  });

  const cases: [string, string][] = [
    ['Get Pantheon Pro today', 'no-pantheon-pro'],
    ['Open Pantheon Chat in the sidebar', 'no-pantheon-chat-primary'],
    ['Launch Zeus Forge to build an agent', 'no-zeus-forge'],
    ['Buy the Full Pantheon bundle', 'no-full-pantheon'],
    ['God Agent Nike — Lead Generation', 'no-nike-agent'],
    ['Thesmos Inc. is proud to announce', 'no-thesmos-as-company'],
    ['Thesmos stole fire from the gods', 'no-stolen-fire-narrative'],
    ['Thesmos™ Governance', 'no-trademark-symbols'],
  ];
  for (const [text, ruleId] of cases) {
    it(`flags "${text.slice(0, 34)}…" as ${ruleId}`, () => {
      const findings = lintContent(text, 'website/test.md', registry);
      expect(findings.map((f) => f.ruleId)).toContain(ruleId);
    });
  }

  it('does NOT flag the sanctioned "Full Thesmos Pantheon" form', () => {
    const findings = lintContent('Buy the Full Thesmos Pantheon', 'website/t.md', registry);
    expect(findings.filter((f) => f.ruleId === 'no-full-pantheon')).toHaveLength(0);
  });

  it('exempts history and generated output from naming rules', () => {
    // Rewriting a changelog to match current branding falsifies the record.
    expect(isExempt('CHANGELOG.md')).toBe(true);
    expect(isExempt('pantheon/exports/cursor/x.mdc')).toBe(true);
    expect(isExempt('thesmos/generated/pantheon-models.ts')).toBe(true);
    expect(isExempt('website/index.html')).toBe(false);
  });

  it('centres the excerpt on the match so late hits are visible', () => {
    const line = 'x'.repeat(400) + ' Pantheon Pro ' + 'y'.repeat(400);
    const out = excerptAround(line, line.indexOf('Pantheon Pro'), 'Pantheon Pro'.length);
    expect(out).toContain('Pantheon Pro');
    expect(out.length).toBeLessThan(200);
  });
});

describe('legacy id migration (Nike)', () => {
  const migrations = JSON.parse(
    readFileSync(join(PKG_ROOT, 'catalog', 'migrations.json'), 'utf8'),
  ) as { agentIds: { legacyId: string; canonicalId: string; removalPolicy: string }[] };

  it('maps both Nike ids to neutral canonical ids', () => {
    const byLegacy = new Map(migrations.agentIds.map((m) => [m.legacyId, m.canonicalId]));
    expect(byLegacy.get('nike-leadgen-agent')).toBe('lead-generation-agent');
    expect(byLegacy.get('nike-social-agent')).toBe('social-media-agent');
  });

  it('never removes a legacy alias — installed agents must keep resolving', () => {
    for (const m of migrations.agentIds) expect(m.removalPolicy).toBe('never_remove_alias');
  });

  it('ships the renamed agent documents with the legacy id retained as an alias', () => {
    const specs = [
      ['catalog/agents/pantheon/lead-generation-agent.md', 'nike-leadgen-agent'],
      ['catalog/agents/social-media-agent.md', 'nike-social-agent'],
    ] as const;
    for (const [rel, legacy] of specs) {
      const full = join(PKG_ROOT, rel);
      expect(existsSync(full), `${rel} should exist after rename`).toBe(true);
      const src = readFileSync(full, 'utf8');
      expect(src).toContain('legacy_ids:');
      expect(src).toContain(legacy);
      // The legacy id survives ONLY as an alias, never as the current identity.
      expect(src).not.toMatch(/^id: nike-/m);
      expect(src).not.toMatch(/^name: "God Agent Nike/m);
    }
  });

  it('removes the old Nike-named files', () => {
    expect(existsSync(join(PKG_ROOT, 'catalog/agents/pantheon/nike-leadgen-agent.md'))).toBe(false);
    expect(existsSync(join(PKG_ROOT, 'catalog/agents/nike-social-agent.md'))).toBe(false);
  });

  it('keeps the pantheon CLI namespace, which users depend on', () => {
    const preserved = JSON.parse(
      readFileSync(join(PKG_ROOT, 'catalog', 'migrations.json'), 'utf8'),
    ) as { preservedNamespaces: { namespace: string; policy: string }[] };
    expect(preserved.preservedNamespaces.some((n) => n.namespace.includes('pantheon'))).toBe(true);
  });
});
