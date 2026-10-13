import type { JSX } from 'react';
export type IconName = 'overview' | 'finance' | 'projects' | 'jobs' | 'playbooks' | 'files' | 'team' | 'connections' | 'knowledge' | 'settings' | 'chat' | 'calendar' | 'plus' | 'arrow' | 'check' | 'search' | 'close' | 'sun' | 'moon' | 'refresh' | 'shield' | 'spark' | 'stop' | 'export';
const paths: Record<IconName, JSX.Element> = {
 finance: <><path d="M3 7h16v14H3V7Zm0 0V3h13v4M15 12h6v5h-6v-5Z"/><circle cx="17" cy="14.5" r=".5"/></>,
 calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18M7 15h3m4 0h3M7 18h3"/></>,
 chat: <path d="M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6 4V4a1 1 0 0 1 1-1Zm3 5h10M7 12h6"/>,
 overview: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
 projects: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>,
 jobs: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 15h6"/></>,
 playbooks: <><path d="m9 4 10 8-10 8V4Z"/><path d="M4 4v16"/></>,
 files: <><path d="M14 2H5v20h14V7l-5-5Z"/><path d="M14 2v6h5M8 12h8M8 16h5"/></>,
 team: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/></>,
 connections: <><path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 7l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(-1 -1)"/></>,
 knowledge: <path d="M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2v16"/>,
 settings: <><circle cx="12" cy="12" r="3"/><path d="m9 3 1-1h4l1 1 1 3 3 1 2 3v4l-2 3-3 1-1 3-1 1h-4l-1-1-1-3-3-1-2-3v-4l2-3 3-1 1-3Z"/></>,
 plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>, check: <path d="m5 12 4 4L19 6"/>, search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>, close: <path d="m6 6 12 12M6 18 18 6"/>,
 sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/></>, moon: <path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z"/>,
 refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 8a8 8 0 0 1 14-2l1 3M19 16A8 8 0 0 1 5 18l-1-3"/></>,
 shield: <><path d="m12 2 8 4v6c0 6-8 10-8 10S4 18 4 12V6l8-4Z"/><path d="m8 12 3 3 5-6"/></>, spark: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>, stop: <rect x="5" y="5" width="14" height="14" rx="2"/>, export: <path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>,
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }): JSX.Element {
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function StudioMark(): JSX.Element {
 return <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" fill="none" stroke="currentColor"><path d="M6 17 24 7l18 10H6Zm4 23h28M7 44h34M13 21v15m7-15v15m8-15v15m7-15v15" strokeWidth="1.5"/><path d="m26 17-6 10h7l-5 9" strokeWidth="2"/></svg>;
}
export function GodSigil({ name }: { name: string }): JSX.Element {
 const symbols: Record<string, JSX.Element> = {
  Plutus: <><path d="M8 9c18 0 30 12 25 26-5 12-20 9-20-2 1-7 8-9 12-5-9 1-8 10-1 11M8 9l8 8-3 8-5-16Z"/><circle cx="31" cy="16" r="5"/><path d="M31 13v6m-2-5h3m-3 4h3"/></>,
  Zeus: <path d="m27 7-13 17h11l-6 17 16-22H24l3-12Z"/>,
  Athena: <><path d="m10 12 14 6 14-6v14c0 10-14 15-14 15S10 36 10 26V12Z"/><circle cx="18" cy="25" r="4"/><circle cx="30" cy="25" r="4"/><path d="m21 32 3 4 3-4M24 18v9"/></>,
  Apollo: <><circle cx="24" cy="24" r="9"/><path d="M24 5v7m0 24v7M5 24h7m24 0h7M10 10l5 5m18 18 5 5M10 38l5-5m18-18 5-5"/></>,
  Hermes: <><path d="M24 8v32M12 16l12 5 12-5M10 12l14 5 14-5M17 25c16-9 17 11 1 9m13-9c-16-9-17 11-1 9"/><circle cx="24" cy="7" r="3"/></>,
  Hephaestus: <><path d="m17 10 16 2 5 9-12 4-7-6-8 19-5-2 11-26Zm-7 31h31M29 31l7 5h-7l-5-5h5Z"/></>,
  Themis: <><path d="M24 7v33M12 40h24M8 15h32M13 15l-7 15h14l-7-15Zm22 0-7 15h14l-7-15Z"/><circle cx="24" cy="10" r="3"/></>,
  Metis: <><path d="M6 24s7-12 18-12 18 12 18 12-7 12-18 12S6 24 6 24Z"/><circle cx="24" cy="24" r="6"/><path d="M24 4v4m0 32v4"/></>,
  Aphrodite: <><path d="M24 31C5 21 9 7 19 12l5 5 5-5c10-5 14 9-5 19ZM24 31v12m-6-6h12"/></>,
  Ares: <><path d="M12 34V20a12 12 0 0 1 24 0v16l-7-3V21h-9v19l-8-6ZM24 5v10M7 11l6 5m22-1 6-6"/></>,
  Artemis: <><path d="M31 7a18 18 0 1 0 9 28A18 18 0 0 1 31 7ZM8 36l27-22m-10-1 11-1-2 11"/></>,
  Demeter: <><path d="M24 7v34m0-10c-12 1-15-6-15-6 12-1 15 6 15 6Zm0-9c-12 1-13-6-13-6 10-1 13 6 13 6Zm0 9c12 1 15-6 15-6-12-1-15 6-15 6Zm0-9c12 1 13-6 13-6-10-1-13 6-13 6Z"/></>,
  Mnemosyne: <><path d="M24 14c-7-5-14-4-17-3v26c6-2 12-1 17 2 5-3 11-4 17-2V11c-3-1-10-2-17 3v25ZM12 19h7m-7 7h7m10-7h7m-7 7h7"/></>,
  Hestia: <path d="M24 5c1 10-7 11-7 18 0 4 3 5 3 5s-4-10 9-13c-1 10 8 10 8 18a13 13 0 0 1-26 0c0-9 12-13 13-28Z"/>,
 };
 const seed = [...name].reduce((a,c)=>a+c.charCodeAt(0),0);
 return <svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{symbols[name] ?? <><path d={`M10 31 17 ${12+seed%7} 30 26 38 ${11+seed%11}M17 ${12+seed%7} 24 39l14-16`}/><circle cx="10" cy="31" r="2"/><circle cx="30" cy="26" r="3"/><circle cx="24" cy="39" r="2"/></>}</svg>;
}
