// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Thesmos Language Server — LSP 3.17 over stdio.
 *
 * A standalone language server that surfaces Thesmos governance findings
 * as real-time diagnostics in any LSP-compatible editor (VS Code, Cursor,
 * Neovim, Emacs, etc.).
 *
 * Start: thesmos lsp
 * Transport: stdio — JSON-RPC 2.0, one message per line
 *
 * Capabilities implemented:
 *   textDocument/didOpen    → immediate scan on open
 *   textDocument/didChange  → debounced scan (500ms) as you type
 *   textDocument/didSave    → immediate scan on save
 *   textDocument/publishDiagnostics → squiggle delivery
 *   textDocument/hover      → rule explanation tooltip
 *   textDocument/codeAction → fix / suppress / explain actions
 *
 * Severity mapping:
 *   BLOCKER   → Error   (1)
 *   HIGH      → Warning (2)
 *   MEDIUM    → Information (3)
 *   LOW / TECH_DEBT → Hint (4)
 */

import { createInterface } from 'node:readline';
import type { Finding, ThesmosConfig, ScanResult } from './types.js';
import { THESMOS_RULES } from './rules/registry.js';
import { loadConfig, CONFIG_DEFAULTS } from './config.js';
import { makeLogger } from './logger.js';

const log = makeLogger('lsp');

// ── LSP protocol types ────────────────────────────────────────────────────────

interface LspRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

interface LspResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

interface LspNotification {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
}

interface Position { line: number; character: number }
interface Range { start: Position; end: Position }

interface Diagnostic {
  range: Range;
  severity: 1 | 2 | 3 | 4;
  code?: string;
  source?: string;
  message: string;
  data?: unknown;
}

// ── Severity conversion ───────────────────────────────────────────────────────

function severityToLsp(s: string): 1 | 2 | 3 | 4 {
  switch (s) {
    case 'BLOCKER': return 1;
    case 'HIGH':    return 2;
    case 'MEDIUM':  return 3;
    default:        return 4;
  }
}

// ── Empty scan helper ─────────────────────────────────────────────────────────

function makeEmptyScan(): ScanResult {
  return {
    _generatedSections: [],
    generatedAt: new Date().toISOString(),
    scanVersion: '0',
    pages: [], apiRoutes: [], componentCount: 0,
    sharedUiFiles: [], designSystemFiles: [], storeFiles: [],
    testFiles: [], largeFiles: [], riskyFiles: [],
    scriptFiles: [], envFiles: [], clientBoundaryRisks: [],
  };
}

// ── File-level scan ───────────────────────────────────────────────────────────

function scanFile(filePath: string, content: string, config: ThesmosConfig): Finding[] {
  const scan = makeEmptyScan();
  const changedFiles = [{ path: filePath, content }];
  return THESMOS_RULES.flatMap((rule) =>
    rule.detect({ scan, config, changedFiles }),
  );
}

function findingsToDiagnostics(findings: Finding[], content: string): Diagnostic[] {
  const lines = content.split('\n');
  return findings.map((f) => {
    const lineIdx = Math.max(0, (f.line ?? 1) - 1);
    const lineText = lines[lineIdx] ?? '';
    const startChar = lineText.search(/\S/);
    const endChar = lineText.length;
    return {
      range: {
        start: { line: lineIdx, character: Math.max(0, startChar) },
        end:   { line: lineIdx, character: endChar },
      },
      severity: severityToLsp(f.severity),
      code: f.category,
      source: 'thesmos',
      message: f.message + (f.suggestion ? `\n\nFix: ${f.suggestion}` : ''),
      data: { category: f.category, file: f.file, suggestion: f.suggestion },
    };
  });
}

// ── Server state ──────────────────────────────────────────────────────────────

interface FileState {
  uri: string;
  content: string;
  findings: Finding[];
  debounceTimer?: ReturnType<typeof setTimeout>;
}

const openFiles = new Map<string, FileState>();
let workspaceRoot = process.cwd();
let config: ThesmosConfig = CONFIG_DEFAULTS;

function uriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

// ── Output ────────────────────────────────────────────────────────────────────

function send(msg: LspResponse | LspNotification): void {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  process.stdout.write(header + body);
}

function publishDiagnostics(uri: string, content: string, findings: Finding[]): void {
  const diagnostics = findingsToDiagnostics(findings, content);
  send({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: { uri, diagnostics },
  });
}

// ── Scan + publish ────────────────────────────────────────────────────────────

function scheduleScan(state: FileState, delayMs = 500): void {
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    const filePath = uriToPath(state.uri);
    state.findings = scanFile(filePath, state.content, config);
    publishDiagnostics(state.uri, state.content, state.findings);
  }, delayMs);
}

function scanImmediate(state: FileState): void {
  clearTimeout(state.debounceTimer);
  const filePath = uriToPath(state.uri);
  const t0 = Date.now();
  state.findings = scanFile(filePath, state.content, config);
  const elapsed = Date.now() - t0;
  if (elapsed > 500) log.warn('slow scan', { file: filePath, durationMs: elapsed });
  publishDiagnostics(state.uri, state.content, state.findings);
}

// ── Request handlers ──────────────────────────────────────────────────────────

function handleInitialize(id: number | string | null): void {
  send({
    jsonrpc: '2.0',
    id,
    result: {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: 2, // incremental
          save: { includeText: false },
        },
        hoverProvider: true,
        codeActionProvider: true,
      },
      serverInfo: { name: 'thesmos-lsp', version: '1.0.0' },
    },
  });
}

function handleHover(
  id: number | string | null,
  params: { textDocument: { uri: string }; position: Position },
): void {
  const state = openFiles.get(params.textDocument.uri);
  if (!state || state.findings.length === 0) {
    send({ jsonrpc: '2.0', id, result: null });
    return;
  }

  const targetLine = params.position.line + 1;
  const finding = state.findings.find((f) => Math.abs((f.line ?? 0) - targetLine) <= 1);
  if (!finding) {
    send({ jsonrpc: '2.0', id, result: null });
    return;
  }

  const rule = THESMOS_RULES.find((r) => r.category === finding.category);
  const why = rule?.explain?.why ?? finding.message;
  const fix = finding.suggestion ?? rule?.explain?.goodExample ?? '';

  let content = `**[${finding.category}]** ${finding.message}\n\n${why}`;
  if (fix) content += `\n\n**Fix:** ${fix}`;

  send({ jsonrpc: '2.0', id, result: { contents: { kind: 'markdown', value: content } } });
}

function handleCodeAction(
  id: number | string | null,
  params: { textDocument: { uri: string }; range: Range },
): void {
  const state = openFiles.get(params.textDocument.uri);
  if (!state || state.findings.length === 0) {
    send({ jsonrpc: '2.0', id, result: [] });
    return;
  }

  const targetLine = params.range.start.line + 1;
  const finding = state.findings.find((f) => Math.abs((f.line ?? 0) - targetLine) <= 1);
  if (!finding) {
    send({ jsonrpc: '2.0', id, result: [] });
    return;
  }

  const actions = [
    {
      title: `Explain: ${finding.category}`,
      kind: 'quickfix',
      command: {
        command: 'thesmos.explainRule',
        title: `Explain ${finding.category}`,
        arguments: [finding.category],
      },
    },
    {
      title: `Suppress: thesmos-disable-next-line ${finding.category}`,
      kind: 'quickfix',
      edit: {
        changes: {
          [params.textDocument.uri]: [
            {
              range: {
                start: { line: params.range.start.line, character: 0 },
                end: { line: params.range.start.line, character: 0 },
              },
              newText: `// thesmos-disable-next-line ${finding.category}\n`,
            },
          ],
        },
      },
    },
  ];

  send({ jsonrpc: '2.0', id, result: actions });
}

// ── Message dispatch ──────────────────────────────────────────────────────────

function dispatch(msg: LspRequest): void {
  const { id, method, params } = msg;
  const p = params as Record<string, unknown>;

  switch (method) {
    case 'initialize': {
      const rootUri = (p?.['rootUri'] as string | undefined) ?? (p?.['rootPath'] as string | undefined);
      if (rootUri) workspaceRoot = uriToPath(rootUri);
      try { config = loadConfig(workspaceRoot); } catch { config = CONFIG_DEFAULTS; }
      handleInitialize(id ?? null);
      break;
    }
    case 'initialized':
      break;

    case 'textDocument/didOpen': {
      const td = p?.['textDocument'] as { uri: string; text: string } | undefined;
      if (!td) break;
      const state: FileState = { uri: td.uri, content: td.text, findings: [] };
      openFiles.set(td.uri, state);
      scanImmediate(state);
      break;
    }

    case 'textDocument/didChange': {
      const td2 = p?.['textDocument'] as { uri: string } | undefined;
      const changes = p?.['contentChanges'] as Array<{ text: string }> | undefined;
      if (!td2 || !changes) break;
      const state2 = openFiles.get(td2.uri);
      if (!state2) break;
      const last = changes[changes.length - 1];
      if (last) state2.content = last.text;
      scheduleScan(state2, 500);
      break;
    }

    case 'textDocument/didSave': {
      const td3 = p?.['textDocument'] as { uri: string } | undefined;
      if (!td3) break;
      const state3 = openFiles.get(td3.uri);
      if (state3) scanImmediate(state3);
      break;
    }

    case 'textDocument/didClose': {
      const td4 = p?.['textDocument'] as { uri: string } | undefined;
      if (!td4) break;
      const state4 = openFiles.get(td4.uri);
      if (state4) clearTimeout(state4.debounceTimer);
      openFiles.delete(td4.uri);
      // Clear diagnostics on close
      send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: td4.uri, diagnostics: [] } });
      break;
    }

    case 'textDocument/hover':
      handleHover(id ?? null, p as Parameters<typeof handleHover>[1]);
      break;

    case 'textDocument/codeAction':
      handleCodeAction(id ?? null, p as Parameters<typeof handleCodeAction>[1]);
      break;

    case 'shutdown':
      send({ jsonrpc: '2.0', id: id ?? null, result: null });
      break;

    case 'exit':
      process.exit(0);
      break;

    default:
      if (id !== undefined && id !== null) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
  }
}

// ── stdio transport (header-framed) ──────────────────────────────────────────

export function startLspServer(): void {
  log.info('server started', { rules: THESMOS_RULES.length });

  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;

    // Parse LSP header-framed messages (Content-Length: N\r\n\r\n{body})
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const lenMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lenMatch) { buffer = buffer.slice(headerEnd + 4); break; }

      const len = parseInt(lenMatch[1]!, 10);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + len) break; // incomplete — wait for more data

      const body = buffer.slice(bodyStart, bodyStart + len);
      buffer = buffer.slice(bodyStart + len);

      try {
        const msg = JSON.parse(body) as LspRequest;
        dispatch(msg);
      } catch {
        // malformed JSON — ignore
      }
    }
  });

  process.stdin.on('end', () => process.exit(0));
}
