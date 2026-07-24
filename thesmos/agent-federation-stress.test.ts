// @vitest-environment node
/**
 * Stress / adversarial tests for federated agent ownership, sync, discovery, and scope.
 * These intentionally probe failure modes that should never corrupt user content.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EMPTY_MANIFEST,
  contentHash,
  ensureManagedMarker,
  loadManagedManifest,
  managedClaudeAgentRel,
  resolveSafePath,
  upsertManagedRecord,
  writeManagedManifestAtomic,
} from './agent-ownership.js';
import { discoverAgents } from './agent-discovery.js';
import { syncManagedClaudeAgents } from './agent-sync.js';
import { checkScope, loadScopeConfig, type ScopeConfig } from './scope.js';

function tmpProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'thesmos-fed-stress-'));
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  return root;
}

function writeBlockingScope(root: string): ScopeConfig {
  const cfg = {
    version: '1.0',
    workspace: {
      allowedPaths: ['src/', '.thesmos/'],
      blockedPaths: ['.claude/', 'node_modules/', '.env'],
      absoluteBlockPaths: ['/etc/', '/usr/'],
    },
    operations: {
      allowDelete: false,
      allowGitPush: false,
      allowNetworkHosts: [] as string[],
      allowDatabaseWrites: false,
      requireConfirmation: [] as string[],
    },
    destructivePatterns: ['rm -rf', 'DROP TABLE'],
  };
  writeFileSync(join(root, '.thesmos', 'scope.json'), JSON.stringify(cfg, null, 2));
  return loadScopeConfig(root)!;
}

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
});

describe('federation stress — path safety', () => {
  it('rejects traversal and absolute paths in resolveSafePath', () => {
    const root = tmpProject();
    roots.push(root);
    const bad = [
      '../etc/passwd',
      '..\\etc\\passwd',
      '/etc/passwd',
      'C:\\Windows\\x',
      '.claude/agents/../../../etc/passwd',
      'foo/../../bar',
    ];
    for (const p of bad) {
      expect(() => resolveSafePath(root, p), p).toThrow();
    }
  });

  it('rejects malicious agentId that would escape managed namespace', () => {
    const root = tmpProject();
    roots.push(root);
    expect(() =>
      syncManagedClaudeAgents({
        root,
        desired: [
          {
            agentId: '../../../tmp/pwned-agent',
            content: '---\nid: x\nname: X\n---\n\nhi\n',
          },
        ],
      })
    ).toThrow();
    expect(existsSync(join(root, 'tmp', 'pwned-agent.md'))).toBe(false);
  });

  it('rejects empty agentId', () => {
    const root = tmpProject();
    roots.push(root);
    expect(() =>
      syncManagedClaudeAgents({
        root,
        desired: [{ agentId: '', content: 'x' }],
      })
    ).toThrow();
  });

  it('refuses to write a manifest with traversal keys', () => {
    const root = tmpProject();
    roots.push(root);
    expect(() =>
      writeManagedManifestAtomic(root, {
        version: 1,
        files: {
          '../../../etc/evil.md': {
            owner: 'thesmos',
            source: 'pantheon',
            agentId: 'evil',
            hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        },
      })
    ).toThrow();
  });

  it('refuses invalid hash schemes in manifest', () => {
    const root = tmpProject();
    roots.push(root);
    expect(() =>
      writeManagedManifestAtomic(root, {
        version: 1,
        files: {
          '.claude/agents/thesmos/x.md': {
            owner: 'thesmos',
            source: 'pantheon',
            agentId: 'x',
            hash: 'md5:abc',
          },
        },
      })
    ).toThrow();
  });
});

describe('federation stress — never overwrite user content', () => {
  it('does not overwrite an untracked file occupying the managed path', () => {
    const root = tmpProject();
    roots.push(root);
    const dest = join(root, '.claude', 'agents', 'thesmos');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'zeus-executive-agent.md'), 'EXTERNAL OCCUPANT\n', 'utf8');

    const result = syncManagedClaudeAgents({
      root,
      desired: [
        {
          agentId: 'zeus-executive-agent',
          content: '---\nid: zeus-executive-agent\nname: Zeus\n---\n\nv1\n',
        },
      ],
    });

    expect(result.collisions).toBe(1);
    expect(readFileSync(join(dest, 'zeus-executive-agent.md'), 'utf8')).toBe('EXTERNAL OCCUPANT\n');
    expect(loadManagedManifest(root).files[managedClaudeAgentRel('zeus-executive-agent')]).toBeUndefined();
  });

  it('preserves modified managed files across sync and stale removal', () => {
    const root = tmpProject();
    roots.push(root);
    const body = ensureManagedMarker(
      '---\nid: keep-agent\nname: Keep\n---\n\nv1\n',
      'keep-agent'
    );
    const stale = ensureManagedMarker(
      '---\nid: old-agent\nname: Old\n---\n\nold\n',
      'old-agent'
    );
    mkdirSync(join(root, '.claude', 'agents', 'thesmos'), { recursive: true });
    writeFileSync(join(root, '.claude', 'agents', 'thesmos', 'keep-agent.md'), body);
    writeFileSync(join(root, '.claude', 'agents', 'thesmos', 'old-agent.md'), stale);
    let manifest = upsertManagedRecord(EMPTY_MANIFEST, managedClaudeAgentRel('keep-agent'), 'keep-agent', body);
    manifest = upsertManagedRecord(manifest, managedClaudeAgentRel('old-agent'), 'old-agent', stale);
    writeManagedManifestAtomic(root, manifest);

    writeFileSync(join(root, '.claude', 'agents', 'thesmos', 'keep-agent.md'), 'LOCAL EDIT KEEP\n');
    writeFileSync(join(root, '.claude', 'agents', 'thesmos', 'old-agent.md'), 'LOCAL EDIT OLD\n');

    const result = syncManagedClaudeAgents({
      root,
      desired: [
        {
          agentId: 'keep-agent',
          content: '---\nid: keep-agent\nname: Keep\n---\n\nv2\n',
        },
      ],
    });

    expect(result.preserved).toBeGreaterThanOrEqual(2);
    expect(readFileSync(join(root, '.claude', 'agents', 'thesmos', 'keep-agent.md'), 'utf8')).toBe(
      'LOCAL EDIT KEEP\n'
    );
    expect(readFileSync(join(root, '.claude', 'agents', 'thesmos', 'old-agent.md'), 'utf8')).toBe(
      'LOCAL EDIT OLD\n'
    );
    // Ownership for modified stale must remain so we do not orphan the conflict
    const after = loadManagedManifest(root);
    expect(after.files[managedClaudeAgentRel('old-agent')]).toBeTruthy();
  });

  it('does not migrate legacy files when ownership cannot be proven', () => {
    const root = tmpProject();
    roots.push(root);
    writeFileSync(
      join(root, '.claude', 'agents', 'hermes-marketing-agent.md'),
      '---\nid: hermes-marketing-agent\nname: Hermes\n---\n\nCUSTOM\n',
      'utf8'
    );

    syncManagedClaudeAgents({
      root,
      migrateLegacy: true,
      desired: [
        {
          agentId: 'hermes-marketing-agent',
          content: '---\nid: hermes-marketing-agent\nname: Hermes\n---\n\nOFFICIAL\n',
        },
      ],
    });

    expect(readFileSync(join(root, '.claude', 'agents', 'hermes-marketing-agent.md'), 'utf8')).toContain(
      'CUSTOM'
    );
    // Managed namespace may still receive a new copy when free
    expect(existsSync(join(root, '.claude', 'agents', 'thesmos', 'hermes-marketing-agent.md'))).toBe(
      true
    );
  });

  it('dry-run never writes agent files or the manifest', () => {
    const root = tmpProject();
    roots.push(root);
    const result = syncManagedClaudeAgents({
      root,
      dryRun: true,
      desired: [
        {
          agentId: 'argus-security-agent',
          content: '---\nid: argus-security-agent\nname: Argus\n---\n\nx\n',
        },
      ],
    });
    expect(result.dryRun).toBe(true);
    expect(existsSync(join(root, '.claude', 'agents', 'thesmos', 'argus-security-agent.md'))).toBe(
      false
    );
    expect(existsSync(join(root, '.thesmos', 'managed-agents.json'))).toBe(false);
    expect(result.manifest.files[managedClaudeAgentRel('argus-security-agent')]).toBeUndefined();
  });

  it('rejects slash-containing agent ids (no nested escape under thesmos/)', () => {
    const root = tmpProject();
    roots.push(root);
    expect(() =>
      syncManagedClaudeAgents({
        root,
        desired: [
          {
            agentId: 'foo/bar',
            content: '---\nid: foo-bar\nname: X\n---\n\nx\n',
          },
        ],
      })
    ).toThrow(/Invalid agent id/);
  });
});

describe('federation stress — scope and discovery', () => {
  it('surfaces agent:install suggestion for external agents under blocked .claude/', () => {
    const root = tmpProject();
    roots.push(root);
    const cfg = writeBlockingScope(root);

    void cfg;
    // External (unmanaged) .claude/agents/ paths now get an agent:install suggestion when .claude/ is blocked.
    const externalViolation = checkScope({ toolName: 'Write', filePath: '.claude/agents/custom-agent.md', root });
    expect(externalViolation).not.toBeNull();
    expect(externalViolation!.suggestion).toContain('thesmos agent:install');
    expect(
      checkScope({ toolName: 'Write', filePath: '.claude/skills/x.md', root })
    ).not.toBeNull();

    const body = ensureManagedMarker(
      '---\nid: zeus-executive-agent\nname: Zeus\n---\n\nv1\n',
      'zeus-executive-agent'
    );
    mkdirSync(join(root, '.claude', 'agents', 'thesmos'), { recursive: true });
    writeFileSync(join(root, '.claude', 'agents', 'thesmos', 'zeus-executive-agent.md'), body);
    writeManagedManifestAtomic(
      root,
      upsertManagedRecord(
        EMPTY_MANIFEST,
        managedClaudeAgentRel('zeus-executive-agent'),
        'zeus-executive-agent',
        body
      )
    );

    expect(
      checkScope({
        toolName: 'Write',
        filePath: '.claude/agents/thesmos/zeus-executive-agent.md',
        root,
      })
    ).not.toBeNull();
  });

  it('survives a corrupt ownership manifest during discovery', () => {
    const root = tmpProject();
    roots.push(root);
    writeFileSync(join(root, '.thesmos', 'managed-agents.json'), '{not-json', 'utf8');
    writeFileSync(
      join(root, '.claude', 'agents', 'ok.md'),
      '---\nid: ok\nname: Ok\n---\n\nhi\n',
      'utf8'
    );
    const result = discoverAgents({ root, homeDir: join(root, 'home') });
    expect(result.agents.some((a) => a.id === 'ok')).toBe(true);
  });

  it('does not treat forged markers under thesmos/ as managed ownership', () => {
    const root = tmpProject();
    roots.push(root);
    mkdirSync(join(root, '.claude', 'agents', 'thesmos'), { recursive: true });
    const forged = ensureManagedMarker(
      '---\nid: forged-agent\nname: Forged\n---\n\nfake\n',
      'forged-agent'
    );
    writeFileSync(join(root, '.claude', 'agents', 'thesmos', 'forged-agent.md'), forged);
    // No manifest entry
    const result = discoverAgents({ root, homeDir: join(root, 'home') });
    const found = result.agents.find((a) => a.id === 'forged-agent');
    expect(found?.ownership).toBe('external');
    expect(result.conflicts.some((c) => c.agentId === 'forged-agent')).toBe(true);
  });

  it('enforces project > user precedence under heavy shadowing', () => {
    const root = tmpProject();
    roots.push(root);
    const home = join(root, 'home');
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true });

    for (let i = 0; i < 40; i++) {
      const id = `agent-${i}`;
      writeFileSync(
        join(home, '.claude', 'agents', `${id}.md`),
        `---\nid: ${id}\nname: User ${i}\n---\n\nuser\n`,
        'utf8'
      );
      writeFileSync(
        join(root, '.claude', 'agents', `${id}.md`),
        `---\nid: ${id}\nname: Project ${i}\n---\n\nproject\n`,
        'utf8'
      );
    }

    const result = discoverAgents({ root, homeDir: home });
    for (let i = 0; i < 40; i++) {
      const id = `agent-${i}`;
      const active = result.agents.find((a) => a.invocationName === id && a.status === 'active');
      expect(active?.origin).toBe('project');
    }
  });

  it('keeps scoped pantheon name available when project shadows unscoped id', () => {
    const root = tmpProject();
    roots.push(root);
    const home = join(root, 'home');
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true });

    const managed = ensureManagedMarker(
      '---\nid: argus-security-agent\nname: Argus\n---\n\nmanaged\n',
      'argus-security-agent'
    );
    mkdirSync(join(root, '.claude', 'agents', 'thesmos'), { recursive: true });
    writeFileSync(join(root, '.claude', 'agents', 'thesmos', 'argus-security-agent.md'), managed);
    writeManagedManifestAtomic(
      root,
      upsertManagedRecord(
        EMPTY_MANIFEST,
        managedClaudeAgentRel('argus-security-agent'),
        'argus-security-agent',
        managed
      )
    );
    writeFileSync(
      join(root, '.claude', 'agents', 'argus-security-agent.md'),
      '---\nid: argus-security-agent\nname: Local Argus\n---\n\noverride\n',
      'utf8'
    );

    const result = discoverAgents({ root, homeDir: home });
    const project = result.agents.find(
      (a) => a.invocationName === 'argus-security-agent' && a.origin === 'project'
    );
    expect(project?.status).toBe('active');
    expect(
      result.agents.some((a) => a.invocationName === 'pantheon:argus-security-agent')
    ).toBe(true);
  });
});

describe('federation stress — corrupt / hostile manifests', () => {
  it('loadManagedManifest rejects traversal keys (does not soft-accept them)', () => {
    const root = tmpProject();
    roots.push(root);
    writeFileSync(
      join(root, '.thesmos', 'managed-agents.json'),
      JSON.stringify({
        version: 1,
        files: {
          '../../../tmp/evil.md': {
            owner: 'thesmos',
            source: 'pantheon',
            agentId: 'evil',
            hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        },
      }),
      'utf8'
    );
    expect(() => loadManagedManifest(root)).toThrow(/Failed to load|traversal|Absolute/i);
  });

  it('discoverAgents does not throw on traversal keys in a hostile manifest', () => {
    const root = tmpProject();
    roots.push(root);
    writeFileSync(
      join(root, '.thesmos', 'managed-agents.json'),
      JSON.stringify({
        version: 1,
        files: {
          '../../../tmp/evil.md': {
            owner: 'thesmos',
            source: 'pantheon',
            agentId: 'evil',
            hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        },
      }),
      'utf8'
    );
    writeFileSync(
      join(root, '.claude', 'agents', 'ok.md'),
      '---\nid: ok\nname: Ok\n---\n\nhi\n',
      'utf8'
    );
    expect(() => discoverAgents({ root, homeDir: join(root, 'home') })).not.toThrow();
    const result = discoverAgents({ root, homeDir: join(root, 'home') });
    expect(result.agents.some((a) => a.id === 'ok')).toBe(true);
  });

  it('rejects truncated sha256 hashes in manifests', () => {
    const root = tmpProject();
    roots.push(root);
    expect(() =>
      writeManagedManifestAtomic(root, {
        version: 1,
        files: {
          '.claude/agents/thesmos/x.md': {
            owner: 'thesmos',
            source: 'pantheon',
            agentId: 'x',
            hash: 'sha256:abcd',
          },
        },
      })
    ).toThrow();
  });
});

describe('federation stress — atomic manifest and failure recovery', () => {
  it('leaves prior manifest intact when write validation fails mid-flight', () => {
    const root = tmpProject();
    roots.push(root);
    const body = ensureManagedMarker('---\nid: a\nname: A\n---\n\nx\n', 'a');
    mkdirSync(join(root, '.claude', 'agents', 'thesmos'), { recursive: true });
    writeFileSync(join(root, '.claude', 'agents', 'thesmos', 'a.md'), body);
    const good = upsertManagedRecord(EMPTY_MANIFEST, managedClaudeAgentRel('a'), 'a', body);
    writeManagedManifestAtomic(root, good);
    const before = readFileSync(join(root, '.thesmos', 'managed-agents.json'), 'utf8');

    expect(() =>
      writeManagedManifestAtomic(root, {
        version: 1,
        files: {
          '.claude/agents/thesmos/a.md': {
            owner: 'thesmos',
            source: 'pantheon',
            agentId: 'a',
            hash: 'not-a-hash',
          },
        },
      })
    ).toThrow();

    expect(readFileSync(join(root, '.thesmos', 'managed-agents.json'), 'utf8')).toBe(before);
  });

  it('sync of many agents is idempotent and hash-stable', () => {
    const root = tmpProject();
    roots.push(root);
    const desired = Array.from({ length: 50 }, (_, i) => ({
      agentId: `bulk-agent-${i}`,
      content: `---\nid: bulk-agent-${i}\nname: Bulk ${i}\n---\n\nbody-${i}\n`,
    }));

    const first = syncManagedClaudeAgents({ root, desired });
    expect(first.written).toBe(50);
    const second = syncManagedClaudeAgents({ root, desired });
    expect(second.updated).toBe(0);
    expect(second.written).toBe(0);
    expect(
      second.actions.filter((a) => a.action === 'skipped_unmodified').length
    ).toBe(50);

    const manifest = loadManagedManifest(root);
    for (const d of desired) {
      const rel = managedClaudeAgentRel(d.agentId);
      const onDisk = readFileSync(join(root, rel), 'utf8');
      expect(manifest.files[rel]?.hash).toBe(contentHash(onDisk));
    }
  });

  it('does not treat read-only untracked files as owned after a failed overwrite attempt', () => {
    const root = tmpProject();
    roots.push(root);
    const destDir = join(root, '.claude', 'agents', 'thesmos');
    mkdirSync(destDir, { recursive: true });
    const path = join(destDir, 'locked-agent.md');
    writeFileSync(path, 'LOCKED\n', 'utf8');
    try {
      chmodSync(path, 0o444);
    } catch {
      /* platform may ignore */
    }

    const result = syncManagedClaudeAgents({
      root,
      desired: [
        {
          agentId: 'locked-agent',
          content: '---\nid: locked-agent\nname: Locked\n---\n\nnew\n',
        },
      ],
    });

    expect(result.collisions).toBe(1);
    expect(readFileSync(path, 'utf8')).toBe('LOCKED\n');
    expect(loadManagedManifest(root).files[managedClaudeAgentRel('locked-agent')]).toBeUndefined();

    try {
      chmodSync(path, 0o644);
    } catch {
      /* */
    }
  });
});
