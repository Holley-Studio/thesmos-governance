import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from './store.js';
import type { MemoryProposal } from './types.js';

const faults = vi.hoisted(() => ({ remaining: 0, code: 'EPERM' }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, renameSync: (...args: Parameters<typeof fs.renameSync>) => {
    if (faults.remaining > 0) {
      faults.remaining--;
      throw Object.assign(new Error('replacement temporarily locked'), { code: faults.code });
    }
    return fs.renameSync(...args);
  } };
});

const roots: string[] = [];
afterEach(() => {
  faults.remaining = 0;
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const proposal: MemoryProposal = {
  scope: 'repository', type: 'constraint', content: 'Preserve durable memory.',
  provenance: { sourceKind: 'user', creator: 'fixture', derivation: 'stated' },
  confidence: 'high', sensitivity: 'project', metadata: {},
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'memory-atomic-'));
  roots.push(root);
  vi.stubGlobal('process', { ...process, platform: 'win32' });
  return { root, store: new MemoryStore(root) };
}

describe('atomic memory replacement', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])('persists records after a temporary Windows %s replacement lock', (code) => {
    const { root, store } = fixture();
    const original = store.append(proposal);
    faults.code = code;
    faults.remaining = 2;
    const saved = store.append({ ...proposal, content: 'Next durable constraint.' });
    expect(new MemoryStore(root).all().map(record => record.id)).toEqual([original.id, saved.id]);
  });

  it('keeps the original records and cleans temporary files after a persistent replacement lock', () => {
    const { root, store } = fixture();
    store.append(proposal);
    const before = readFileSync(store.paths.records, 'utf8');
    faults.code = 'EPERM';
    faults.remaining = 100;
    expect(() => store.append(proposal)).toThrow('replacement temporarily locked');
    expect(readFileSync(store.paths.records, 'utf8')).toBe(before);
    expect(readdirSync(join(root, '.thesmos', 'memory')).some(name => name.endsWith('.tmp') || name === '.write.lock')).toBe(false);
  });

  it('propagates non-transient replacement errors without retrying', () => {
    const { store } = fixture();
    store.append(proposal);
    faults.code = 'ENOENT';
    faults.remaining = 2;
    expect(() => store.append(proposal)).toThrow('replacement temporarily locked');
    expect(faults.remaining).toBe(1);
  });
});
