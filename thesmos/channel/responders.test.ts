// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { resolveResponders, ZEUS_AGENT_ID } from './responders.js';

const DEV_TEAM_ROSTER = [
  'chiron-architecture-agent',
  'cassandra-qa-agent',
  'asclepius-debugging-agent',
  'atlas-integration-agent',
  'kratos-devops-agent',
  'kronos-github-agent',
  'eos-automation-agent',
  ZEUS_AGENT_ID,
];

describe('resolveResponders — specialist routing', () => {
  it('routes an architecture question to chiron and closes with Zeus', () => {
    const result = resolveResponders('need an architecture decision on this service split', DEV_TEAM_ROSTER);
    expect(result.specialists).toContain('chiron-architecture-agent');
    expect(result.zeus).toBe(true);
  });

  it('never surfaces an agent outside the channel roster', () => {
    // routeTask would also match hermes-marketing-agent for this text, but the
    // dev-team roster doesn't include it.
    const result = resolveResponders('we need a marketing campaign and an architecture review', DEV_TEAM_ROSTER);
    expect(result.specialists).not.toContain('hermes-marketing-agent');
  });

  it('pulls in an explicitly @mentioned agent even without a keyword match', () => {
    const result = resolveResponders('@cassandra can you sanity check this?', DEV_TEAM_ROSTER);
    expect(result.specialists).toContain('cassandra-qa-agent');
  });

  it('deduplicates when both routing and a mention point at the same agent', () => {
    const result = resolveResponders('@chiron — need an architecture decision here', DEV_TEAM_ROSTER);
    expect(result.specialists.filter((id) => id === 'chiron-architecture-agent')).toHaveLength(1);
  });

  it('returns no specialists for text nothing routes or mentions', () => {
    const result = resolveResponders('good morning team', DEV_TEAM_ROSTER);
    expect(result.specialists).toEqual([]);
  });
});

describe('resolveResponders — Zeus', () => {
  it('closes out a round that produced a specialist reply', () => {
    const result = resolveResponders('write an e2e test plan for checkout', DEV_TEAM_ROSTER);
    expect(result.specialists.length).toBeGreaterThan(0);
    expect(result.zeus).toBe(true);
  });

  it('joins on an explicit @zeus mention even with no specialist match', () => {
    const result = resolveResponders('@zeus what should we prioritize this week?', DEV_TEAM_ROSTER);
    expect(result.specialists).toEqual([]);
    expect(result.zeus).toBe(true);
  });

  /**
   * Regression, caught running a real round: `routeTask` matches "e2e test"
   * but not "e2e coverage", so a plainly dev-team question routed to nobody
   * and the channel answered with total silence. Zeus is the standing COO
   * presence — he always takes the last turn, so that cannot happen.
   */
  it('still answers when the keyword router matches nothing', () => {
    const result = resolveResponders(
      'The new thesmos/channel/ module has no e2e coverage. What should we write first?',
      DEV_TEAM_ROSTER,
    );
    expect(result.specialists).toEqual([]);
    expect(result.zeus).toBe(true);
  });

  it('answers even small talk rather than leaving the room silent', () => {
    const result = resolveResponders('good morning team', DEV_TEAM_ROSTER);
    expect(result.zeus).toBe(true);
  });

  it('never appears when the roster excludes him, even on @mention', () => {
    const rosterWithoutZeus = DEV_TEAM_ROSTER.filter((id) => id !== ZEUS_AGENT_ID);
    const result = resolveResponders('@zeus help us decide', rosterWithoutZeus);
    expect(result.zeus).toBe(false);
  });

  it('is never returned as a specialist', () => {
    const result = resolveResponders('@zeus need an architecture decision too', DEV_TEAM_ROSTER);
    expect(result.specialists).not.toContain(ZEUS_AGENT_ID);
  });
});
