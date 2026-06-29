// Claude Code hook — captures Agent tool pre/post events and appends to
// .thesmos/agent-activity.jsonl so the VSCode sidebar can display live
// agent activity without polling.
//
// Must always exit 0 — a non-zero exit blocks the Agent tool call.
// Written as CJS because Claude Code hooks run in plain Node (no bundler).

'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(buf);

    // PostToolUse payloads have a tool_response field; PreToolUse do not.
    const isPost = Object.prototype.hasOwnProperty.call(payload, 'tool_response');
    const input = payload.tool_input ?? {};

    const event = {
      ts: new Date().toISOString(),
      type: isPost ? 'complete' : 'spawn',
      agentId: payload.tool_use_id ?? randomUUID(),
      sessionId: payload.session_id ?? 'unknown',
      description: String(input.description ?? ''),
      subagentType: String(input.subagent_type ?? 'general-purpose'),
      ...(isPost && {
        resultSummary: String(payload.tool_response ?? '').slice(0, 200),
      }),
    };

    const log = path.join(process.cwd(), '.thesmos', 'agent-activity.jsonl');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, JSON.stringify(event) + '\n');
  } catch {
    // silent — never block agent spawning on a logging error
  }

  process.exit(0);
});
