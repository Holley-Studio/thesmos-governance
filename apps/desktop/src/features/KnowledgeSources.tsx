import { useState } from 'react';
import type { RagBundle, RagStatus } from '../../shared/rag';
import { openKnowledgeSource, openDriveSource } from '../ipc/runtime';
import '../design/rag.css';

export function knowledgeStatusLabel(status?: RagStatus): string {
  if (!status) return 'Checking local sources…';
  if (!status.supported) return 'No approved sources for this project';
  return {empty:'Local index not built',building:'Building local index',ready:'Local index ready',stale:'Sources changed · rebuild needed',error:'Local index needs attention'}[status.state];
}

export function KnowledgeSources({ projectId, bundle, citationWarning, heading = 'Sources for this answer', headingLevel = 3 }: { projectId: string; bundle: RagBundle; citationWarning?: string; heading?: string; headingLevel?: 2 | 3 }) {
  const [error, setError] = useState('');
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const SourceHeading = headingLevel === 2 ? 'h3' : 'h4';
  return <section className="p-knowledge-evidence" aria-label={heading}>
    <div className="p-section-heading"><Heading className="p-evidence-heading">{heading}</Heading><span className="p-muted">{bundle.scope.toUpperCase()} · {bundle.mode === 'keyword' ? 'Keyword search' : 'Local source search'}</span></div>
    <p className="p-muted">Dated source passages support review; they do not verify every claim in the answer.</p>
    {citationWarning && <p role="alert" className="p-knowledge-warning">{citationWarning}</p>}
    {bundle.warnings.map((warning,i) => <p key={i} className="p-knowledge-warning">{warning}</p>)}
    {!bundle.sources.length && <p>{bundle.evidenceStatus === 'unavailable' ? 'Project sources are unavailable.' : 'There is not enough source evidence to answer this question.'}</p>}
    {bundle.sources.map(source => <article className="p-knowledge-source" key={source.id}>
      <SourceHeading className="p-source-heading"><span className="p-source-number">[{source.citation}]</span> {source.title}</SourceHeading>
      <p className="p-source-excerpt">{source.text}</p>
      <p className="p-muted">Snapshot {source.syncedAt ? new Date(source.syncedAt).toLocaleString() : 'date unknown'}{source.section ? ` · ${source.section}` : ''}</p>
      <div className="p-source-actions"><button className="p-text-button" type="button" onClick={() => { setError(''); void (bundle.scope === 'drive' ? openDriveSource(source.sourceId) : openKnowledgeSource(projectId,source.sourceId)).catch(e => setError(e instanceof Error ? e.message : 'Could not open this registered source.')); }}>Open in Drive</button>
      <details><summary>Source details</summary><dl><dt>Status</dt><dd>{source.status}</dd><dt>Registered source</dt><dd>{source.sourceId}</dd><dt>Local passage</dt><dd>{source.path}</dd><dt>Document version</dt><dd>{source.documentHash}</dd></dl></details></div>
    </article>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
