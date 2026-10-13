// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * This PC's Pantheon settings.
 *
 * One small JSON file in the data directory, so each studio PC is set up for
 * its own user and hardware and an update never changes it. The list of
 * settings is closed: unknown keys are refused on write and ignored on read,
 * and a value that fails validation falls back to its default rather than
 * being half-trusted.
 *
 * The native shell reads `portalUrl` from the same file and validates it again
 * before opening anything.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_OLLAMA, validateOllamaEndpoint } from './ollama-endpoint.js';

export const DEFAULT_PORTAL_URL = 'https://portal.holley.studio/portal';
export type PreferredWorker = 'playbook' | 'ollama' | 'codex' | 'claude';

export interface PantheonSettings {
  /** Shown in the sidebar; not sent anywhere. */
  displayName: string;
  studioName: string;
  /** Which engine a new AI job starts on. `playbook` keeps each playbook's own default. */
  preferredWorker: PreferredWorker;
  /** Ollama on this PC, or on a private-network machine. */
  ollamaEndpoint: string;
  /** Where "Open the portal" goes. */
  portalUrl: string;
}

export const DEFAULT_SETTINGS: PantheonSettings = {
  displayName: 'Matthew Holley', studioName: 'Holley Studio', preferredWorker: 'playbook',
  ollamaEndpoint: LOCAL_OLLAMA, portalUrl: DEFAULT_PORTAL_URL,
};

function label(raw: unknown, name: string, max: number): string {
  if (typeof raw !== 'string') throw new Error(`Enter ${name}`);
  const text = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (!text || text.length > max || /[\u0000-\u001f\u007f<>]/.test(text)) throw new Error(`${name[0].toUpperCase()}${name.slice(1)} must be 1 to ${max} plain characters`);
  return text;
}

export function validatePortalUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 200) throw new Error('Enter the portal address as https://…');
  const text = raw.trim();
  if (!text) return DEFAULT_PORTAL_URL;
  let url: URL;
  try { url = new URL(text); } catch { throw new Error('The portal address is not a valid web address'); }
  // HTTPS only, and nothing that could carry a credential or disguise the destination.
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || /[^\x21-\x7e]/.test(text)) throw new Error('The portal address must be a plain https:// address');
  return url.toString();
}

const VALIDATORS: { [K in keyof PantheonSettings]: (raw: unknown) => PantheonSettings[K] } = {
  displayName: (raw) => label(raw, 'your name', 60),
  studioName: (raw) => label(raw, 'the studio name', 60),
  preferredWorker: (raw) => { if (raw !== 'playbook' && raw !== 'ollama' && raw !== 'codex' && raw !== 'claude') throw new Error('Choose a supported default intelligence'); return raw; },
  ollamaEndpoint: validateOllamaEndpoint,
  portalUrl: validatePortalUrl,
};
const KEYS = Object.keys(VALIDATORS) as (keyof PantheonSettings)[];

export class SettingsStore {
  private readonly file: string;
  constructor(private readonly dataDir: string) { this.file = join(dataDir, 'settings.json'); }

  /** Never throws: an unreadable file or a bad value reads as the default. */
  read(): PantheonSettings {
    const settings = { ...DEFAULT_SETTINGS };
    if (!existsSync(this.file)) return settings;
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(this.file, 'utf8').replace(/^﻿/, '')); } catch { return settings; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return settings;
    for (const key of KEYS) {
      if (!Object.hasOwn(raw, key)) continue;
      try { (settings as Record<string, unknown>)[key] = VALIDATORS[key]((raw as Record<string, unknown>)[key]); } catch { /* keep the default */ }
    }
    return settings;
  }

  /** Validate every supplied value, then write once. Nothing is written if any value is refused. */
  update(patch: unknown): PantheonSettings {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('No settings were sent');
    const entries = Object.entries(patch as Record<string, unknown>);
    if (!entries.length) throw new Error('No settings were sent');
    const next = this.read() as unknown as Record<string, unknown>;
    for (const [key, value] of entries) {
      if (!KEYS.includes(key as keyof PantheonSettings)) throw new Error(`"${key.slice(0, 40)}" is not a setting`);
      next[key] = VALIDATORS[key as keyof PantheonSettings](value);
    }
    mkdirSync(this.dataDir, { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', 'utf8');
    renameSync(temporary, this.file);
    return next as unknown as PantheonSettings;
  }
}
