// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Voice agent generator — creates real-time voice AI agent scaffold from wizard answers.
 *
 * Outputs (scaffold mode):
 *   - thesmos/agents/voice/<name>/session.ts    — session management
 *   - thesmos/agents/voice/<name>/transport.ts  — audio transport
 *   - thesmos/agents/voice/<name>/pipeline.ts   — STT → LLM → TTS pipeline
 */

import type { WizardAnswers, WizardContext } from '../wizard.js';
import { makeLogger } from '../../logger.js';

const log = makeLogger('generator:voice');

export interface VoiceArtifact {
  files: Array<{ path: string; content: string; label: string }>;
  voiceName: string;
}

// ── Session ───────────────────────────────────────────────────────────────────

function buildSession(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'voice-agent';
  const job = answers['job'] ?? 'assist via voice';
  const useCase = answers['useCase'] ?? 'personal assistant';

  return `/**
 * ${name} — voice session management
 * Purpose: ${job}
 * Use case: ${useCase}
 *
 * IMPORTANT: Audio data may contain PII. Apply data retention limits
 * and do not log or store raw audio beyond what is required.
 */

import { makeLogger } from '../../../logger.js';

const log = makeLogger('voice:${name}:session');

export interface VoiceSession {
  id: string;
  startedAt: string;
  useCase: '${useCase}';
  transcript: Array<{ role: 'user' | 'assistant'; content: string; ts: string }>;
  active: boolean;
}

const sessions = new Map<string, VoiceSession>();

export function createSession(): VoiceSession {
  const id = \`session-\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}\`;
  const session: VoiceSession = {
    id,
    startedAt: new Date().toISOString(),
    useCase: '${useCase}',
    transcript: [],
    active: true,
  };
  sessions.set(id, session);
  log.info('voice session started', { id });
  return session;
}

export function getSession(id: string): VoiceSession | undefined {
  return sessions.get(id);
}

export function appendTranscript(
  id: string,
  role: 'user' | 'assistant',
  content: string,
): void {
  const session = sessions.get(id);
  if (!session) throw new Error(\`Session not found: \${id}\`);
  session.transcript.push({ role, content, ts: new Date().toISOString() });
}

export function endSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.active = false;
  log.info('voice session ended', { id, turns: session.transcript.length });
  // TODO: persist transcript to audit trail if needed
  sessions.delete(id);
}
`;
}

// ── Transport ─────────────────────────────────────────────────────────────────

function buildTransport(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'voice-agent';
  const transport = answers['transport'] ?? 'browser SpeechAPI';
  const stt = answers['stt'] ?? 'browser native';
  const tts = answers['tts'] ?? 'browser native';
  const latency = answers['latency'] ?? 'standard (<1s)';

  const latencyNote = latency === 'real-time'
    ? '// Real-time target: <300ms round trip. Use streaming STT and streaming TTS.'
    : '// Standard latency: <1s. Batch STT, stream TTS for natural feel.';

  return `/**
 * ${name} — audio transport layer
 * Transport: ${transport}
 * STT: ${stt}
 * TTS: ${tts}
 * Latency target: ${latency}
 */

${latencyNote}

import { makeLogger } from '../../../logger.js';

const log = makeLogger('voice:${name}:transport');

export interface AudioChunk {
  data: Buffer;
  encoding: 'pcm' | 'opus' | 'mp3';
  sampleRate: number;
}

// ── Speech-to-Text ────────────────────────────────────────────────────────────

export async function transcribeAudio(audio: AudioChunk): Promise<string> {
  ${stt === 'deepgram'
    ? `// Deepgram STT — requires DEEPGRAM_API_KEY env var (BYOK)
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY required. Set env var — never hardcode.');
  // TODO: call Deepgram Nova-2 streaming API
  throw new Error('Deepgram STT not yet implemented');`
    : stt === 'assemblyai'
    ? `// AssemblyAI STT — requires ASSEMBLYAI_API_KEY env var (BYOK)
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY required. Set env var — never hardcode.');
  throw new Error('AssemblyAI STT not yet implemented');`
    : stt === 'whisper'
    ? `// OpenAI Whisper — requires OPENAI_API_KEY env var (BYOK)
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY required. Set env var — never hardcode.');
  throw new Error('Whisper STT not yet implemented');`
    : `// Browser native Web Speech API (client-side only)
  throw new Error('Browser SpeechRecognition must be used client-side');`}
}

// ── Text-to-Speech ────────────────────────────────────────────────────────────

export async function synthesizeSpeech(text: string): Promise<AudioChunk> {
  ${tts === 'elevenlabs'
    ? `// ElevenLabs TTS — requires ELEVENLABS_API_KEY env var (BYOK)
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY required. Set env var — never hardcode.');
  throw new Error('ElevenLabs TTS not yet implemented');`
    : tts === 'deepgram'
    ? `// Deepgram TTS — requires DEEPGRAM_API_KEY env var (BYOK)
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY required. Set env var — never hardcode.');
  throw new Error('Deepgram TTS not yet implemented');`
    : `// Browser native SpeechSynthesis (client-side only)
  throw new Error('Browser SpeechSynthesis must be used client-side');`}
}

// ── Transport connection ───────────────────────────────────────────────────────

export interface TransportConfig {
  onAudio: (chunk: AudioChunk) => Promise<void>;
  onClose: () => void;
}

export function createTransport(config: TransportConfig): { start: () => void; stop: () => void } {
  ${transport === 'webrtc'
    ? `// WebRTC transport — requires signaling server
  log.info('WebRTC transport created');
  return {
    start: () => { /* TODO: connect WebRTC peer */ },
    stop: () => { log.info('WebRTC transport stopped'); },
  };`
    : transport === 'twilio'
    ? `// Twilio Media Streams — requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (BYOK)
  log.info('Twilio transport created');
  return {
    start: () => { /* TODO: connect Twilio WebSocket media stream */ },
    stop: () => { log.info('Twilio transport stopped'); },
  };`
    : `// Browser SpeechAPI transport
  log.info('Browser transport created');
  return {
    start: () => { /* TODO: wire browser MediaRecorder */ },
    stop: () => { log.info('Browser transport stopped'); },
  };`}
}
`;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

function buildVoicePipeline(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'voice-agent';
  const job = answers['job'] ?? 'assist via voice';
  const llm = answers['llm'] ?? 'Claude (BYOK)';

  return `/**
 * ${name} — STT → LLM → TTS pipeline
 * Purpose: ${job}
 * LLM: ${llm}
 *
 * SECURITY: This pipeline processes audio that may contain PII.
 * - Do not log audio content
 * - Apply session timeout and cleanup
 * - Use BYOK API keys from env vars only
 */

import { makeLogger } from '../../../logger.js';
import { createSession, appendTranscript, endSession } from './session.js';
import { transcribeAudio, synthesizeSpeech } from './transport.js';
import type { AudioChunk } from './transport.js';

const log = makeLogger('voice:${name}:pipeline');

export interface PipelineConfig {
  systemPrompt?: string;
  maxTurns?: number;
  sessionTimeoutMs?: number;
}

const DEFAULT_SYSTEM_PROMPT = \`You are a voice AI assistant. ${job}

Guidelines:
- Keep responses concise (spoken responses should be under 3 sentences for latency)
- Confirm understanding before taking any actions
- Never request sensitive information like passwords or payment details
\`;

export async function startVoicePipeline(config: PipelineConfig = {}): Promise<{
  sessionId: string;
  processAudio: (audio: AudioChunk) => Promise<AudioChunk>;
  end: () => void;
}> {
  const session = createSession();
  const maxTurns = config.maxTurns ?? 100;
  const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  ${llm === 'claude'
    ? `const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for LLM. Set env var — never hardcode.');`
    : llm === 'openai'
    ? `const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY required for LLM. Set env var — never hardcode.');`
    : `// Local LLM — no API key needed`}

  async function processAudio(audio: AudioChunk): Promise<AudioChunk> {
    if (session.transcript.length >= maxTurns) {
      endSession(session.id);
      throw new Error('Session turn limit reached');
    }

    // 1. STT
    const userText = await transcribeAudio(audio);
    appendTranscript(session.id, 'user', userText);
    log.debug('transcribed', { sessionId: session.id, length: userText.length });

    // 2. LLM
    // TODO: call ${llm} with systemPrompt + session.transcript
    const assistantText = \`[TODO: wire ${llm} completion] Echo: \${userText}\`;
    appendTranscript(session.id, 'assistant', assistantText);

    // 3. TTS
    const audio_out = await synthesizeSpeech(assistantText);
    return audio_out;
  }

  return {
    sessionId: session.id,
    processAudio,
    end: () => endSession(session.id),
  };
}
`;
}

// ── Plan generator ────────────────────────────────────────────────────────────

export function generateVoicePlan(answers: WizardAnswers, context: WizardContext): string {
  const name = answers['name'] ?? 'voice-agent';
  const displayName = name.split('-').map((w: string) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  const job = answers['job'] ?? 'assist via voice';
  const transport = answers['transport'] ?? 'browser SpeechAPI';
  const stt = answers['stt'] ?? 'browser native';
  const tts = answers['tts'] ?? 'browser native';
  const llm = answers['llm'] ?? 'Claude (BYOK)';
  const useCase = answers['useCase'] ?? 'personal assistant';
  const latency = answers['latency'] ?? 'standard (<1s)';

  return [
    `# ${displayName} — Voice Agent Implementation Plan`,
    '',
    `## Purpose`,
    job,
    '',
    `## Architecture decisions`,
    '',
    `| Decision | Choice | Rationale |`,
    `|----------|--------|-----------|`,
    `| Transport | ${transport} | Audio delivery mechanism |`,
    `| STT | ${stt} | Speech-to-text provider (BYOK) |`,
    `| TTS | ${tts} | Text-to-speech provider (BYOK) |`,
    `| LLM | ${llm} | Language model for responses (BYOK) |`,
    `| Use case | ${useCase} | Shapes system prompt and response style |`,
    `| Latency target | ${latency} | ${latency === 'real-time' ? 'Requires streaming STT + TTS' : 'Batch STT, streaming TTS'} |`,
    '',
    `## Files to create`,
    '',
    `- \`thesmos/agents/voice/${name}/session.ts\` — session lifecycle`,
    `- \`thesmos/agents/voice/${name}/transport.ts\` — STT/TTS adapters`,
    `- \`thesmos/agents/voice/${name}/pipeline.ts\` — end-to-end pipeline`,
    '',
    `## Required API keys (all BYOK, never stored by Thesmos)`,
    '',
    stt === 'deepgram' || tts === 'deepgram' ? `- \`DEEPGRAM_API_KEY\`` : '',
    stt === 'assemblyai' ? `- \`ASSEMBLYAI_API_KEY\`` : '',
    stt === 'whisper' || llm === 'openai' ? `- \`OPENAI_API_KEY\`` : '',
    tts === 'elevenlabs' ? `- \`ELEVENLABS_API_KEY\`` : '',
    llm === 'claude' ? `- \`ANTHROPIC_API_KEY\`` : '',
    transport === 'twilio' ? `- \`TWILIO_ACCOUNT_SID\`\n- \`TWILIO_AUTH_TOKEN\`` : '',
    '',
    `## Security considerations`,
    '',
    `- **Audio = PII**: Never log raw audio content. Apply session timeout and cleanup.`,
    `- **API keys**: All keys via env vars only. Never hardcode.`,
    `- **Session isolation**: Each user session must be isolated. Prevent cross-session data leak.`,
    `- **Input validation**: Sanitize STT output before passing to LLM (injection via speech).`,
    `- **Rate limiting**: Apply per-session turn limits and time limits to prevent runaway costs.`,
    '',
    `## Test scenarios`,
    '',
    `1. Happy path: audio in → transcript → LLM response → audio out`,
    `2. Empty audio: graceful error, not a crash`,
    `3. Session timeout: session ends cleanly after max turns`,
    `4. Missing API key: clear error message pointing to env var`,
    '',
    `---`,
    `*Generated by thesmos build:voice --plan*`,
    `*Run: thesmos build:voice --scaffold to write code files*`,
  ].filter((l) => l !== '').join('\n');
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateVoice(
  answers: WizardAnswers,
  context: WizardContext,
  opts: { scaffold: boolean; planOnly: boolean },
): Promise<VoiceArtifact> {
  const name = (answers['name'] ?? 'voice-agent').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  answers['name'] = name;

  const files: VoiceArtifact['files'] = [];

  if (opts.scaffold) {
    files.push({
      path: `thesmos/agents/voice/${name}/session.ts`,
      content: buildSession(answers),
      label: 'Session management',
    });
    files.push({
      path: `thesmos/agents/voice/${name}/transport.ts`,
      content: buildTransport(answers),
      label: 'Audio transport (STT/TTS)',
    });
    files.push({
      path: `thesmos/agents/voice/${name}/pipeline.ts`,
      content: buildVoicePipeline(answers),
      label: 'Voice pipeline (STT → LLM → TTS)',
    });
  }

  log.info('voice generator complete', { name, files: files.length });
  return { files, voiceName: name };
}
