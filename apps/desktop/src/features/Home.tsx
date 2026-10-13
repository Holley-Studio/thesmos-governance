// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Home — the channel.
 *
 * A persistent, Slack-style room where the user and a fixed roster of
 * Pantheon specialists (plus Zeus, standing in as a COO who closes out a
 * round) talk to each other, not a single-shot mission composer. That's a
 * deliberate departure from `thesmos/mission/`'s one-shot DAG execution — see
 * `thesmos/channel/orchestrator.ts` for why a genuinely new engine backs this
 * instead of reusing mission execution.
 *
 * No token-level streaming: an agent's reply appears whole once it's ready,
 * picked up by polling `channel.getMessages` rather than a live event feed —
 * see `apps/desktop/sidecar/channel.ts` for why `channel.postMessage` returns
 * immediately instead of blocking on the round.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  runtime,
  type ChannelDefinitionSummary,
  type ChannelMessageSummary,
  type RuntimeHealth,
} from '../ipc/runtime';

const POLL_INTERVAL_MS = 2000;

/**
 * A readable label from an agent id, without needing the full catalog
 * entry — good enough for a channel bubble. `pantheon.list` (not fetched
 * here) has the canonical `name`/`god` fields if this ever needs to be exact.
 */
function authorLabel(authorId: string): string {
  if (authorId === 'user') return 'You';
  if (authorId === 'zeus-executive-agent') return 'Zeus';
  const short = authorId.split('-')[0] ?? authorId;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function ChannelMessageBubble({ message }: { message: ChannelMessageSummary }): JSX.Element {
  return (
    <article className="channel-message" data-author-type={message.authorType} data-author={message.authorId}>
      <span className="channel-message-author">{authorLabel(message.authorId)}</span>
      <p className="channel-message-text">{message.text}</p>
    </article>
  );
}

export function Home({
  health,
  onOpenProject,
}: {
  health: RuntimeHealth | null;
  onOpenProject: () => void;
}): JSX.Element {
  const hasProject = Boolean(health?.projectRoot);

  const [channel, setChannel] = useState<ChannelDefinitionSummary | null>(null);
  const [messages, setMessages] = useState<ChannelMessageSummary[]>([]);
  const [intent, setIntent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitedAgentIds, setAwaitedAgentIds] = useState<string[]>([]);

  // Plain refs, not state: the poll loop reads the latest cursor without
  // wanting to re-subscribe every tick, and the scroll effect only needs the
  // DOM node.
  const lastSeqRef = useRef<number>(-1);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasProject) {
      setChannel(null);
      setMessages([]);
      lastSeqRef.current = -1;
      return;
    }
    let cancelled = false;
    runtime
      .channel()
      .then((def) => {
        if (!cancelled) setChannel(def);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'channel unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [hasProject]);

  const poll = useCallback(async () => {
    if (!hasProject) return;
    try {
      const { messages: fresh } = await runtime.channelMessages({
        sinceSeq: lastSeqRef.current >= 0 ? lastSeqRef.current : undefined,
      });
      if (fresh.length === 0) return;
      lastSeqRef.current = fresh[fresh.length - 1]!.seq;
      setMessages((prev) => [...prev, ...fresh]);
      setAwaitedAgentIds((prev) => prev.filter((id) => !fresh.some((m) => m.authorId === id)));
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'could not reach the channel');
    }
  }, [hasProject]);

  useEffect(() => {
    if (!hasProject) return;
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasProject, poll]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, awaitedAgentIds]);

  const submit = useCallback(async () => {
    const text = intent.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const { message, respondingAgentIds } = await runtime.postToChannel(text);
      lastSeqRef.current = Math.max(lastSeqRef.current, message.seq);
      setMessages((prev) => [...prev, message]);
      setAwaitedAgentIds(respondingAgentIds);
      setIntent('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'could not post to the channel');
    } finally {
      setSending(false);
    }
  }, [intent, sending]);

  if (!hasProject) {
    return (
      <section className="home">
        <div className="home-monument">
          <h1 className="hero">THESMOS</h1>
          <p className="hero-sub">What shall the gods accomplish?</p>
        </div>
        <div className="composer">
          <div className="composer-foot channel-gate">
            <span className="composer-note">Choose a project to open the channel.</span>
            <button type="button" className="btn-authority" onClick={onOpenProject}>
              Choose Project
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="channel">
      <header className="channel-head">
        <h2 className="inscription channel-title">{channel?.name ?? '#dev-team'}</h2>
        <span className="notice channel-roster-note">
          {channel ? `${channel.agentIds.length} participants` : 'Opening the channel…'}
        </span>
      </header>

      {error && <p className="notice channel-error">{error}</p>}

      <div className="channel-log" ref={logRef}>
        {messages.length === 0 && !error && (
          <p className="notice">Say what needs doing — the right specialists will weigh in, and Zeus closes out the round.</p>
        )}
        {messages.map((m) => (
          <ChannelMessageBubble key={m.id} message={m} />
        ))}
        {awaitedAgentIds.length > 0 && (
          <p className="notice channel-typing">{awaitedAgentIds.map(authorLabel).join(', ')} may weigh in…</p>
        )}
      </div>

      <div className="composer">
        <label className="sr-only" htmlFor="channel-intent">
          Message {channel?.name ?? 'the channel'}
        </label>
        <textarea
          id="channel-intent"
          className="composer-input"
          rows={3}
          placeholder="Message the channel — @mention a specialist by name to pull them in directly…"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={sending}
        />
        <div className="composer-foot">
          <span className="composer-note">{sending ? 'Posting…' : 'Enter to send, Shift+Enter for a new line.'}</span>
          <button
            type="button"
            className="btn-authority"
            onClick={() => void submit()}
            disabled={sending || !intent.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </section>
  );
}
