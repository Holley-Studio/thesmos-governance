import type { JSX } from 'react';
import { Icon } from './Icon';

// Local, reviewed assets. No remote requests or provider-derived paths at runtime.
const brands: Record<string, string> = {
 codex: 'openai.svg', openai: 'openai.svg', chatgpt: 'openai.svg',
 claude: 'claude-color.svg', ollama: 'ollama.svg',
 gemini: 'gemini-color.svg', grok: 'grok.svg',
 'google-drive': 'drive.png', gmail: 'gmail.png', slack: 'slack.png',
 'google-calendar': 'calendar.png',
 figma: 'figma-color.svg', nextcloud: 'nextcloud.svg',
};

/** Decorative beside a visible app name; the label remains readable by assistive technology. */
export function AppIcon({ service, size = 24 }: { service: string; size?: number }): JSX.Element {
 const asset = brands[service];
 return <span className="p-app-icon" aria-hidden="true" style={{ width: size, height: size }}>{asset
  ? <img src={`/brands/${asset}`} width={size} height={size} alt="" draggable={false}/>
  : <Icon name={service === 'evidence' ? 'files' : 'connections'} size={size}/>}</span>;
}
