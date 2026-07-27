// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Loading contracts from a real repository layout.
 *
 * The guarantee under test is a negative one: compiling a contract reads. It
 * never adopts an external agent, never rewrites a document, and never touches
 * the ownership manifest. Those are decided by `agent:adopt` and by
 * `.thesmos/managed-agents.json`, and the compiler is downstream of both.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCouncilContracts, findContract } from './load.js';
import { contentHash, upsertManagedRecord, writeManagedManifestAtomic, EMPTY_MANIFEST } from '../agent-ownership.js';
import { serializeContract } from './contract.js';
import { validateContracts } from './validate.js';

let root = '';
let home = '';

const EXTERNAL_AGENT = `---
name: My Own Agent
description: A user-owned agent that Thesmos does not manage.
tools:
  - Read
---

These are my instructions. Thesmos must not rewrite them.
`;

const MANAGED_AGENT = `---
id: managed-sample-agent
name: Managed Sample
type: agent
version: 1.0.0
owner: thesmos-pantheon
tags:
  - security
enabled: true
---

Managed instructions.
`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-council-root-'));
  home = mkdtempSync(join(tmpdir(), 'thesmos-council-home-'));
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  mkdirSync(join(root, '.claude', 'agents', 'thesmos'), { recursive: true });
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });

  writeFileSync(join(root, '.claude', 'agents', 'my-own-agent.md'), EXTERNAL_AGENT, 'utf8');

  const managedRel = '.claude/agents/thesmos/managed-sample-agent.md';
  writeFileSync(join(root, managedRel), MANAGED_AGENT, 'utf8');
  writeManagedManifestAtomic(
    root,
    upsertManagedRecord(EMPTY_MANIFEST, managedRel, 'managed-sample-agent', MANAGED_AGENT, 'pantheon')
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

function load() {
  return loadCouncilContracts({ root, homeDir: home, includeBuiltIn: false });
}

describe('external agents', () => {
  it('compiles a user-owned agent as external', () => {
    const contract = findContract(load().contracts, 'my-own-agent');
    expect(contract).toBeDefined();
    expect(contract!.provenance.ownership).toBe('external');
  });

  it('leaves the external document byte-identical', () => {
    const path = join(root, '.claude', 'agents', 'my-own-agent.md');
    const before = readFileSync(path, 'utf8');
    const beforeMtime = statSync(path).mtimeMs;
    load();
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(statSync(path).mtimeMs).toBe(beforeMtime);
  });

  it('does not add an external agent to the ownership manifest', () => {
    const manifestPath = join(root, '.thesmos', 'managed-agents.json');
    const before = readFileSync(manifestPath, 'utf8');
    load();
    const after = readFileSync(manifestPath, 'utf8');
    expect(after).toBe(before);
    expect(after).not.toContain('my-own-agent');
  });

  it('never lets an external agent claim Thesmos ownership', () => {
    const contract = findContract(load().contracts, 'my-own-agent')!;
    expect(contract.provenance.owner).not.toBe('thesmos');
    expect(validateContracts([contract]).valid).toBe(true);
  });

  it('grants an external agent no more than the conservative baseline', () => {
    const contract = findContract(load().contracts, 'my-own-agent')!;
    expect(contract.scope.writablePaths).toEqual([]);
    expect(contract.classification.mode).toBe('subagent');
    expect(contract.limits.maximumChildren).toBe(0);
  });
});

describe('managed agents', () => {
  it('compiles a manifest-listed agent as managed', () => {
    const contract = findContract(load().contracts, 'managed-sample-agent');
    expect(contract).toBeDefined();
    expect(contract!.provenance.ownership).toBe('managed');
    expect(contract!.classification.primaryRole).toBe('security');
  });

  it('records provenance that matches the file on disk', () => {
    const contract = findContract(load().contracts, 'managed-sample-agent')!;
    const onDisk = readFileSync(join(root, '.claude/agents/thesmos/managed-sample-agent.md'), 'utf8');
    expect(contract.provenance.contentHash).toBe(contentHash(onDisk.replace(/\r\n/g, '\n').trimEnd()));
    expect(contract.provenance.sourcePath).toBe('.claude/agents/thesmos/managed-sample-agent.md');
  });

  it('treats a file in the managed namespace but absent from the manifest as external', () => {
    writeFileSync(
      join(root, '.claude', 'agents', 'thesmos', 'sneaky-agent.md'),
      `---\nid: sneaky-agent\nname: Sneaky\ntype: agent\nversion: 1.0.0\nowner: thesmos\nenabled: true\n---\n\nx\n`,
      'utf8'
    );
    const contract = findContract(load().contracts, 'sneaky-agent')!;
    expect(contract.provenance.ownership).toBe('external');
  });
});

describe('discovery integration', () => {
  it('compiles agents from the injected home directory', () => {
    writeFileSync(
      join(home, '.claude', 'agents', 'home-agent.md'),
      `---\nname: Home Agent\ndescription: Design systems and accessibility work.\n---\n\nx\n`,
      'utf8'
    );
    const contract = findContract(load().contracts, 'home-agent');
    expect(contract).toBeDefined();
    expect(contract!.classification.primaryRole).toBe('design');
    expect(contract!.provenance.sourcePath).toMatch(/^~\/|home-agent\.md$/);
  });

  it('reports unreadable documents rather than dropping them silently', () => {
    const result = loadCouncilContracts({
      root,
      homeDir: home,
      includeBuiltIn: false,
      readFile: (p) => (p.includes('my-own-agent') ? null : readFileSync(p, 'utf8')),
    });
    expect(result.unreadable.length).toBe(1);
    expect(findContract(result.contracts, 'my-own-agent')).toBeUndefined();
  });

  it('compiles one contract per agent id, not one per invocation name', () => {
    const ids = load().contracts.map((c) => c.identity.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces a valid set for an ordinary repository', () => {
    expect(validateContracts(load().contracts).valid).toBe(true);
  });
});

describe('round trip', () => {
  it('recompiles to identical bytes from unchanged files', () => {
    const first = load().contracts.map((c) => serializeContract(c));
    const second = load().contracts.map((c) => serializeContract(c));
    expect(second).toEqual(first);
  });

  it('changes only the affected contract when one document changes', () => {
    const before = new Map(load().contracts.map((c) => [c.identity.id, serializeContract(c)]));
    writeFileSync(
      join(root, '.claude', 'agents', 'my-own-agent.md'),
      EXTERNAL_AGENT.replace('A user-owned agent', 'An edited user-owned agent'),
      'utf8'
    );
    for (const contract of load().contracts) {
      const changed = serializeContract(contract) !== before.get(contract.identity.id);
      expect(changed, contract.identity.id).toBe(contract.identity.id === 'my-own-agent');
    }
  });
});
