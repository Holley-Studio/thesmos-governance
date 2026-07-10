// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { GodMapper, domainColor } from '../chat/godMapper.js';
import { join } from 'node:path';

// The monorepo root two levels up contains thesmos/catalog/pantheon-map.json,
// so the mapper loads the real canonical map in these tests.
const repoRoot = join(__dirname, '..', '..', '..', '..');

describe('GodMapper', () => {
  const mapper = new GodMapper(repoRoot);

  it('resolves a plain god subagent_type', () => {
    const god = mapper.resolve('Argus — Security Agent');
    expect(god.name).toBe('Argus');
    expect(god.emoji).toBe('👁');
    expect(god.domain).toMatch(/Security/);
    expect(god.progressVerb.length).toBeGreaterThan(0);
  });

  it('resolves when the subagent_type has a leading emoji', () => {
    const god = mapper.resolve('🦉 Athena — Strategy Agent');
    expect(god.name).toBe('Athena');
  });

  it('is case-insensitive on the god key', () => {
    expect(mapper.resolve('zeus').name).toBe('Zeus');
    expect(mapper.resolve('ZEUS — Executive Agent').name).toBe('Zeus');
  });

  it('falls back to the Oracle for utility agents', () => {
    expect(mapper.resolve('general-purpose').name).toBe('Oracle');
    expect(mapper.resolve('Explore').name).toBe('Oracle');
  });

  it('assigns a security color to security domains', () => {
    expect(domainColor('Security & Threat Modeling')).toBe('#e5534b');
  });

  it('assigns the neutral color to unknown domains', () => {
    expect(domainColor('Underwater Basket Weaving')).toBe('#8b949e');
  });

  it('falls back to built-in gods when the workspace has no map', () => {
    const bare = new GodMapper('/nonexistent-path');
    expect(bare.resolve('Argus — Security Agent').name).toBe('Argus');
    expect(bare.resolve('unknowngod').name).toBe('Oracle');
  });
});
