// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { updateStatus, updateInstall, type UpdateStatus } from '../ipc/runtime';
import { Icon } from '../design/Icon';
import { Panel } from './StudioDialogs';

const RECHECK_MS = 30 * 60_000;

function useUpdates(): { status?: UpdateStatus; check: () => Promise<void> } {
 const [status, setStatus] = useState<UpdateStatus>();
 const check = useCallback(async () => { try { setStatus(await updateStatus()); } catch { /* an unreachable update folder must never block the workspace */ } }, []);
 useEffect(() => { void check(); const timer = setInterval(() => { if (!document.hidden) void check(); }, RECHECK_MS); return () => clearInterval(timer); }, [check]);
 return { status, check };
}

function useInstall(workBusy: boolean, onError: (message: string) => void): { installing: boolean; install: () => void } {
 const [installing, setInstalling] = useState(false);
 const install = (): void => {
  if (installing || workBusy) return; setInstalling(true);
  // On success the app exits and the installer restarts it, so only failure returns here.
  void updateInstall().catch((e: unknown) => { setInstalling(false); onError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'The update could not be installed'); });
 };
 return { installing, install };
}

/** Shown on every surface, but only when the update folder offers a newer version. */
export function UpdateBanner({ workBusy, onError }: { workBusy: boolean; onError: (message: string) => void }): JSX.Element | null {
 const { status } = useUpdates(); const { installing, install } = useInstall(workBusy, onError);
 const release = status?.available; if (!release) return null;
 return <div className="p-banner" role="status"><p><strong>Pantheon {release.version} is ready.</strong> {release.notes || 'A newer version has been published to the studio update folder.'}{workBusy ? ' Finish or stop the running job before updating.' : ''}</p>
  <button className="p-text-button" type="button" onClick={install} disabled={installing || workBusy}>{installing ? 'Preparing update…' : 'Update and restart'}<Icon name="refresh" size={15}/></button></div>;
}

/** Settings: which version this is, where updates come from, and a manual check. */
export function UpdatePanel({ workBusy, onError }: { workBusy: boolean; onError: (message: string) => void }): JSX.Element {
 const { status, check } = useUpdates(); const { installing, install } = useInstall(workBusy, onError);
 const [checking, setChecking] = useState(false);
 const recheck = (): void => { setChecking(true); void check().finally(() => setChecking(false)); };
 const release = status?.available;
 return <Panel title="Version and updates"><dl className="p-settings-list">
  <dt>This version</dt><dd>{status?.current ?? 'Checking…'}</dd>
  <dt>Latest published</dt><dd>{release ? `${release.version} — ready to install` : status?.latest ? `${status.latest} — up to date` : status?.problem ?? 'Checking…'}</dd>
  <dt>Update folder</dt><dd className="p-path">{status?.channel ?? 'Not found on this PC'}</dd>
 </dl><div className="p-settings-actions">
  <button className="p-button" type="button" onClick={recheck} disabled={checking}><Icon name="refresh"/>{checking ? 'Checking…' : 'Check for updates'}</button>
  {release && <button className="p-button p-primary" type="button" onClick={install} disabled={installing || workBusy}><Icon name="arrow"/>{installing ? 'Preparing update…' : `Install ${release.version} and restart`}</button>}
 </div></Panel>;
}
