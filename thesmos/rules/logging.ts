// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, isTestPath, isCommentLine } from './helpers';

export const LOG_RULES: ThesmosRule[] = [
  {
    id: 'LOG_001',
    category: 'console_log_production',
    description: 'console.log() in production code leaks implementation details and degrades performance.',
    severity: 'MEDIUM',
    tags: ['logging', 'quality', 'production'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'console.log() is synchronous and serializes objects at call time, costing CPU even when DevTools is closed. In production builds, use a structured logger with log levels that can be disabled.',
      commonViolations: ['console.log("User logged in:", user)', 'console.log("API response:", data)'],
      goodExample: "import { logger } from '@/lib/logger'\nlogger.info({ userId: user.id }, 'User logged in')",
      badExample: "console.log('API response:', JSON.stringify(data))  // synchronous, serializes full object",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('console_log_production', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/console\.(log|debug|info)\s*\(/.test(line)) {
            findings.push({ severity, category: 'console_log_production', file: path, line: i + 1, message: 'console.log/debug/info in production code — use a structured logger with log levels.', suggestion: "Replace with logger.info({...context}, 'message') using pino, winston, or similar." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_002',
    category: 'pii_in_logs',
    description: 'Logging personally identifiable information (PII) violates GDPR/CCPA and creates security exposure.',
    severity: 'BLOCKER',
    tags: ['logging', 'security', 'privacy', 'compliance'],
    sinceVersion: '3.0.0',
    explain: {
      why: "GDPR Article 5 requires data minimization. Logging email, name, SSN, or credit card numbers in log files exposes them to anyone with log access. Log IDs and derived values instead.",
      commonViolations: ["logger.info({ email: user.email, name: user.name }, 'User action')", "console.log('Payment:', card.number)"],
      goodExample: "logger.info({ userId: user.id, action: 'login' }, 'User authenticated')  // ID only, not PII",
      badExample: "logger.info({ user }, 'User login')  // logs full user object including email/name/phone",
      relatedPlaybooks: ['security.md', 'observability.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('pii_in_logs', config.severityRules);
      const findings: Finding[] = [];
      const PII_PATTERNS = /(?:email|phone|ssn|creditCard|credit_card|cardNumber|card_number|firstName|first_name|lastName|last_name|dateOfBirth|date_of_birth|address|passport)\s*:/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:console\.|logger\.|log\.)(?:log|info|warn|error|debug)\s*\(/.test(line) && PII_PATTERNS.test(line)) {
            findings.push({ severity, category: 'pii_in_logs', file: path, line: i + 1, message: 'Potential PII (email/phone/card/name) logged — GDPR/CCPA violation risk.', suggestion: 'Log only identifiers (userId, orderId). Scrub PII before logging or use a log masking library.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_003',
    category: 'secret_in_logs',
    description: 'Logging API keys, tokens, or passwords exposes secrets to anyone with log access.',
    severity: 'BLOCKER',
    tags: ['logging', 'security', 'secrets'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Logs are often forwarded to centralized systems (Datadog, Splunk) with broad access. A token or API key in logs is effectively public within the organization and may be indexed by log aggregators for months.",
      commonViolations: ["console.log('Auth header:', req.headers.authorization)", "logger.debug({ apiKey }, 'Using key')"],
      goodExample: "logger.debug({ keyHint: apiKey.slice(-4) }, 'Using API key')  // only last 4 chars",
      badExample: "logger.info({ headers: req.headers }, 'Incoming request')  // includes Authorization header",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('secret_in_logs', config.severityRules);
      const findings: Finding[] = [];
      const SECRET_PATTERNS = /(?:password|token|secret|apiKey|api_key|authorization|bearer|jwt|privateKey|private_key)\s*[,:]/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:console\.|logger\.|log\.)(?:log|info|warn|error|debug)\s*\(/.test(line) && SECRET_PATTERNS.test(line)) {
            findings.push({ severity, category: 'secret_in_logs', file: path, line: i + 1, message: 'Secret or credential may be written to logs — exposure risk.', suggestion: 'Never log passwords, tokens, or keys. Log only the last 4 chars of a key for debugging identity.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_004',
    category: 'log_level_mismatch',
    description: 'Logging errors with logger.info() or warnings with logger.debug() makes alert routing and filtering unreliable.',
    severity: 'MEDIUM',
    tags: ['logging', 'observability', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Monitoring systems route alerts by log level. An error logged as logger.info won't trigger on-call alerts. A debug message logged as logger.error creates alert fatigue. Match severity to the log level.",
      commonViolations: ["logger.info({ err }, 'Database connection failed')  // error logged at info level"],
      goodExample: "logger.error({ err, query }, 'Database query failed')\nlogger.warn({ retryCount }, 'Retrying after transient failure')",
      badExample: "try { ... } catch(err) { logger.debug({ err }, 'Failed to save')  // debug won't trigger alerts }",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_level_mismatch', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:logger|log)\.(info|debug)\s*\(\s*\{[^}]*\berr\b/.test(line)) {
            findings.push({ severity, category: 'log_level_mismatch', file: path, line: i + 1, message: "Error object logged at info/debug level — monitoring systems won't trigger alerts.", suggestion: "Log errors at logger.error() or logger.warn() level to enable correct alerting." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_005',
    category: 'unstructured_log_message',
    description: "String interpolation in log messages (logger.info(`User ${id} failed`)) prevents machine parsing and log indexing.",
    severity: 'LOW',
    tags: ['logging', 'observability', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Log aggregators (Datadog, Splunk) index structured fields as separate dimensions. logger.info({ userId: id }, 'User auth failed') lets you filter by userId. logger.info(`User ${id} failed`) buries the value in an unindexed string.",
      commonViolations: ["logger.info(`Order ${orderId} placed by ${userId}`)", "console.log('Request failed: ' + error.message)"],
      goodExample: "logger.info({ orderId, userId }, 'Order placed')  // indexed, searchable fields",
      badExample: "logger.info(`Order ${orderId} placed by user ${userId}`)  // unindexed, unsearchable",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('unstructured_log_message', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:logger|log)\.\w+\s*\(`[^`]*\$\{/.test(line)) {
            findings.push({ severity, category: 'unstructured_log_message', file: path, line: i + 1, message: 'Template literal in log message — use structured object fields for indexable logs.', suggestion: "Use logger.info({ userId, orderId }, 'Event description') instead of template literals." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_006',
    category: 'log_without_context',
    description: "Log messages without contextual identifiers (requestId, userId, traceId) are impossible to correlate across services.",
    severity: 'MEDIUM',
    tags: ['logging', 'observability', 'tracing'],
    sinceVersion: '3.0.0',
    explain: {
      why: "In distributed systems, 'Payment failed' logged 500 times a minute is useless without requestId or userId to correlate with other services. Always include correlation IDs in log context.",
      commonViolations: ["logger.error({ err }, 'Payment failed')  // no correlating IDs"],
      goodExample: "logger.error({ err, requestId: ctx.requestId, userId: ctx.userId, orderId }, 'Payment failed')",
      badExample: "logger.warn('Retry attempt failed')  // impossible to trace across microservices",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_without_context', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:logger|log)\.(error|warn)\s*\(\s*['"`]/.test(line) && !line.includes('{')) {
            findings.push({ severity, category: 'log_without_context', file: path, line: i + 1, message: 'Error/warning log without structured context — missing requestId, userId, or traceId.', suggestion: "Add context object: logger.error({ requestId, userId, err }, 'Operation failed')." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_007',
    category: 'console_error_swallowed',
    description: "Catching errors and logging only console.error (without rethrowing or tracking) swallows the error from monitoring.",
    severity: 'HIGH',
    tags: ['logging', 'error-handling', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "catch(err) { console.error(err) } silently swallows the error from your monitoring system. It won't appear in Sentry, PagerDuty won't alert, and the caller has no indication of failure. Either rethrow, or capture in your error tracker.",
      commonViolations: ['catch (err) { console.error(err) }  // monitoring systems never see this'],
      goodExample: "catch (err) {\n  logger.error({ err, userId }, 'Payment failed')\n  Sentry.captureException(err)\n  throw err  // let callers handle it\n}",
      badExample: "catch (err) { console.error('Something failed:', err) }  // silently swallowed",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('console_error_swallowed', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/catch\s*\(\s*\w+\s*\)\s*\{/.test(line)) {
            const block = lines.slice(i, i + 5).join('\n');
            const hasConsoleError = /console\.error/.test(block);
            const hasRethrow = /throw|Sentry|captureException|logger\.error/.test(block);
            if (hasConsoleError && !hasRethrow) {
              findings.push({ severity, category: 'console_error_swallowed', file: path, line: i + 1, message: 'Error caught and logged with console.error but not rethrown or captured — monitoring systems miss it.', suggestion: 'Either rethrow the error, call Sentry.captureException(err), or use logger.error() with proper alerting.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_008',
    category: 'log_sensitive_request_body',
    description: "Logging full request bodies may capture passwords, credit card numbers, or other sensitive POST data.",
    severity: 'BLOCKER',
    tags: ['logging', 'security', 'privacy'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A login request body contains password. A checkout body contains card data. Logging req.body wholesale puts this in log aggregators. Allowlist safe fields for logging instead.",
      commonViolations: ["logger.info({ body: req.body }, 'Incoming request')", "console.log(req.body)"],
      goodExample: "logger.info({ method: req.method, path: req.path, contentLength: req.headers['content-length'] }, 'Request')",
      badExample: "logger.debug({ body: req.body }, 'Processing request')  // captures passwords and card data",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_sensitive_request_body', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:console\.|logger\.|log\.)\w+\s*\(/.test(line) && /(?:req|request)\.body/.test(line)) {
            findings.push({ severity, category: 'log_sensitive_request_body', file: path, line: i + 1, message: 'Logging req.body may capture passwords, card numbers, or other sensitive POST data.', suggestion: 'Log only allowlisted safe fields: { method, path, userId } — never the full request body.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_009',
    category: 'log_circular_reference',
    description: "Logging complex objects with circular references throws 'Converting circular structure to JSON' errors.",
    severity: 'MEDIUM',
    tags: ['logging', 'reliability', 'node'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Express req/res objects, Mongoose documents, and many framework objects have circular references. JSON.stringify(req) throws. Use loggers that handle serialization (pino, winston) and only log safe extracted fields.",
      commonViolations: ['console.log(JSON.stringify(req))', 'logger.info({ req, res }, "request")'],
      goodExample: "logger.info({ method: req.method, url: req.url, userId: req.user?.id }, 'Request')",
      badExample: "logger.debug({ req }, 'Debugging request')  // may throw: circular structure",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_circular_reference', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/JSON\.stringify\s*\(\s*(?:req|res|request|response|err|error)\b/.test(line)) {
            findings.push({ severity, category: 'log_circular_reference', file: path, line: i + 1, message: "JSON.stringify on req/res/error objects may throw 'circular structure' error at runtime.", suggestion: 'Extract safe fields manually: { method: req.method, url: req.url } or use pino which handles this.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_010',
    category: 'log_timing_missing',
    description: 'Long-running operations (DB queries, external API calls) without duration logging make performance debugging guesswork.',
    severity: 'LOW',
    tags: ['logging', 'observability', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Knowing that a DB query 'failed' without knowing it took 30 seconds makes root cause analysis impossible. Log duration on all I/O operations to enable SLO monitoring and slow-query detection.",
      commonViolations: ["const result = await db.query(sql)  // no timing logged"],
      goodExample: "const start = Date.now()\nconst result = await db.query(sql)\nlogger.info({ durationMs: Date.now() - start, query: sql.slice(0, 100) }, 'DB query')",
      badExample: "const users = await prisma.user.findMany()  // no timing — can't detect slow queries",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_timing_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (content.includes('Date.now()') || content.includes('performance.now()') || content.includes('durationMs') || content.includes('duration_ms')) return findings;
        const EXTERNAL_IO = /await\s+(?:fetch|axios|prisma\.\w+\.\w+|db\.|redis\.|elasticsearch\.|mongo)/;
        const lines = content.split('\n');
        let ioCount = 0;
        for (const line of lines) {
          if (EXTERNAL_IO.test(line)) ioCount++;
        }
        if (ioCount >= 3) {
          findings.push({ severity, category: 'log_timing_missing', file: path, message: `File has ${ioCount} external I/O calls without timing logging — slow operations will be invisible.`, suggestion: 'Wrap I/O calls with start/end timing: const start = Date.now(); await op(); logger.info({ durationMs: Date.now() - start }, "op done").' });
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_011',
    category: 'log_in_tight_loop',
    description: 'Logging inside tight loops (forEach, map, for) generates enormous log volume and degrades performance.',
    severity: 'HIGH',
    tags: ['logging', 'performance', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A logger.info() call per item in a 10,000-item array generates 10,000 log lines per operation. This floods log aggregators, hits rate limits, incurs massive costs, and slows the loop significantly.",
      commonViolations: ["items.forEach(item => { logger.info({ item }, 'Processing') })", 'for (const row of rows) { console.log(row) }'],
      goodExample: "logger.info({ count: items.length }, 'Processing batch')\n// ... process items ...\nlogger.info({ count: results.length, failedCount: errors.length }, 'Batch complete')",
      badExample: "rows.forEach(row => {\n  logger.debug({ row }, 'Processing row')  // 10K log lines for 10K rows\n})",
      relatedPlaybooks: ['observability.md', 'performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_in_tight_loop', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        let inLoop = false;
        let loopLine = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/(?:\.forEach|\.map|\.filter|for\s*\(|while\s*\()/.test(line) && line.includes('{')) { inLoop = true; loopLine = i; }
          if (inLoop && /(?:console\.|logger\.|log\.)\w+\s*\(/.test(line)) {
            findings.push({ severity, category: 'log_in_tight_loop', file: path, line: i + 1, message: 'Logging inside a loop — may generate thousands of log lines per operation.', suggestion: 'Log batch summary before and after: logger.info({ count: items.length }, "Processing batch").' });
            inLoop = false;
          }
          if (inLoop && line.trim() === '}') inLoop = false;
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_012',
    category: 'log_stack_trace_missing',
    description: "Logging error.message without the error object itself loses the stack trace, making debugging impossible.",
    severity: 'HIGH',
    tags: ['logging', 'error-handling', 'observability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "logger.error({ message: err.message }, 'Failed') throws away the stack trace. logger.error({ err }, 'Failed') — passing the whole error object — lets pino/winston serialize the stack and preserve full context.",
      commonViolations: ["catch(err) { logger.error({ message: err.message }, 'Failed') }", "console.error(err.message)"],
      goodExample: "catch(err) { logger.error({ err }, 'Operation failed') }  // full stack trace preserved",
      badExample: "} catch(err) { logger.error({ message: err.message }, 'DB error') }  // stack lost",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_stack_trace_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:logger|log)\.\w+\s*\(\s*\{[^}]*\b\w+\.message\b[^}]*\}/.test(line) && !/\berr\b|\berror\b/.test(line.replace(/\.message/, ''))) {
            findings.push({ severity, category: 'log_stack_trace_missing', file: path, line: i + 1, message: 'Logging only err.message loses the stack trace — pass the full error object instead.', suggestion: 'Pass the full error: logger.error({ err, ...context }, "Operation failed") to preserve stack trace.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_013',
    category: 'child_logger_missing',
    description: 'Creating a new logger per function call instead of using child loggers loses inherited context.',
    severity: 'LOW',
    tags: ['logging', 'observability', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Calling logger.info({ requestId, userId, ... }) on every log line inside a request handler is verbose and error-prone. Use pino's child logger: const reqLogger = logger.child({ requestId, userId }) to inherit context automatically.",
      commonViolations: ["logger.info({ requestId, userId }, 'Start')\nlogger.info({ requestId, userId }, 'Processing')\nlogger.info({ requestId, userId }, 'Done')"],
      goodExample: "const reqLogger = logger.child({ requestId, userId })\nreqLogger.info('Start')\nreqLogger.info('Processing')\nreqLogger.info('Done')",
      badExample: "// Repeating { requestId, userId } in every log call in the function",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('child_logger_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const requestIdMatches = [...content.matchAll(/(?:requestId|req_id|traceId|trace_id)\s*:/g)];
        if (requestIdMatches.length >= 4 && !content.includes('.child(')) {
          findings.push({ severity, category: 'child_logger_missing', file: path, message: `requestId repeated ${requestIdMatches.length} times in log calls — use a child logger to inherit context automatically.`, suggestion: "Create: const reqLogger = logger.child({ requestId, userId }) and use reqLogger throughout the function." });
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_014',
    category: 'log_level_not_configurable',
    description: "Hardcoded log levels (always debug) in production waste resources; log level should be environment-configurable.",
    severity: 'MEDIUM',
    tags: ['logging', 'configuration', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Always-debug logging in production generates 10-100x more log volume, increases costs, and may expose sensitive debug data. Set level from environment: LOG_LEVEL=info in production, LOG_LEVEL=debug in development.",
      commonViolations: ["const logger = pino({ level: 'debug' })  // always debug, even in production"],
      goodExample: "const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })",
      badExample: "const logger = winston.createLogger({ level: 'debug' })  // debug in production",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_level_not_configurable', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes('pino(') && !content.includes('winston') && !content.includes('createLogger')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/level\s*:\s*['"]debug['"]/.test(line) && !line.includes('process.env') && !line.includes('NODE_ENV')) {
            findings.push({ severity, category: 'log_level_not_configurable', file: path, line: i + 1, message: "Hardcoded 'debug' log level — too verbose for production.", suggestion: "Make configurable: level: process.env.LOG_LEVEL ?? 'info'" });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_015',
    category: 'log_http_responses',
    description: "Logging full HTTP response bodies may capture large payloads or sensitive data unexpectedly.",
    severity: 'MEDIUM',
    tags: ['logging', 'security', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Logging an API response body may include personal data returned from the external service. Log only status codes, request IDs, and metadata. Fetch and log response bodies only in DEBUG mode for local development.",
      commonViolations: ["const res = await fetch(url)\nconst data = await res.json()\nconsole.log(data)"],
      goodExample: "const res = await fetch(url)\nlogger.info({ status: res.status, url }, 'External API response')\nconst data = await res.json()",
      badExample: "const body = await res.json()\nlogger.info({ body }, 'API response')  // may contain PII from third-party API",
      relatedPlaybooks: ['observability.md', 'security.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_http_responses', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:console\.|logger\.|log\.)\w+\s*\(\s*(?:data|body|response|result)\s*[,)]/.test(line)) {
            const prev3 = lines.slice(Math.max(0, i - 3), i).join('\n');
            if (/res(?:ponse)?\.json|await fetch/.test(prev3)) {
              findings.push({ severity, category: 'log_http_responses', file: path, line: i + 1, message: 'Logging full HTTP response body — may contain PII or large payloads.', suggestion: 'Log only status and metadata: logger.info({ status: res.status, url }, "Response").' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_016',
    category: 'audit_log_missing',
    description: "Destructive operations (delete, update, transfer) without audit logging make incident investigation impossible.",
    severity: 'HIGH',
    tags: ['logging', 'security', 'compliance', 'audit'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'SOC2, HIPAA, and PCI DSS require audit logs for sensitive operations. A delete without an audit log means you can never answer "who deleted this, when, and from where?" in an incident review.',
      commonViolations: ['await prisma.user.delete({ where: { id } })  // no audit log'],
      goodExample: "await prisma.user.delete({ where: { id } })\nawait auditLog.create({ action: 'USER_DELETE', targetId: id, actorId: ctx.userId, ip: ctx.ip })",
      badExample: "export async function deleteOrder(id: string) { await db.orders.delete(id) }  // no who/when/where",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('audit_log_missing', config.severityRules);
      const findings: Finding[] = [];
      const DESTRUCTIVE = /(?:\.delete|\.destroy|\.remove|\.drop|\.truncate|DELETE\s+FROM)\s*\(/;
      const HAS_AUDIT = /audit|AuditLog|auditLog|audit_log|createLog/;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!DESTRUCTIVE.test(content)) continue;
        if (!HAS_AUDIT.test(content)) {
          findings.push({ severity, category: 'audit_log_missing', file: path, message: 'Destructive database operations without audit logging — cannot trace who deleted data or when.', suggestion: "After each destructive op, call auditLog.create({ action, targetId, actorId, timestamp, ip })." });
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_017',
    category: 'log_rate_limit_missing',
    description: "Logging every occurrence of a high-frequency event (e.g., cache miss per request) can overwhelm log aggregators.",
    severity: 'LOW',
    tags: ['logging', 'performance', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A cache miss logged on every API request at 1000 req/s = 1000 log lines/s. Log aggregators charge per GB. Use sampling (log 1% of events) or throttle (log once per minute) for high-frequency non-critical events.",
      commonViolations: ["logger.debug({ key }, 'Cache miss')  // inside hot path"],
      goodExample: "// Log sample: if (Math.random() < 0.01) logger.debug({ key }, 'Cache miss')\n// Or use a counter: if (misses % 1000 === 0) logger.info({ misses }, 'Cache miss rate')",
      badExample: "// In a function called 1000x/sec:\nlogger.debug({ key }, 'Cache miss')  // 86M log lines per day",
      relatedPlaybooks: ['observability.md', 'performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_rate_limit_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!path.includes('middleware') && !path.includes('cache') && !path.includes('handler') && !path.includes('route')) return findings;
        const logCount = (content.match(/(?:logger|log)\.\w+\s*\(/g) || []).length;
        if (logCount > 5 && !content.includes('Math.random') && !content.includes('sample') && !content.includes('throttle')) {
          findings.push({ severity, category: 'log_rate_limit_missing', file: path, message: `${logCount} log calls in a high-frequency path without rate limiting — consider sampling or throttling.`, suggestion: 'Use sampling: if (Math.random() < 0.01) logger.debug() for high-frequency non-critical events.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_018',
    category: 'log_verbosity_in_serverless',
    description: "Verbose logging in serverless functions (Lambda, Edge) increases cold start time and per-invocation cost.",
    severity: 'MEDIUM',
    tags: ['logging', 'serverless', 'performance', 'cost'],
    sinceVersion: '3.0.0',
    explain: {
      why: "CloudWatch Logs charges $0.50/GB ingested. An Edge Function that logs 10KB per request at 1M req/day = $5/day just in logging costs. Lambda also charges for execution time while writing to CloudWatch — synchronous logging adds latency.",
      commonViolations: ["// In a Next.js Edge Function:\nlogger.debug({ headers: req.headers, body }, 'Request')"],
      goodExample: "// In serverless/edge:\nif (process.env.LOG_LEVEL === 'debug') { logger.debug({ url }, 'Request') }\nlogger.info({ status: res.status }, 'Response')  // minimal, essential only",
      badExample: "// Lambda handler:\nconsole.log(JSON.stringify(event))  // logs full event including auth tokens",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_verbosity_in_serverless', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const isEdgeOrLambda = path.includes('edge') || path.includes('lambda') || path.includes('middleware.ts') || path.includes('middleware.js') || content.includes("runtime = 'edge'") || content.includes("export const runtime = 'edge'");
        if (!isEdgeOrLambda) return findings;
        const debugCount = (content.match(/(?:console\.debug|logger\.debug)\s*\(/g) || []).length;
        if (debugCount >= 2) {
          findings.push({ severity, category: 'log_verbosity_in_serverless', file: path, message: `${debugCount} debug log calls in a serverless/edge file — increases invocation cost and latency.`, suggestion: "Gate debug logs: if (process.env.LOG_LEVEL === 'debug') { logger.debug(...) } or remove in edge functions." });
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_019',
    category: 'log_missing_service_name',
    description: "Logs without a service name field are hard to filter in multi-service deployments.",
    severity: 'LOW',
    tags: ['logging', 'observability', 'devops'],
    sinceVersion: '3.0.0',
    explain: {
      why: "In a microservices system with 20 services all sending logs to the same Datadog workspace, logs without a service field make filtering by service impossible. Always include service and version in the base logger.",
      commonViolations: ["const logger = pino()  // no service name"],
      goodExample: "const logger = pino({ base: { service: 'user-api', version: process.env.npm_package_version } })",
      badExample: "const logger = pino()  // logs from all services look identical",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_missing_service_name', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!path.includes('logger') && !path.includes('log.') && !content.includes('pino(') && !content.includes('createLogger(')) return findings;
        if (/pino\s*\(\s*\{/.test(content) || /createLogger\s*\(\s*\{/.test(content)) {
          if (!content.includes('service') && !content.includes('serviceName') && !content.includes('service_name')) {
            findings.push({ severity, category: 'log_missing_service_name', file: path, message: "Logger initialized without service name — logs indistinguishable across services.", suggestion: "Add: pino({ base: { service: 'my-service', version: pkg.version } }) to identify the source." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'LOG_020',
    category: 'log_health_check_noise',
    description: "Logging every health check request (/health, /ping) at INFO level creates noise that buries real events.",
    severity: 'LOW',
    tags: ['logging', 'observability', 'noise'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A load balancer health check at /health every 10 seconds = 6 log entries/minute = 8,640 per day. These bury real application events. Skip or log health checks at TRACE level with a conditional.",
      commonViolations: ["app.get('/health', (req, res) => { logger.info('Health check') })"],
      goodExample: "app.get('/health', (req, res) => {\n  // Don't log — or use trace: logger.trace('health check')\n  res.json({ status: 'ok' })\n})",
      badExample: "// Middleware logs every request including /health\napp.use((req, res, next) => { logger.info({ url: req.url }, 'Request') })",
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('log_health_check_noise', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/['"]\/health['"]|['"]\/ping['"]|['"]\/ready['"]/.test(line)) {
            const block = lines.slice(i, i + 8).join('\n');
            if (/(?:logger|console)\.(info|warn|log)\s*\(/.test(block)) {
              findings.push({ severity, category: 'log_health_check_noise', file: path, line: i + 1, message: 'Health check endpoint logs at INFO level — creates 8K+ log entries/day of noise.', suggestion: 'Skip health check logging entirely or use logger.trace() and filter at aggregator level.' });
            }
          }
        }
      }
      return findings;
    },
  },
];
