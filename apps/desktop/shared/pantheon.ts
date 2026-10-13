// Public identities can evolve without changing canonical routing IDs or history.
const DEITY_ALIASES: Record<string, string> = {
 Cassandra: 'Themis', Argus: 'Phobos', Chiron: 'Athena', Chrysos: 'Plutus',
 Daedalus: 'Hephaestus', Pygmalion: 'Aphrodite', Pythia: 'Phoebe', Talos: 'Hephaestus',
};
export const godName = (name: string): string => DEITY_ALIASES[name] ?? name;
const ROLE_IDENTITIES: Record<string, string> = {
 'eidos-figma-orchestrator': 'Athena', 'ergon-code-layers': 'Hephaestus',
 'hyle-shader-material': 'Hephaestus', 'kairos-prototype-engineer': 'Kairos',
 'kinesis-motion-systems': 'Hermes', 'logos-ux-research': 'Athena',
 'mnemon-context-librarian': 'Mnemosyne', 'morphe-weave-workflow': 'Morpheus',
 'praxis-figma-make': 'Hephaestus', 'techne-design-system': 'Athena',
};
export const godIdentity = (canonicalId: string, legacyGod: string): string => ROLE_IDENTITIES[canonicalId] ?? godName(legacyGod || 'Metis');
export const pantheonText = (text: string): string => text.replace(/\b(Cassandra|Argus|Chiron|Chrysos|Daedalus|Pygmalion|Pythia|Talos)\b/g, (name) => godName(name));
const TITLES: Record<string, string> = {
 Zeus: 'Lord of Olympus', Hera: 'Guardian of the council', Athena: 'Wisdom & strategy',
 Apollo: 'Light & creative vision', Hermes: 'Messages & momentum', Hephaestus: 'Craft & creation',
 Themis: 'Order & assurance', Metis: 'Counsel & foresight', Aphrodite: 'Beauty & expression',
 Ares: 'Resolve & conquest', Artemis: 'Focus & precision', Demeter: 'Growth & abundance',
 Hestia: 'The heart of the studio', Mnemosyne: 'Memory & knowledge', Eos: 'New beginnings',
 Plutus: 'Resources & prosperity', Phoebe: 'Insight & clarity', Phobos: 'Threats & vigilance',
 };
export const divineTitle = (name: string): string => TITLES[godName(name)] ?? 'A mind of the Greek pantheon';
