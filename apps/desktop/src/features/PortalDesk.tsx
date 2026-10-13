// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { useState } from 'react';
import type { JSX } from 'react';
import { openPortal, importPortalRequest } from '../ipc/runtime';
import type { Playbook, StudioJob } from '../../shared/studio';
import { Icon } from '../design/Icon';
import { Panel } from './StudioDialogs';

/**
 * Connections: the Holley Studio client portal.
 *
 * The link is a file handoff carried by a person. Pantheon opens the portal in
 * the browser, imports an accepted request as a planned job, and every export
 * packet already includes the portal package. Nothing is sent automatically.
 */
export function PortalDesk({ projectId, playbooks, onImported, onError }: { projectId: string; playbooks: Playbook[]; onImported: (job: StudioJob) => void; onError: (message: string) => void }): JSX.Element {
 const [playbookId, setPlaybookId] = useState(''); const [busy, setBusy] = useState(false);
 const chosen = playbookId || playbooks[0]?.id || '';
 const fail = (e: unknown, fallback: string): void => onError(typeof e === 'string' ? e : e instanceof Error ? e.message : fallback);
 const importRequest = (): void => {
  if (busy || !projectId || !chosen) return; setBusy(true);
  void importPortalRequest(projectId, chosen).then((job) => { if (job) onImported(job); }).catch((e: unknown) => fail(e, 'The portal request could not be imported')).finally(() => setBusy(false));
 };
 return <Panel title="Holley Studio portal"><dl className="p-settings-list">
  <dt>Client portal</dt><dd>portal.holley.studio — requests, exact-version reviews and released files for clients.</dd>
  <dt>Requests in</dt><dd>Import an accepted portal request file as a planned job. It is not started, and the requested date is recorded as the client’s request, not an agreed date.</dd>
  <dt>Deliverables out</dt><dd>Every export packet includes <code>portal-package.json</code>, listing the exact files and hashes for the portal to issue for client review. Client approval stays in the portal.</dd>
  <dt>Sending</dt><dd>Nothing is sent automatically. You carry each handoff.</dd>
 </dl><div className="p-settings-actions">
  <button className="p-button" type="button" onClick={() => void openPortal().catch((e: unknown) => fail(e, 'The portal could not be opened'))}><Icon name="arrow"/>Open the portal</button>
  <select aria-label="Playbook for the imported request" value={chosen} onChange={(e) => setPlaybookId(e.target.value)} disabled={!playbooks.length}>{playbooks.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select>
  <button className="p-button" type="button" onClick={importRequest} disabled={busy || !projectId || !chosen}><Icon name="plus"/>{busy ? 'Waiting for a file…' : projectId ? 'Import a portal request' : 'Choose a project first'}</button>
 </div></Panel>;
}
