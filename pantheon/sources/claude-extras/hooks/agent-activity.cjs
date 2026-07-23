// Claude Code hook — captures Agent tool pre/post events and appends to
// .thesmos/agent-activity.jsonl so the VSCode sidebar can display live
// agent activity without polling.
//
// Must always exit 0 — a non-zero exit blocks the Agent tool call.
// Written as CJS because Claude Code hooks run in plain Node (no bundler).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Canonical god map ─────────────────────────────────────────────────────────
// Loaded from thesmos/catalog/pantheon-map.json (single source of truth).
// The embedded fallback covers buyer installs where the catalog isn't present.

const FALLBACK_GODS = {
  zeus: { emoji: '⚡', name: 'Zeus', progressVerb: 'convening the council' },
  argus: { emoji: '👁', name: 'Argus', progressVerb: 'inspecting the perimeter' },
  athena: { emoji: '🦉', name: 'Athena', progressVerb: 'weighing the strategies' },
  ares: { emoji: '⚔️', name: 'Ares', progressVerb: 'sharpening the pitch' },
  apollo: { emoji: '✍️', name: 'Apollo', progressVerb: 'composing the verses' },
  hermes: { emoji: '🚀', name: 'Hermes', progressVerb: 'charting the channels' },
  aphrodite: { emoji: '🎨', name: 'Aphrodite', progressVerb: 'envisioning the aesthetic' },
  daedalus: { emoji: '🏗️', name: 'Daedalus', progressVerb: 'drafting the blueprints' },
  hephaestus: { emoji: '🔨', name: 'Hephaestus', progressVerb: 'forging the components' },
  themis: { emoji: '⚖️', name: 'Themis', progressVerb: 'consulting the statutes' },
  plutus: { emoji: '💰', name: 'Plutus', progressVerb: 'counting the treasury' },
  tyche: { emoji: '📊', name: 'Tyche', progressVerb: 'reading the numbers' },
  hera: { emoji: '🏛️', name: 'Hera', progressVerb: 'ordering the house' },
  hestia: { emoji: '💚', name: 'Hestia', progressVerb: 'tending the hearth' },
  heracles: { emoji: '🤝', name: 'Heracles', progressVerb: 'brokering the alliance' },
  nike: { emoji: '🎯', name: 'Nike', progressVerb: 'hunting the prospects' },
  pheme: { emoji: '📢', name: 'Pheme', progressVerb: 'shaping the narrative' },
  mnemosyne: { emoji: '📚', name: 'Mnemosyne', progressVerb: 'consulting the archives' },
  dionysus: { emoji: '🎬', name: 'Dionysus', progressVerb: 'staging the scenes' },
  morpheus: { emoji: '🌊', name: 'Morpheus', progressVerb: 'dreaming the motion' },
  artemis: { emoji: '📷', name: 'Artemis', progressVerb: 'framing the shot' },
  iris: { emoji: '📷', name: 'Iris', progressVerb: 'framing the shot' },
  pygmalion: { emoji: '🗿', name: 'Pygmalion', progressVerb: 'sculpting the mesh' },
  helios: { emoji: '☀️', name: 'Helios', progressVerb: 'casting the light' },
};

function loadGodMap() {
  try {
    const mapPath = path.join(process.cwd(), 'thesmos', 'catalog', 'pantheon-map.json');
    const parsed = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    if (parsed && parsed.gods) return parsed.gods;
  } catch {
    // fall through to embedded map
  }
  return FALLBACK_GODS;
}

const GODS = loadGodMap();

/** Resolve god entry from a subagent_type like "Argus — Security Agent". */
function godFor(subagentType) {
  const key = String(subagentType || '')
    .toLowerCase()
    .split(/[\s—–-]/)[0]
    .trim();
  return GODS[key] || null;
}

const MAX_LOG_LINES = 500;
const KEEP_LOG_LINES = 200;

process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(buf);

    // PostToolUse payloads have a tool_response field; PreToolUse do not.
    const isPost = Object.prototype.hasOwnProperty.call(payload, 'tool_response');
    const input = payload.tool_input ?? {};
    const sessionId = payload.session_id ?? 'unknown';
    const subagentType = String(input.subagent_type ?? 'general-purpose');
    const god = godFor(subagentType);

    const log = path.join(process.cwd(), '.thesmos', 'agent-activity.jsonl');
    fs.mkdirSync(path.dirname(log), { recursive: true });

    // tool_use_id may be absent in PreToolUse payloads depending on version —
    // fall back to a deterministic key so spawn and complete still pair up.
    const fallbackId = crypto
      .createHash('sha1')
      .update(`${sessionId}|${subagentType}|${String(input.description ?? '')}`)
      .digest('hex')
      .slice(0, 16);
    let agentId = payload.tool_use_id ?? fallbackId;

    const existing = fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
      : [];

    // Completion pairing: tool_use_id can be present on one side of the
    // Pre/Post pair and absent on the other, filing the complete under a
    // different id than the spawn — which leaves the god spinning forever.
    // If no spawn exists under the incoming id, complete the newest running
    // spawn with the same session/type/description fingerprint instead.
    if (isPost) {
      const parsed = existing
        .slice(-KEEP_LOG_LINES)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      const hasSpawnForId = parsed.some((e) => e.type === 'spawn' && e.agentId === agentId);
      if (!hasSpawnForId) {
        const done = new Set(
          parsed.filter((e) => e.type === 'complete' || e.type === 'error').map((e) => e.agentId),
        );
        const orphan = [...parsed].reverse().find((e) =>
          e.type === 'spawn' &&
          !done.has(e.agentId) &&
          e.sessionId === sessionId &&
          e.subagentType === subagentType &&
          (e.description || '') === String(input.description ?? ''));
        if (orphan) agentId = orphan.agentId;
      }
    }

    const out = [];

    // Zeus routing pseudo-event — one per session, pantheon spawns only.
    if (!isPost && god) {
      const zeusId = `zeus-${sessionId}`;
      const zeusExists = existing.slice(-50).some((l) => {
        try { return JSON.parse(l).agentId === zeusId; } catch { return false; }
      });
      if (!zeusExists) {
        out.push({
          ts: new Date().toISOString(),
          type: 'route',
          agentId: zeusId,
          sessionId,
          description: 'Zeus Routing',
          subagentType: 'zeus',
          godEmoji: '⚡',
          pantheon: true,
        });
      }
    }

    out.push({
      ts: new Date().toISOString(),
      type: isPost ? 'complete' : 'spawn',
      agentId,
      sessionId,
      description: String(input.description ?? ''),
      subagentType,
      pantheon: !!god,
      ...(god && {
        parentId: `zeus-${sessionId}`,
        godEmoji: god.emoji,
        progressVerb: god.progressVerb,
      }),
      ...(isPost && {
        resultSummary: String(payload.tool_response ?? '').slice(0, 200),
      }),
    });

    const lines = existing.concat(out.map((e) => JSON.stringify(e)));
    if (lines.length > MAX_LOG_LINES) {
      fs.writeFileSync(log, lines.slice(-KEEP_LOG_LINES).join('\n') + '\n');
    } else {
      fs.appendFileSync(log, out.map((e) => JSON.stringify(e)).join('\n') + '\n');
    }
  } catch {
    // silent — never block agent spawning on a logging error
  }

  process.exit(0);
});
