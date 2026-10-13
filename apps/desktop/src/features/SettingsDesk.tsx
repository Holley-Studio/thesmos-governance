// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { runtime, type PantheonSettings, type PreferredWorker, type SettingsView } from '../ipc/runtime';
import { Icon } from '../design/Icon';
import { Panel } from './StudioDialogs';

const LOCAL_OLLAMA = 'http://127.0.0.1:11434';
const WORKERS: { id: PreferredWorker; label: string }[] = [
 { id: 'playbook', label: 'Each playbook’s own default' }, { id: 'ollama', label: 'Local Ollama' },
 { id: 'claude', label: 'Claude (your Claude subscription)' }, { id: 'codex', label: 'ChatGPT (your ChatGPT/Codex plan)' },
];

/**
 * Settings: set this PC up for its user. Stored on this PC only and never
 * changed by an update. The runtime validates every value; this form only
 * collects them.
 */
export function SettingsDesk({ onSaved, onError }: { onSaved: (view: SettingsView) => void; onError: (message: string) => void }): JSX.Element {
 const [view, setView] = useState<SettingsView>(); const [draft, setDraft] = useState<PantheonSettings>(); const [busy, setBusy] = useState(false);
 useEffect(() => { void runtime.settings().then((v) => { setView(v); setDraft(v.settings); }).catch((e: unknown) => onError(e instanceof Error ? e.message : 'Settings could not be read')); }, [onError]);
 if (!view || !draft) return <Panel title="This PC"><p className="p-muted" style={{ padding: 24 }}>Reading settings…</p></Panel>;
 const set = <K extends keyof PantheonSettings>(key: K, value: PantheonSettings[K]): void => setDraft({ ...draft, [key]: value });
 const changed = (Object.keys(draft) as (keyof PantheonSettings)[]).filter((key) => draft[key] !== view.settings[key]);
 const remoteOllama = draft.ollamaEndpoint.trim() !== '' && draft.ollamaEndpoint.trim().replace(/\/$/, '') !== LOCAL_OLLAMA;
 const save = (): void => {
  if (busy || !changed.length) return; setBusy(true);
  void runtime.saveSettings(Object.fromEntries(changed.map((key) => [key, draft[key]])))
   .then((next) => { setView(next); setDraft(next.settings); onSaved(next); })
   .catch((e: unknown) => onError(e instanceof Error ? e.message : 'Settings could not be saved'))
   .finally(() => setBusy(false));
 };
 return <Panel title="This PC"><form className="p-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
  <label htmlFor="set-name">Your name</label><input id="set-name" value={draft.displayName} maxLength={60} onChange={(e) => set('displayName', e.target.value)}/>
  <label htmlFor="set-studio">Studio</label><input id="set-studio" value={draft.studioName} maxLength={60} onChange={(e) => set('studioName', e.target.value)}/>
  <label htmlFor="set-worker">Default intelligence for new AI jobs</label>
  <select id="set-worker" value={draft.preferredWorker} onChange={(e) => set('preferredWorker', e.target.value as PreferredWorker)}>{WORKERS.map((w) => <option value={w.id} key={w.id}>{w.label}</option>)}</select>
  <p className="p-muted">This only preselects the engine. Each job still asks before anything is sent to Claude or ChatGPT, and each person signs in to their own subscription under Connections.</p>
  <label htmlFor="set-ollama">Ollama address</label><input id="set-ollama" value={draft.ollamaEndpoint} maxLength={60} spellCheck={false} placeholder={LOCAL_OLLAMA} onChange={(e) => set('ollamaEndpoint', e.target.value)}/>
  <p className="p-muted">{remoteOllama
   ? 'This is another machine on your network. Prompts, briefs and document passages for local AI will be sent to it instead of staying on this PC. Only private-network addresses are accepted.'
   : 'Ollama on this PC: nothing leaves the machine. To use Ollama on another studio machine, enter its address, for example http://192.168.0.160:11434.'}
   {view.activeOllama !== draft.ollamaEndpoint.trim().replace(/\/$/, '') && draft.ollamaEndpoint.trim() !== '' ? ` In use right now: ${view.activeOllama}. A new address applies after Pantheon is reopened.` : ''}</p>
  <label htmlFor="set-portal">Portal address</label><input id="set-portal" value={draft.portalUrl} maxLength={200} spellCheck={false} onChange={(e) => set('portalUrl', e.target.value)}/>
  <p className="p-muted">Where “Open the portal” goes. It must be an https:// address.</p>
  <div className="p-settings-actions"><button className="p-button p-primary" type="submit" disabled={busy || !changed.length}><Icon name="shield"/>{busy ? 'Saving…' : 'Save settings'}</button></div>
 </form></Panel>;
}
