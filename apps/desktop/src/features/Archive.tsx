// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mnemosyne — The Archive.
 *
 * Memory must never be opaque, so every hit shows what it is, how confident
 * Thesmos is, where it came from and whether it is still current. Provenance is
 * on the record itself, not hidden behind a detail pane.
 */
import { useCallback, useEffect, useState} from 'react';
import type { JSX } from 'react';
import { runtime, type MemoryHit, type MemoryStats } from '../ipc/runtime';

export function Archive({ hasProject }: { hasProject: boolean }): JSX.Element {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MemoryHit[] | null>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasProject) return;
    runtime.memoryStats().then(setStats).catch(() => setStats(null));
  }, [hasProject]);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    try {
      const out = await runtime.memorySearch(query);
      setHits(out.results);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'search failed');
    }
  }, [query]);

  if (!hasProject) {
    return (
      <section className="section">
        <h2 className="inscription">Mnemosyne · The Archive</h2>
        <p className="notice">Choose a project to see what Thesmos remembers about it.</p>
      </section>
    );
  }

  return (
    <section className="section">
      <h2 className="inscription">Mnemosyne · The Archive</h2>

      {stats && (
        <p className="archive-stats">
          {stats.total} records · {stats.active ?? 0} active · {stats.superseded ?? 0} superseded
          {stats.vectors ? ` · ${stats.vectors} vectors` : ' · no embeddings'}
        </p>
      )}

      <div className="search-row">
        <label className="sr-only" htmlFor="archive-search">
          Search memory
        </label>
        <input
          id="archive-search"
          className="search-input"
          placeholder="Search what Thesmos remembers…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
        />
        <button type="button" className="btn-authority" onClick={() => void search()}>
          Search
        </button>
      </div>

      {error && <p className="notice">{error}</p>}
      {hits?.length === 0 && <p className="notice">Nothing remembered matches that.</p>}

      {hits?.map((hit) => (
        <article key={hit.id} className="memory">
          <div className="memory-head">
            <span className="memory-type">{hit.type.replace(/-/g, ' ')}</span>
            {/* Status and confidence are words, never colour alone. */}
            <span className="runtime-state" data-state={hit.status === 'active' ? 'complete' : 'dormant'}>
              {hit.status}
            </span>
          </div>
          <p className="memory-content">{hit.content}</p>
          <p className="memory-prov">
            {hit.confidence} · {hit.provenance.derivation} · {hit.provenance.creator}
            {hit.provenance.evidenceRef ? ` · evidence ${hit.provenance.evidenceRef}` : ''} ·{' '}
            {hit.updatedAt.slice(0, 10)}
          </p>
        </article>
      ))}
    </section>
  );
}
