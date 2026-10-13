// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { useState } from 'react';
import type { JSX } from 'react';
import { runtime, setApiKey, clearApiKey } from '../ipc/runtime';
import { API_COMPANY, type ApiWorkerId, type Connection } from '../../shared/studio';
import { Icon } from '../design/Icon';

const MODEL_SETTING: Record<ApiWorkerId, 'claudeApiModel' | 'openaiApiModel' | 'geminiApiModel'> = { 'claude-api': 'claudeApiModel', 'openai-api': 'openaiApiModel', 'gemini-api': 'geminiApiModel' };
export const apiStateLabel = (c: Connection): string => !c.api?.hasKey ? 'No key' : c.api.verified ? 'Key verified' : 'Key saved';
const message = (e: unknown, fallback: string): string => typeof e === 'string' ? e : e instanceof Error ? e.message : fallback;

/**
 * Save, check or remove one provider's API key, and choose its model. The key
 * goes to the native shell and is never read back: this form cannot show it.
 */
export function ApiKeyControls({ connection, onChanged, onNotice, onError }: { connection: Connection; onChanged: () => Promise<void>; onNotice: (text: string) => void; onError: (text: string) => void }): JSX.Element {
 const provider = connection.id as ApiWorkerId; const api = connection.api!; const company = API_COMPANY[provider];
 const [key, setKey] = useState(''); const [models, setModels] = useState<string[]>(); const [busy, setBusy] = useState(false);
 const run = (work: () => Promise<string>, fallback: string): void => { if (busy) return; setBusy(true); void work().then(onNotice).catch((e: unknown) => onError(message(e, fallback))).finally(() => { setBusy(false); void onChanged(); }); };
 const save = (): void => { const value = key.trim(); setKey(''); if (value) run(async () => { await setApiKey(provider, value); setModels(undefined); return `${connection.name} key saved on this PC, protected by Windows. List models to check it.`; }, 'The key could not be saved'); };
 const list = (): void => run(async () => { const result = await runtime.providerModels(provider); setModels(result.models); return `${company} accepted the key and listed ${result.models.length} models. No prompt or document was sent.`; }, 'Models could not be listed');
 const choose = (model: string): void => run(async () => { await runtime.saveSettings({ [MODEL_SETTING[provider]]: model }); return model ? `${connection.name} will use ${model}.` : `${connection.name} has no model chosen.`; }, 'The model could not be saved');
 const options = [...new Set([...(api.model ? [api.model] : []), ...(models ?? [])])];
 return <div className="p-api-key">
  <form onSubmit={(e) => { e.preventDefault(); save(); }}><label htmlFor={`key-${provider}`}>{api.hasKey ? 'Replace the saved key' : `${company} API key`}</label><div className="p-api-key-row"><input id={`key-${provider}`} type="password" value={key} maxLength={300} autoComplete="off" spellCheck={false} placeholder={api.hasKey ? 'A key is saved. It cannot be shown.' : 'Paste the key'} disabled={busy} onChange={(e) => setKey(e.target.value)}/><button className="p-button" type="submit" disabled={busy || !key.trim()}>Save key</button></div></form>
  {api.hasKey && <><label htmlFor={`model-${provider}`}>Model</label><div className="p-api-key-row"><select id={`model-${provider}`} value={api.model} disabled={busy || !models} onChange={(e) => choose(e.target.value)}>{!api.model && <option value="">No model chosen</option>}{options.map((m) => <option key={m} value={m}>{m}</option>)}</select><button className="p-button" type="button" disabled={busy} onClick={list}>{busy ? 'Working…' : 'List models'}</button></div>
  <button className="p-text-button" type="button" disabled={busy} onClick={() => run(async () => { await clearApiKey(provider); setModels(undefined); return `${connection.name} key removed from this PC.`; }, 'The key could not be removed')}>Remove key<Icon name="close" size={14}/></button></>}
  {!api.enabled && <p className="p-muted">Paid API engines are off. Turn them on in Settings before this can be used.</p>}
 </div>;
}
