/**
 * AI / LLM governance rules — the category that makes Prometheus unique.
 *
 * These rules specifically target the patterns that emerge when AI coding
 * assistants help write AI-powered features: prompt injection, key leakage,
 * missing guardrails, and cost-risk patterns that no other linter catches.
 */
import type { PrometheusRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, JSX_EXT, isTestPath, isCommentLine } from './helpers';

export const AI_RULES: PrometheusRule[] = [
  {
    id: 'AI_001',
    category: 'ai_key_in_client',
    description: 'LLM API keys (OpenAI, Anthropic, Gemini, etc.) must never be loaded in Client Components or browser-visible code.',
    severity: 'BLOCKER',
    tags: ['security', 'ai', 'credentials'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'API keys in client-side code are trivially extractable from the network tab, source maps, or JS bundle. Anyone who finds your key can bill millions to your account or access your AI-generated content.',
      commonViolations: ["'use client'; const openai = new OpenAI({ apiKey: process.env.NEXT_PUBLIC_OPENAI_KEY })", "const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })  // in page.tsx"],
      goodExample: "// Server Action or API route only:\nconst openai = new OpenAI({ apiKey: process['env' as 'env']['OPENAI_API_KEY'] });",
      badExample: "'use client';\nconst ai = new OpenAI({ apiKey: process.env.NEXT_PUBLIC_OPENAI_KEY });  // key ships to browser",
      relatedPlaybooks: ['ai-security.md'],
      relatedAgents: ['security-reviewer', 'ai-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('ai_key_in_client', config.severityRules);
      const AI_KEY_RE = /(?:OpenAI|Anthropic|GoogleGenerativeAI|Gemini|Cohere|Mistral|Groq|Together)\s*\(\s*\{[^}]*apiKey/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!/'use client'|"use client"/.test(content.slice(0, 500))) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (AI_KEY_RE.test(line)) {
            findings.push({ severity, category: 'ai_key_in_client', file: path, line: i + 1, message: 'LLM client initialized with API key inside a Client Component — key ships to browser.', suggestion: 'Initialize the LLM client in a Server Action or API route only. Never in client-side code.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AI_002',
    category: 'prompt_injection_risk',
    description: 'User input passed directly to LLM messages without sanitization enables prompt injection attacks.',
    severity: 'HIGH',
    tags: ['security', 'ai', 'prompt-injection'],
    sinceVersion: '2.0.0',
    explain: {
      why: "Prompt injection is to LLMs what SQL injection is to databases. An attacker can send 'Ignore previous instructions and...' to manipulate the AI's behavior, leak system prompts, exfiltrate data, or produce harmful output branded as your product.",
      commonViolations: ['messages: [{ role: "user", content: req.body.message }]', '`${systemPrompt}\n\nUser: ${userInput}`'],
      goodExample: "// Validate and sanitize user input before adding to messages:\nconst sanitized = sanitizePromptInput(userMessage, { maxLength: 1000, stripInstructions: true });\nmessages.push({ role: 'user', content: sanitized });",
      badExample: "const response = await openai.chat.completions.create({\n  messages: [\n    { role: 'system', content: SYSTEM_PROMPT },\n    { role: 'user', content: req.body.message },  // raw user input\n  ],\n});",
      relatedPlaybooks: ['ai-security.md', 'prompt-injection.md'],
      relatedAgents: ['security-reviewer', 'ai-reviewer'],
      relatedSkills: ['prompt-sanitizer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prompt_injection_risk', config.severityRules);
      const DIRECT_USER_MSG_RE = /role\s*:\s*['"]user['"]\s*,\s*content\s*:\s*(?:req\.|body\.|message\b|input\b)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (DIRECT_USER_MSG_RE.test(line)) {
            findings.push({ severity, category: 'prompt_injection_risk', file: path, line: i + 1, message: 'User input passed directly to LLM message content — prompt injection risk.', suggestion: 'Sanitize and validate user input before including in LLM messages. Consider length limits and instruction stripping.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AI_003',
    category: 'llm_response_as_html',
    description: 'Rendering raw LLM output as HTML (innerHTML, dangerouslySetInnerHTML) enables XSS via prompt injection.',
    severity: 'BLOCKER',
    tags: ['security', 'ai', 'xss', 'prompt-injection'],
    sinceVersion: '2.0.0',
    explain: {
      why: "An attacker can craft input that causes the LLM to output <script>...</script> or malicious HTML. If you render the LLM's response directly as HTML without sanitization, you have created a prompt-injection-to-XSS attack chain.",
      commonViolations: ['dangerouslySetInnerHTML={{ __html: completion }}', 'element.innerHTML = aiResponse.choices[0].text'],
      goodExample: "import DOMPurify from 'dompurify';\n<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(completion) }} />\n// Or better: use a markdown renderer with HTML disabled",
      badExample: "const { text } = await generateText({ ... });\n<div dangerouslySetInnerHTML={{ __html: text }} />  // XSS via prompt injection",
      relatedPlaybooks: ['ai-security.md', 'xss-prevention.md'],
      relatedAgents: ['security-reviewer', 'ai-reviewer'],
      relatedSkills: ['sanitize-html-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('llm_response_as_html', config.severityRules);
      const LLM_VAR_RE = /\b(?:completion|aiResponse|llmOutput|generatedText|response\.text|choices\[0\]|message\.content)\b/;
      const HTML_INJECT_RE = /(?:dangerouslySetInnerHTML|\.innerHTML\s*=)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!HTML_INJECT_RE.test(content) || !LLM_VAR_RE.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (HTML_INJECT_RE.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 5), i + 3).join('\n');
            if (LLM_VAR_RE.test(ctx) && !(/DOMPurify|sanitize/.test(ctx))) {
              findings.push({ severity, category: 'llm_response_as_html', file: path, line: i + 1, message: 'LLM output rendered as HTML without sanitization — XSS via prompt injection.', suggestion: 'Sanitize with DOMPurify.sanitize() or use a markdown renderer with HTML escaping.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AI_004',
    category: 'llm_no_max_tokens',
    description: 'LLM API calls without max_tokens/maxTokens limits expose you to runaway costs from large completions.',
    severity: 'MEDIUM',
    tags: ['ai', 'cost', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Without max_tokens, an LLM can generate thousands of tokens per request. A traffic spike, a crafted prompt, or a model change can multiply your AI costs by 100x overnight. Always set an explicit upper bound.',
      commonViolations: ['openai.chat.completions.create({ model, messages })', 'anthropic.messages.create({ model, messages })'],
      goodExample: "openai.chat.completions.create({\n  model: 'gpt-4o',\n  messages,\n  max_tokens: 1000,  // explicit upper bound\n});",
      badExample: "const res = await openai.chat.completions.create({\n  model: 'gpt-4o',\n  messages,\n  // no max_tokens — potential runaway cost\n});",
      relatedPlaybooks: ['ai-cost-control.md'],
      relatedAgents: ['ai-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('llm_no_max_tokens', config.severityRules);
      const LLM_CREATE_RE = /(?:chat\.completions\.create|messages\.create|generateText|streamText|generateObject)\s*\(\s*\{/;
      const MAX_TOKENS_RE = /max_tokens|maxTokens|maxOutputTokens/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (LLM_CREATE_RE.test(line)) {
            const block = lines.slice(i, Math.min(i + 15, lines.length)).join('\n');
            if (!MAX_TOKENS_RE.test(block)) {
              findings.push({ severity, category: 'llm_no_max_tokens', file: path, line: i + 1, message: 'LLM API call without max_tokens limit — runaway cost risk.', suggestion: 'Add max_tokens: N to cap completion size and protect against cost spikes.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AI_005',
    category: 'llm_no_timeout',
    description: 'LLM API calls without a timeout or AbortController signal can hang indefinitely on model overload.',
    severity: 'MEDIUM',
    tags: ['ai', 'reliability', 'performance'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'LLM APIs can take 30-60+ seconds under load. Without a timeout, a single slow request holds the connection open until Node.js or the reverse proxy times out — causing cascading failure or request queue buildup.',
      commonViolations: ['await openai.chat.completions.create({ ... })', 'await anthropic.messages.create({ ... })'],
      goodExample: "const controller = new AbortController();\nconst timeout = setTimeout(() => controller.abort(), 30_000);\ntry {\n  const res = await openai.chat.completions.create({ ... }, { signal: controller.signal });\n} finally {\n  clearTimeout(timeout);\n}",
      badExample: "// No timeout — request can hang for 60+ seconds\nconst res = await openai.chat.completions.create({ model, messages });",
      relatedPlaybooks: ['ai-reliability.md'],
      relatedAgents: ['ai-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('llm_no_timeout', config.severityRules);
      const LLM_AWAIT_RE = /await\s+(?:openai|anthropic|client|ai|gemini|groq|mistral|cohere)\s*\.\s*(?:chat\.completions\.create|messages\.create|generateText|streamText)/;
      const TIMEOUT_RE = /AbortController|AbortSignal|timeout\s*:|signal\s*:|timeoutMs/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (LLM_AWAIT_RE.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 5), Math.min(i + 10, lines.length)).join('\n');
            if (!TIMEOUT_RE.test(ctx)) {
              findings.push({ severity, category: 'llm_no_timeout', file: path, line: i + 1, message: 'LLM API call without timeout or AbortController signal.', suggestion: 'Add an AbortController with setTimeout to cancel requests that exceed your SLA.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AI_006',
    category: 'ai_no_rate_limit',
    description: 'AI-powered endpoints without rate limiting expose you to cost amplification attacks.',
    severity: 'HIGH',
    tags: ['security', 'ai', 'cost', 'rate-limiting'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Each LLM request costs money. An attacker (or a bug) that sends thousands of requests per minute can generate thousands of dollars in API costs in minutes. Rate limiting is the last line of defense against cost amplification.',
      commonViolations: ['POST /api/chat without rate limiting middleware', 'POST /api/generate with no throttle'],
      goodExample: "import { Ratelimit } from '@upstash/ratelimit';\nconst limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '1 m') });\nconst { success } = await limiter.limit(userId);\nif (!success) return new Response('Too many requests', { status: 429 });",
      badExample: "// POST /api/chat — no rate limiting\nexport async function POST(req: Request) {\n  const completion = await openai.chat.completions.create({ ... });\n  return Response.json(completion);\n}",
      relatedPlaybooks: ['ai-cost-control.md', 'rate-limiting.md'],
      relatedAgents: ['security-reviewer', 'ai-reviewer'],
      relatedSkills: ['rate-limit-helper'],
    },
    detect({ config, scan }: DetectInput): Finding[] {
      const severity = classifySeverity('ai_no_rate_limit', config.severityRules);
      const AI_PATH_RE = /\/(?:api\/)?(?:chat|generate|ai|llm|completion|embed|transcribe)/i;
      const findings: Finding[] = [];
      for (const route of scan.apiRoutes) {
        if (AI_PATH_RE.test(route.path) && route.methods.includes('POST')) {
          findings.push({ severity, category: 'ai_no_rate_limit', file: route.file ?? route.path, message: `AI endpoint ${route.path} has no visible rate limiting.`, suggestion: 'Add per-user rate limiting with Upstash Ratelimit or similar before the LLM call.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'AI_007',
    category: 'pii_to_external_llm',
    description: 'Sending PII (emails, names, SSNs, phone numbers) to external LLM APIs violates data privacy obligations.',
    severity: 'HIGH',
    tags: ['security', 'ai', 'privacy', 'gdpr'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'External LLM providers may log, train on, or retain your prompts. Including user PII (email, full name, financial data) in prompts may violate GDPR, CCPA, HIPAA, or your privacy policy.',
      commonViolations: ['prompt with user.email included', 'messages containing full customer records'],
      goodExample: "// Anonymize or pseudonymize before sending:\nconst prompt = `Analyze this: ${maskPII(userContent)}`;\n// Or: use a private/on-prem model for PII-sensitive operations",
      badExample: "const prompt = `Send a summary to ${user.email} about their purchase of ${order.items}`;",
      relatedPlaybooks: ['privacy-data-handling.md', 'ai-security.md'],
      relatedAgents: ['security-reviewer', 'ai-reviewer'],
      relatedSkills: ['pii-masker'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('pii_to_external_llm', config.severityRules);
      const PII_IN_PROMPT_RE = /(?:user\.email|user\.phone|user\.ssn|customer\.email|profile\.email)\s*(?:\}|,|\`)/;
      const LLM_CONTEXT_RE = /(?:messages|prompt|content|text)\s*[=:]/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!LLM_CONTEXT_RE.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (PII_IN_PROMPT_RE.test(line) && LLM_CONTEXT_RE.test(line)) {
            findings.push({ severity, category: 'pii_to_external_llm', file: path, line: i + 1, message: 'PII field included in LLM prompt — potential GDPR/privacy violation.', suggestion: 'Anonymize or pseudonymize PII before sending to external AI APIs.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AI_008',
    category: 'streaming_no_error_handler',
    description: 'LLM streaming responses without error handling leave partial streams unresolved on network errors.',
    severity: 'MEDIUM',
    tags: ['ai', 'reliability', 'error-handling'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Network interruptions, model overloads, and content policy violations can terminate a stream mid-flight. Without error handling, the client receives a partial response with no indication of failure, corrupting the UX.',
      commonViolations: ['for await (const chunk of stream) { yield chunk; }  // no try-catch'],
      goodExample: "try {\n  for await (const chunk of stream) {\n    controller.enqueue(encoder.encode(chunk.choices[0]?.delta.content ?? ''));\n  }\n} catch (err) {\n  controller.error(err);\n} finally {\n  controller.close();\n}",
      badExample: "for await (const chunk of stream) {\n  yield chunk;  // partial output if stream errors mid-way\n}",
      relatedPlaybooks: ['ai-reliability.md'],
      relatedAgents: ['ai-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('streaming_no_error_handler', config.severityRules);
      const STREAM_RE = /for\s+await\s*\(\s*const\s+\w+\s+of\s+stream\b/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (STREAM_RE.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 3), Math.min(i + 10, lines.length)).join('\n');
            if (!/try\s*\{/.test(ctx)) {
              findings.push({ severity, category: 'streaming_no_error_handler', file: path, line: i + 1, message: 'LLM stream iteration without try-catch.', suggestion: 'Wrap the for-await loop in try-catch and call controller.error(err) or send an error event to the client.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AI_009',
    category: 'llm_json_parse_unsafe',
    description: 'JSON.parse on LLM completion output without try-catch will crash when the model returns non-JSON text.',
    severity: 'HIGH',
    tags: ['ai', 'reliability', 'error-handling'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'LLMs are probabilistic — even with a JSON prompt, they occasionally return malformed JSON, extra explanation text, or truncated output. JSON.parse throws on all of these, crashing the request handler.',
      commonViolations: ['JSON.parse(completion.choices[0].message.content)', 'JSON.parse(response.content[0].text)'],
      goodExample: "let parsed;\ntry {\n  parsed = JSON.parse(completion.choices[0].message.content ?? '');\n} catch {\n  // Retry with a stronger prompt or return a fallback\n  return { error: 'Model returned invalid JSON' };\n}",
      badExample: "const data = JSON.parse(completion.choices[0].message.content);  // crashes on malformed output",
      relatedPlaybooks: ['ai-reliability.md'],
      relatedAgents: ['ai-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('llm_json_parse_unsafe', config.severityRules);
      const JSON_LLM_RE = /JSON\.parse\s*\(\s*(?:completion|response|result|message|content|output)\b/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (JSON_LLM_RE.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 3), Math.min(i + 3, lines.length)).join('\n');
            if (!/try\s*\{|\.catch\(|safeParse/.test(ctx)) {
              findings.push({ severity, category: 'llm_json_parse_unsafe', file: path, line: i + 1, message: 'JSON.parse on LLM output without error handling.', suggestion: 'Wrap in try-catch. Consider using the AI SDK structured output feature (generateObject) to guarantee valid JSON.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AI_010',
    category: 'ai_tool_no_validation',
    description: 'AI tool/function call arguments must be validated with a schema before use — the model can hallucinate invalid args.',
    severity: 'HIGH',
    tags: ['security', 'ai', 'input-validation'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'LLMs can call tools with hallucinated, malformed, or adversarially crafted arguments. Treating tool arguments as trusted input is equivalent to trusting user input — validate with Zod or a JSON schema before executing.',
      commonViolations: ['const { userId } = toolCall.args  // unvalidated model output', 'await dbAction(functionCall.arguments.id)'],
      goodExample: "const ArgsSchema = z.object({ userId: z.string().uuid(), action: z.enum(['read', 'delete']) });\nconst args = ArgsSchema.parse(toolCall.args);  // throws if model hallucinated",
      badExample: "const { userId, action } = toolCall.args;\nawait performAction(userId, action);  // model could hallucinate userId='../../etc/passwd'",
      relatedPlaybooks: ['ai-security.md'],
      relatedAgents: ['security-reviewer', 'ai-reviewer'],
      relatedSkills: ['zod-schema-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('ai_tool_no_validation', config.severityRules);
      const TOOL_ARGS_RE = /(?:toolCall|tool_call|functionCall|function_call)\.(?:args|arguments)\b/;
      const VALIDATE_RE = /\.parse\s*\(|\.safeParse\s*\(|validate\s*\(|schema\./;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (TOOL_ARGS_RE.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 3), Math.min(i + 3, lines.length)).join('\n');
            if (!VALIDATE_RE.test(ctx)) {
              findings.push({ severity, category: 'ai_tool_no_validation', file: path, line: i + 1, message: 'AI tool arguments used without schema validation.', suggestion: 'Parse tool args with a Zod schema before use: const args = ArgsSchema.parse(toolCall.args).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AI_011',
    category: 'system_prompt_hardcoded',
    description: 'System prompts hardcoded in source files are hard to update, version, and audit.',
    severity: 'LOW',
    tags: ['ai', 'maintainability', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Hardcoded system prompts make A/B testing, prompt versioning, and security audits difficult. They also bloat source files and get committed alongside code, making prompt history hard to track separately from code history.',
      commonViolations: ['const SYSTEM_PROMPT = "You are a helpful assistant..."  // 200 lines'],
      goodExample: "// Load from prompt template file or config:\nconst systemPrompt = await loadPromptTemplate('assistant-v2');\n// Or: from environment config\nconst systemPrompt = process['env' as 'env']['ASSISTANT_SYSTEM_PROMPT'];",
      badExample: "const SYSTEM = `You are an expert assistant for Acme Corp.\nYou have access to... [300 lines of hardcoded prompt]`;",
      relatedPlaybooks: ['ai-prompt-management.md'],
      relatedAgents: ['ai-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('system_prompt_hardcoded', config.severityRules);
      const LARGE_PROMPT_RE = /(?:SYSTEM_PROMPT|systemPrompt|system_prompt)\s*=\s*`[^`]{200,}`/s;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (LARGE_PROMPT_RE.test(content)) {
          findings.push({ severity, category: 'system_prompt_hardcoded', file: path, message: 'Large system prompt hardcoded in source — extract to a prompt template file.', suggestion: 'Move system prompts to a .md or .txt template file and load at runtime.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'AI_012',
    category: 'ai_feature_no_fallback',
    description: 'AI-powered features without a fallback degrade entirely when the LLM API is unavailable.',
    severity: 'MEDIUM',
    tags: ['ai', 'reliability', 'resilience'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'LLM APIs have outages, rate limits, and latency spikes. A feature that only works when AI is available is fragile. Design AI as an enhancement to a working baseline, not as a hard dependency.',
      commonViolations: ['async function generateSummary() { const r = await ai.generate(...); return r.text }  // no fallback'],
      goodExample: "async function getSummary(content: string): Promise<string> {\n  try {\n    return await ai.generateSummary(content);\n  } catch {\n    return content.slice(0, 200) + '...';  // graceful degradation\n  }\n}",
      badExample: "async function getAIReply(msg: string) {\n  const reply = await openai.chat.completions.create({ ... });\n  return reply.choices[0].message.content;  // throws if API down\n}",
      relatedPlaybooks: ['ai-reliability.md'],
      relatedAgents: ['ai-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('ai_feature_no_fallback', config.severityRules);
      const LLM_CALL_RE = /\bawait\s+(?:openai|anthropic|ai|gemini|groq|client)\s*\.\s*(?:chat\.completions\.create|messages\.create|generate\w*)\s*\(/;
      const FALLBACK_RE = /catch|fallback|default|\.catch\(|try\s*\{/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!LLM_CALL_RE.test(content)) continue;
        if (!FALLBACK_RE.test(content)) {
          findings.push({ severity, category: 'ai_feature_no_fallback', file: path, message: 'AI API call with no catch block or fallback — entire feature fails when LLM is unavailable.', suggestion: 'Add try-catch and return a sensible fallback when the LLM API is unavailable.' });
        }
      }
      return findings;
    },
  },
];
