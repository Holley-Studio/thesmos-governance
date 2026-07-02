// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Local LLM governance rules — Ollama, LM Studio, vLLM, LocalAI, Jan.ai.
 *
 * Local inference runtimes present a distinct risk profile from cloud LLMs:
 * no API key (key leakage is not the concern), but unique risks around
 * model injection, VRAM DoS, CORS exposure to the browser, and PII flowing
 * to an endpoint the developer thinks is "local" but is actually remote.
 */
import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, isTestPath, isCommentLine } from './helpers';

// ── Detection helpers ─────────────────────────────────────────────────────────

const PY_EXT  = /\.py$/;
const ENV_EXT = /\.env(?:\.\w+)?$/;

// Ollama JS/TS SDK calls
const OLLAMA_CALL_RE = /\bollama\s*\.\s*(?:generate|chat|embed(?:dings?)?|pull|push|create|delete|list)\s*\(/;
// Raw fetch to Ollama REST API
const OLLAMA_FETCH_RE = /fetch\s*\(\s*(?:`[^`]*(?:localhost|127\.0\.0\.1):?11434|['"][^'"]*(?:localhost|127\.0\.0\.1):?11434)/;
// OpenAI SDK with localhost baseURL (LM Studio, vLLM, LocalAI)
const LOCAL_BASE_URL_RE = /baseURL\s*:\s*['"`]https?:\/\/(?:localhost|127\.0\.0\.1)/;
// Python ollama package
const PY_OLLAMA_RE = /\bollama\.(?:generate|chat|embed(?:dings?)?)\s*\(/;
// User-controlled input patterns
const USER_INPUT_RE = /\breq(?:uest)?\.(?:body|query|params|json\(\))|params\[|getParam|formData\b|userInput\b|message\.content\b/;
// Model field from user input
const MODEL_USER_RE = /\bmodel\s*:\s*(?:req|params|query|body)\b/;
// Unpinned model name (no colon = no tag)
const UNPINNED_MODEL_RE = /\bmodel\s*:\s*['"`](llama|mistral|gemma|phi|qwen|deepseek|vicuna|codellama|tinyllama|orca|hermes|solar|neural|falcon)[^:'"`]*['"`]/i;
// stream: true without surrounding try/catch
const STREAM_RE = /\bstream\s*:\s*true\b/;
// AbortController / signal — timeout mechanism
const ABORT_RE = /\bsignal\s*:|AbortController|AbortSignal/;
// Sanitization in nearby context
const SANITIZE_RE = /sanitize|escape|validate|strip|purify|allowlist/i;
// Rate limiter
const RATE_LIMIT_RE = /rateLimit|rate_limit|rateLimiter|RateLimiter|throttle|slowDown/i;
// Schema validation on LLM response
const SCHEMA_VALIDATE_RE = /\.parse\s*\(|\.safeParse\s*\(|z\.object|ajv|validate\s*\(/;
// num_predict or num_ctx limit
const CTX_LIMIT_RE = /num_predict\s*:|num_ctx\s*:/;

function hasLocalLlmCall(content: string): boolean {
  return OLLAMA_CALL_RE.test(content) || OLLAMA_FETCH_RE.test(content) || LOCAL_BASE_URL_RE.test(content);
}

function windowAround(lines: string[], center: number, radius = 10): string {
  const start = Math.max(0, center - radius);
  const end   = Math.min(lines.length, center + radius + 1);
  return lines.slice(start, end).join('\n');
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export const LOCAL_LLM_RULES: ThesmosRule[] = [
  {
    id: 'LOCAL_LLM_001',
    category: 'local_llm_prompt_injection',
    severity: 'BLOCKER',
    description: 'User input interpolated directly into an Ollama prompt or messages without sanitization — prompt injection.',
    tags: ['ai', 'local-llm', 'security', 'prompt-injection'],
    sinceVersion: '2.4.0',
    explain: {
      why: 'Local LLMs have no built-in prompt injection protection. User-supplied content can override system instructions, exfiltrate data, or cause the model to produce harmful output that your app then acts on.',
      commonViolations: [
        'ollama.generate({ model: "llama3", prompt: req.body.userMessage })',
        'ollama.chat({ messages: [{ role: "user", content: req.body.text }] })',
      ],
      goodExample: 'const safeInput = sanitize(req.body.userMessage);\nollama.generate({ model: "llama3:8b", prompt: safeInput });',
      badExample: 'ollama.generate({ prompt: req.body.userMessage });  // user controls the prompt',
      relatedPlaybooks: ['ai-governance.md'],
      relatedAgents: ['argus-security-agent'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_llm_prompt_injection', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        const isSource = SOURCE_EXT.test(path) || PY_EXT.test(path);
        if (!isSource || isTestPath(path)) continue;
        if (!hasLocalLlmCall(content) && !PY_OLLAMA_RE.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          const hasCall = OLLAMA_CALL_RE.test(line) || OLLAMA_FETCH_RE.test(line) || PY_OLLAMA_RE.test(line);
          if (!hasCall) continue;
          const window = windowAround(lines, i, 10);
          if (USER_INPUT_RE.test(window) && !SANITIZE_RE.test(window)) {
            findings.push({
              severity,
              category: 'local_llm_prompt_injection',
              file: path,
              line: i + 1,
              message: 'User input flows into Ollama call without sanitization — prompt injection risk.',
              suggestion: 'Sanitize or validate user input before passing to the LLM prompt/messages.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOCAL_LLM_002',
    category: 'local_llm_model_injection',
    severity: 'BLOCKER',
    description: 'model: field sourced from user input — attacker can load any model on the server.',
    tags: ['ai', 'local-llm', 'security', 'injection'],
    sinceVersion: '2.4.0',
    explain: {
      why: 'Ollama will pull and run any model name passed to it. A user who controls the model field can load a model of their choosing, exhausting disk/VRAM, or substituting a fine-tuned model that bypasses your safety prompts.',
      commonViolations: [
        'ollama.generate({ model: req.body.model, prompt })',
        'ollama.chat({ model: req.query.m, messages })',
      ],
      goodExample: "const ALLOWED = ['llama3:8b-instruct-q4_0', 'mistral:7b-instruct-q4_0'];\nconst model = ALLOWED.includes(req.body.model) ? req.body.model : ALLOWED[0];",
      badExample: 'ollama.generate({ model: req.body.model, prompt });  // any model loaded on demand',
      relatedPlaybooks: ['ai-governance.md'],
      relatedAgents: ['argus-security-agent'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_llm_model_injection', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        const isSource = SOURCE_EXT.test(path) || PY_EXT.test(path);
        if (!isSource || isTestPath(path)) continue;
        if (!hasLocalLlmCall(content) && !PY_OLLAMA_RE.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (MODEL_USER_RE.test(line)) {
            const window = windowAround(lines, i, 8);
            if (OLLAMA_CALL_RE.test(window) || OLLAMA_FETCH_RE.test(window) || LOCAL_BASE_URL_RE.test(window)) {
              findings.push({
                severity,
                category: 'local_llm_model_injection',
                file: path,
                line: i + 1,
                message: 'model: field comes from user input — attacker can trigger arbitrary model loading.',
                suggestion: 'Validate model against an explicit allowlist before passing to Ollama.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOCAL_LLM_003',
    category: 'local_llm_host_network_exposed',
    severity: 'BLOCKER',
    description: 'OLLAMA_HOST=0.0.0.0 in .env — exposes the inference API to the entire network without authentication.',
    tags: ['ai', 'local-llm', 'security', 'network'],
    sinceVersion: '2.4.0',
    explain: {
      why: 'Ollama has no authentication layer. Binding to 0.0.0.0 makes the API reachable from any machine on the network — anyone can generate text, pull models, or list your local models without credentials.',
      commonViolations: ['OLLAMA_HOST=0.0.0.0', 'OLLAMA_HOST=0.0.0.0:11434'],
      goodExample: '# Default (localhost-only):\nOLLAMA_HOST=127.0.0.1:11434\n# Or omit OLLAMA_HOST entirely',
      badExample: 'OLLAMA_HOST=0.0.0.0  # entire network can hit port 11434',
      relatedPlaybooks: ['ai-governance.md'],
      relatedAgents: ['argus-security-agent'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_llm_host_network_exposed', config.severityRules);
      const findings: Finding[] = [];
      const EXPOSED_RE = /^OLLAMA_HOST\s*=\s*0\.0\.0\.0/m;
      for (const { path, content } of changedFiles) {
        if (!ENV_EXT.test(path)) continue;
        if (EXPOSED_RE.test(content)) {
          const lines = content.split('\n');
          const lineNum = lines.findIndex((l) => /^OLLAMA_HOST\s*=\s*0\.0\.0\.0/.test(l)) + 1;
          findings.push({
            severity,
            category: 'local_llm_host_network_exposed',
            file: path,
            line: lineNum || undefined,
            message: 'OLLAMA_HOST=0.0.0.0 exposes the unauthenticated Ollama API to your entire network.',
            suggestion: 'Remove OLLAMA_HOST or set it to 127.0.0.1 to restrict to localhost.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'LOCAL_LLM_004',
    category: 'local_llm_cors_wildcard',
    severity: 'HIGH',
    description: 'OLLAMA_ORIGINS=* in .env — any website can call localhost:11434 from the browser via CORS.',
    tags: ['ai', 'local-llm', 'security', 'cors'],
    sinceVersion: '2.4.0',
    explain: {
      why: "Ollama's CORS default changed across versions. Setting OLLAMA_ORIGINS=* lets any website make cross-origin requests from the browser to localhost:11434, enabling malicious sites to use your local GPU for their inference.",
      commonViolations: ['OLLAMA_ORIGINS=*', 'OLLAMA_ORIGINS=http://evil.example.com,*'],
      goodExample: 'OLLAMA_ORIGINS=http://localhost:3000,http://localhost:5173',
      badExample: 'OLLAMA_ORIGINS=*  # any website can call your local Ollama from the browser',
      relatedPlaybooks: ['ai-governance.md'],
      relatedAgents: ['argus-security-agent'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_llm_cors_wildcard', config.severityRules);
      const findings: Finding[] = [];
      const WILDCARD_RE = /^OLLAMA_ORIGINS\s*=.*\*/m;
      for (const { path, content } of changedFiles) {
        if (!ENV_EXT.test(path)) continue;
        if (WILDCARD_RE.test(content)) {
          const lines = content.split('\n');
          const lineNum = lines.findIndex((l) => /^OLLAMA_ORIGINS\s*=.*\*/.test(l)) + 1;
          findings.push({
            severity,
            category: 'local_llm_cors_wildcard',
            file: path,
            line: lineNum || undefined,
            message: 'OLLAMA_ORIGINS=* allows any website to call localhost:11434 from the browser.',
            suggestion: 'Set OLLAMA_ORIGINS to specific allowed origins, e.g. http://localhost:3000.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'LOCAL_LLM_005',
    category: 'local_llm_no_timeout',
    severity: 'HIGH',
    description: 'Ollama call without AbortController signal — generation can hang indefinitely, exhausting VRAM.',
    tags: ['ai', 'local-llm', 'reliability', 'performance'],
    sinceVersion: '2.4.0',
    explain: {
      why: 'Unlike cloud APIs, local models have no built-in request timeout. A hung generation holds VRAM, blocks other requests, and can eventually OOM the host. Always pass an AbortController signal.',
      commonViolations: ['await ollama.generate({ model, prompt })', 'await ollama.chat({ model, messages })'],
      goodExample: 'const ac = new AbortController();\nsetTimeout(() => ac.abort(), 30_000);\nawait ollama.generate({ model, prompt, signal: ac.signal });',
      badExample: 'await ollama.generate({ model, prompt });  // no timeout — can hang forever',
      relatedPlaybooks: ['ai-governance.md'],
      relatedAgents: ['argus-security-agent'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_llm_no_timeout', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!OLLAMA_CALL_RE.test(content) && !OLLAMA_FETCH_RE.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (!OLLAMA_CALL_RE.test(line)) continue;
          const window = windowAround(lines, i, 15);
          if (!ABORT_RE.test(window)) {
            findings.push({
              severity,
              category: 'local_llm_no_timeout',
              file: path,
              line: i + 1,
              message: 'Ollama call has no AbortController signal — unbounded generation can hang the server.',
              suggestion: 'Pass signal: ac.signal from a setTimeout-driven AbortController.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOCAL_LLM_006',
    category: 'local_llm_model_not_pinned',
    severity: 'HIGH',
    description: "model: 'llama3' (no :tag) resolves to the changing 'latest' digest — behavioral drift on every Ollama update.",
    tags: ['ai', 'local-llm', 'reliability', 'reproducibility'],
    sinceVersion: '2.4.0',
    explain: {
      why: "When Ollama resolves 'llama3' it fetches the latest available digest for that model family. Updates can silently change response format, token limits, and behavior — pinning to 'llama3:8b-instruct-q4_0' ensures reproducibility.",
      commonViolations: ["model: 'llama3'", "model: 'mistral'", "model: 'gemma'"],
      goodExample: "model: 'llama3:8b-instruct-q4_0'",
      badExample: "model: 'llama3'  // resolves to changing latest — behavioral drift",
      relatedPlaybooks: ['ai-governance.md'],
      relatedAgents: ['aether-ai-strategy-agent'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_llm_model_not_pinned', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        const isSource = SOURCE_EXT.test(path) || PY_EXT.test(path);
        if (!isSource || isTestPath(path)) continue;
        if (!hasLocalLlmCall(content) && !PY_OLLAMA_RE.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          const m = UNPINNED_MODEL_RE.exec(line);
          if (m) {
            findings.push({
              severity,
              category: 'local_llm_model_not_pinned',
              file: path,
              line: i + 1,
              message: `Model '${m[1]}' has no version tag — resolves to the changing 'latest' digest.`,
              suggestion: `Pin the model to a specific tag, e.g. '${m[1]}:7b-instruct-q4_0'.`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOCAL_LLM_007',
    category: 'local_llm_no_rate_limit',
    severity: 'HIGH',
    description: 'API route calling Ollama with no rate limiting — VRAM DoS via parallel generation requests.',
    tags: ['ai', 'local-llm', 'security', 'dos'],
    sinceVersion: '2.4.0',
    explain: {
      why: 'Each Ollama request holds VRAM for the duration of generation. Without rate limiting, a single attacker can saturate GPU memory with parallel requests, causing OOM and crashing the server for all users.',
      commonViolations: ['export async function POST(req) { const res = await ollama.generate(...); }'],
      goodExample: 'import rateLimit from "express-rate-limit";\napp.use("/api/llm", rateLimit({ windowMs: 60_000, max: 10 }));',
      badExample: '// No rate limiter — each request holds VRAM for 30s, easy DoS',
      relatedPlaybooks: ['ai-governance.md'],
      relatedAgents: ['argus-security-agent'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_llm_no_rate_limit', config.severityRules);
      const API_ROUTE_RE = /\/(api|route|handler)s?\/|route\.(ts|js)$|\/(pages|app)\/api\//;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!API_ROUTE_RE.test(path)) continue;
        if (!OLLAMA_CALL_RE.test(content) && !OLLAMA_FETCH_RE.test(content) && !LOCAL_BASE_URL_RE.test(content)) continue;
        if (!RATE_LIMIT_RE.test(content)) {
          findings.push({
            severity,
            category: 'local_llm_no_rate_limit',
            file: path,
            message: 'API route calls local LLM without rate limiting — concurrent requests exhaust VRAM.',
            suggestion: 'Apply a per-IP rate limiter (e.g. express-rate-limit or next-rate-limit) before the Ollama call.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'LOCAL_LLM_008',
    category: 'local_llm_pii_to_remote',
    severity: 'HIGH',
    description: 'OLLAMA_HOST points to a non-localhost address — data assumed "local" is actually sent to a remote server.',
    tags: ['ai', 'local-llm', 'privacy', 'gdpr'],
    sinceVersion: '2.4.0',
    explain: {
      why: 'Developers write local-first code without PII controls because they assume data never leaves the machine. When OLLAMA_HOST is set to a remote address (e.g. a team GPU server), GDPR/CCPA obligations apply and DPAs may be required.',
      commonViolations: ['OLLAMA_HOST=http://192.168.1.50:11434', 'OLLAMA_HOST=https://gpu.internal.company.com'],
      goodExample: '# Keep empty or set to localhost:\nOLLAMA_HOST=127.0.0.1:11434\n# If remote: document PII handling and add a DPA reference in .thesmos/config.json',
      badExample: 'OLLAMA_HOST=http://192.168.1.50:11434  # silently remote — GDPR applies',
      relatedPlaybooks: ['data-handling.md'],
      relatedAgents: ['nemesis-compliance-agent'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_llm_pii_to_remote', config.severityRules);
      const REMOTE_HOST_RE = /^OLLAMA_HOST\s*=\s*https?:\/\/(?!localhost|127\.0\.0\.1)/m;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!ENV_EXT.test(path)) continue;
        if (REMOTE_HOST_RE.test(content)) {
          const lines = content.split('\n');
          const lineNum = lines.findIndex((l) => /^OLLAMA_HOST\s*=\s*https?:\/\/(?!localhost|127\.0\.0\.1)/.test(l)) + 1;
          findings.push({
            severity,
            category: 'local_llm_pii_to_remote',
            file: path,
            line: lineNum || undefined,
            message: 'OLLAMA_HOST points to a remote server — data sent here may be PII-regulated (GDPR/CCPA).',
            suggestion: 'Document the remote endpoint and add a DPA/privacy reference in .thesmos/config.json if PII is processed.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'LOCAL_LLM_009',
    category: 'local_llm_no_content_filter',
    severity: 'HIGH',
    description: 'Ollama response returned to users with no content moderation check — no built-in safety filter.',
    tags: ['ai', 'local-llm', 'safety', 'content-moderation'],
    sinceVersion: '2.4.0',
    explain: {
      why: 'Unlike OpenAI or Anthropic, local models have no moderation layer. Many open-weight models will produce harmful, biased, or illegal content when prompted. Apps that display Ollama output directly to users need a content check.',
      commonViolations: ['const response = await ollama.generate({ ... });\nreturn NextResponse.json({ text: response.response });'],
      goodExample: 'const raw = await ollama.generate({ ... });\nconst safe = await moderateContent(raw.response);\nif (!safe.ok) return NextResponse.json({ error: "Content blocked" }, { status: 400 });',
      badExample: 'return Response.json({ text: result.response });  // no moderation',
      relatedPlaybooks: ['ai-governance.md'],
      relatedAgents: ['dike-ethics-agent'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_llm_no_content_filter', config.severityRules);
      const MODERATE_RE = /moderate|moderat|contentFilter|content_filter|safetyCheck|safety_check|profanity|nsfw/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!OLLAMA_CALL_RE.test(content) && !OLLAMA_FETCH_RE.test(content)) continue;
        // Only flag API routes that return data to users
        const isRoute = /\/(api|route)s?\/|route\.(ts|js)$|\/pages\/api\//.test(path);
        if (!isRoute) continue;
        if (!MODERATE_RE.test(content)) {
          findings.push({
            severity,
            category: 'local_llm_no_content_filter',
            file: path,
            message: 'API route returns Ollama output without content moderation — local models have no built-in safety layer.',
            suggestion: 'Add a content moderation check before returning LLM output to users.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'LOCAL_LLM_010',
    category: 'local_llm_response_unvalidated',
    severity: 'HIGH',
    description: 'Ollama JSON response used in structured logic without schema validation — crashes when model format drifts.',
    tags: ['ai', 'local-llm', 'reliability', 'validation'],
    sinceVersion: '2.4.0',
    explain: {
      why: 'Local models frequently return malformed JSON, trailing commas, or missing fields — especially after model updates. Using the response in structured logic without schema validation causes silent crashes and data corruption.',
      commonViolations: ['const data = JSON.parse(result.response);\ndb.insert(data.title, data.price);'],
      goodExample: 'const schema = z.object({ title: z.string(), price: z.number().positive() });\nconst data = schema.safeParse(JSON.parse(result.response));\nif (!data.success) throw new Error("Model output invalid");',
      badExample: 'const parsed = JSON.parse(ollamaResult.response);\nawait db.create(parsed);  // no validation — any field can be missing',
      relatedPlaybooks: ['ai-governance.md'],
      relatedAgents: ['cassandra-qa-agent'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_llm_response_unvalidated', config.severityRules);
      const JSON_PARSE_RE = /JSON\.parse\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!OLLAMA_CALL_RE.test(content) && !OLLAMA_FETCH_RE.test(content)) continue;
        if (!JSON_PARSE_RE.test(content)) continue;
        if (!SCHEMA_VALIDATE_RE.test(content)) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (isCommentLine(line)) continue;
            if (JSON_PARSE_RE.test(line)) {
              findings.push({
                severity,
                category: 'local_llm_response_unvalidated',
                file: path,
                line: i + 1,
                message: 'JSON.parse on Ollama output without schema validation — model format drift causes silent crashes.',
                suggestion: 'Wrap with zod safeParse or similar schema validator before using the parsed result.',
              });
              break; // one finding per file is enough
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOCAL_LLM_011',
    category: 'local_llm_no_context_limit',
    severity: 'MEDIUM',
    description: 'No num_predict or num_ctx limit — unbounded generation exhausts VRAM and causes OOM crashes.',
    tags: ['ai', 'local-llm', 'performance', 'reliability'],
    sinceVersion: '2.4.0',
    explain: {
      why: "Ollama's default context window and generation length are model-dependent and sometimes very large. Without explicit limits, a single long-running request can exhaust all available VRAM, causing OOM errors that kill the server process.",
      commonViolations: ['ollama.generate({ model, prompt })  // no num_predict'],
      goodExample: 'ollama.generate({ model, prompt, options: { num_predict: 512, num_ctx: 2048 } })',
      badExample: 'ollama.generate({ model, prompt });  // unbounded — can run for minutes and exhaust VRAM',
      relatedPlaybooks: ['ai-governance.md'],
      relatedAgents: ['chiron-architecture-agent'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_llm_no_context_limit', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!OLLAMA_CALL_RE.test(content)) continue;
        if (CTX_LIMIT_RE.test(content)) continue; // limit present in file
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (OLLAMA_CALL_RE.test(line)) {
            findings.push({
              severity,
              category: 'local_llm_no_context_limit',
              file: path,
              line: i + 1,
              message: 'Ollama call has no num_predict/num_ctx limit — unbounded generation can exhaust VRAM.',
              suggestion: "Add options: { num_predict: 512, num_ctx: 2048 } to cap generation length.",
            });
            break;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOCAL_LLM_012',
    category: 'local_llm_streaming_no_error',
    severity: 'MEDIUM',
    description: 'Streaming Ollama call (stream: true) without try/catch — network drops and model OOM are not handled.',
    tags: ['ai', 'local-llm', 'reliability', 'error-handling'],
    sinceVersion: '2.4.0',
    explain: {
      why: 'Streaming local LLM output is a long-lived connection. Network interruptions, model crashes, or VRAM exhaustion during generation throw errors that are invisible unless explicitly caught. Unhandled streaming errors crash the response handler.',
      commonViolations: ['const stream = await ollama.generate({ model, prompt, stream: true });\nfor await (const chunk of stream) { ... }'],
      goodExample: 'try {\n  const stream = await ollama.generate({ model, prompt, stream: true, signal: ac.signal });\n  for await (const chunk of stream) { ... }\n} catch (err) {\n  logger.error("stream error", err);\n  return Response.json({ error: "Generation failed" }, { status: 500 });\n}',
      badExample: 'const stream = await ollama.generate({ model, prompt, stream: true });\nfor await (const chunk of stream) { write(chunk); }  // no error handling',
      relatedPlaybooks: ['ai-governance.md'],
      relatedAgents: ['chiron-architecture-agent'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_llm_streaming_no_error', config.severityRules);
      const TRY_CATCH_RE = /\btry\s*\{/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!OLLAMA_CALL_RE.test(content)) continue;
        if (!STREAM_RE.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (STREAM_RE.test(line) && OLLAMA_CALL_RE.test(windowAround(lines, i, 5))) {
            const window = windowAround(lines, i, 10);
            if (!TRY_CATCH_RE.test(window)) {
              findings.push({
                severity,
                category: 'local_llm_streaming_no_error',
                file: path,
                line: i + 1,
                message: 'Ollama stream: true without try/catch — generation errors crash the response handler.',
                suggestion: 'Wrap the streaming Ollama call in try/catch and return a 500 response on error.',
              });
              break;
            }
          }
        }
      }
      return findings;
    },
  },
];
