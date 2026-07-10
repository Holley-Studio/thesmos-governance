// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * SessionHistory — "📜 Chronicles". Lists past Claude Code sessions for this
 * workspace and reconstructs a lightweight chat transcript so a session can
 * be reopened and continued (the CLI's --resume does the actual resuming;
 * we only rebuild what the panel displays).
 *
 * Sessions live at ~/.claude/projects/<slug>/<session-id>.jsonl where <slug>
 * is the workspace path with non-alphanumeric characters replaced by '-'.
 * The JSONL format is internal to Claude Code and can change — every parse
 * here is defensive, and a session that fails to parse simply shows fewer
 * details rather than erroring.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SessionSummary {
  sessionId: string;
  /** First user message (or summary line), trimmed for display. */
  title: string;
  modifiedAt: Date;
  messageCount: number;
}

export interface TranscriptItem {
  role: 'user' | 'assistant';
  text: string;
}

function projectSlug(workspaceRoot: string): string {
  return workspaceRoot.replace(/[^a-zA-Z0-9]/g, '-');
}

export function sessionsDir(workspaceRoot: string): string {
  return join(homedir(), '.claude', 'projects', projectSlug(workspaceRoot));
}

/** Extract plain text from a message content field (string or block array). */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof (block as { text?: unknown })?.text === 'string' ? (block as { text: string }).text : '',
      )
      .join('')
      .trim();
  }
  return '';
}

/** List sessions for a workspace, newest first. Returns [] when none exist. */
export function listSessions(workspaceRoot: string, limit = 25): SessionSummary[] {
  const dir = sessionsDir(workspaceRoot);
  if (!existsSync(dir)) return [];

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  for (const file of files) {
    const path = join(dir, file);
    try {
      const stat = statSync(path);
      const raw = readFileSync(path, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim());

      let title = '';
      let messageCount = 0;
      for (const line of lines) {
        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (entry.type === 'summary' && typeof entry.summary === 'string' && !title) {
          title = entry.summary;
        }
        if (entry.type === 'user' || entry.type === 'assistant') {
          messageCount++;
          if (!title && entry.type === 'user') {
            const message = entry.message as { content?: unknown } | undefined;
            const text = contentText(message?.content);
            if (text && !text.startsWith('<')) title = text; // skip system-reminder-style payloads
          }
        }
      }
      if (messageCount === 0) continue; // empty/agent-only transcript — not worth listing

      summaries.push({
        sessionId: file.replace(/\.jsonl$/, ''),
        title: (title || '(untitled session)').replace(/\s+/g, ' ').slice(0, 80),
        modifiedAt: stat.mtime,
        messageCount,
      });
    } catch {
      continue; // unreadable file — skip
    }
  }

  return summaries.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()).slice(0, limit);
}

/**
 * Rebuild a displayable transcript (text messages only — tool calls and
 * results are internal detail the resumed CLI still remembers regardless).
 */
export function loadTranscript(workspaceRoot: string, sessionId: string, maxItems = 100): TranscriptItem[] {
  if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) return [];
  const path = join(sessionsDir(workspaceRoot), `${sessionId}.jsonl`);
  if (!existsSync(path)) return [];

  const items: TranscriptItem[] = [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    // Sidechain (subagent) traffic isn't part of the main conversation.
    if (entry.isSidechain === true) continue;
    const message = entry.message as { content?: unknown } | undefined;
    const text = contentText(message?.content);
    if (!text) continue; // tool_use-only turns and tool_result echoes
    if (entry.type === 'user' && text.startsWith('<')) continue; // injected reminders/caveats
    items.push({ role: entry.type, text: text.slice(0, 4000) });
  }

  return items.slice(-maxItems);
}
