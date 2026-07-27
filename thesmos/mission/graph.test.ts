// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Mission graph shape and ordering.
 *
 * The tests that matter most are the order-independence ones: a mission
 * declared in a different order must schedule identically, or mission ids and
 * state hashes stop meaning anything.
 */

import { describe, expect, it } from 'vitest';
import { MAX_DELEGATION_DEPTH, buildMissionGraph } from './graph.js';
import { MISSION_CODES, type MissionTaskInput } from './types.js';

function task(id: string, dependsOn: string[] = [], extra: Partial<MissionTaskInput> = {}): MissionTaskInput {
  return { id, agentId: `${id}-agent`, title: `Task ${id}`, intent: `do ${id}`, dependsOn, ...extra };
}

function codes(inputs: MissionTaskInput[]): string[] {
  return buildMissionGraph(inputs).issues.map((i) => i.code);
}

describe('shape', () => {
  it('rejects an empty mission', () => {
    const result = buildMissionGraph([]);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain(MISSION_CODES.graphEmpty);
  });

  it('accepts a single task with no dependencies', () => {
    const result = buildMissionGraph([task('a')]);
    expect(result.valid).toBe(true);
    expect(result.graph.order).toEqual(['a']);
    expect(result.graph.layers).toEqual([['a']]);
  });

  it('rejects a duplicate task id', () => {
    expect(codes([task('a'), task('a')])).toContain(MISSION_CODES.graphDuplicateTask);
  });

  it('rejects a dependency on an unknown task', () => {
    expect(codes([task('a', ['ghost'])])).toContain(MISSION_CODES.graphUnknownDependency);
  });

  it('rejects a self-dependency', () => {
    expect(codes([task('a', ['a'])])).toContain(MISSION_CODES.graphSelfDependency);
  });

  it('rejects a task id that is not a slug', () => {
    expect(codes([task('has/slash')])).toContain(MISSION_CODES.graphTaskIdInvalid);
  });

  it('rejects an unknown parent', () => {
    expect(codes([task('a', [], { parentTaskId: 'ghost' })])).toContain(
      MISSION_CODES.graphUnknownDependency
    );
  });

  it('yields no order when the graph is invalid', () => {
    const result = buildMissionGraph([task('a', ['ghost'])]);
    expect(result.valid).toBe(false);
    expect(result.graph.order).toEqual([]);
  });
});

describe('cycles', () => {
  it('detects a two-task cycle', () => {
    expect(codes([task('a', ['b']), task('b', ['a'])])).toContain(MISSION_CODES.graphCycle);
  });

  it('detects a three-task cycle', () => {
    const result = buildMissionGraph([task('a', ['c']), task('b', ['a']), task('c', ['b'])]);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain(MISSION_CODES.graphCycle);
  });

  it('reports the same cycle identically no matter how it was declared', () => {
    const one = buildMissionGraph([task('a', ['c']), task('b', ['a']), task('c', ['b'])]);
    const two = buildMissionGraph([task('c', ['b']), task('a', ['c']), task('b', ['a'])]);
    const cycleOf = (r: typeof one): string[] =>
      r.issues.filter((i) => i.code === MISSION_CODES.graphCycle).map((i) => i.message);
    expect(cycleOf(one)).toEqual(cycleOf(two));
  });

  it('does not mistake a diamond for a cycle', () => {
    const result = buildMissionGraph([
      task('root'),
      task('left', ['root']),
      task('right', ['root']),
      task('join', ['left', 'right']),
    ]);
    expect(result.valid).toBe(true);
  });
});

describe('ordering', () => {
  it('orders dependencies before dependents', () => {
    const result = buildMissionGraph([task('c', ['b']), task('b', ['a']), task('a')]);
    expect(result.graph.order).toEqual(['a', 'b', 'c']);
  });

  it('is independent of declaration order', () => {
    const forward = buildMissionGraph([
      task('root'),
      task('left', ['root']),
      task('right', ['root']),
      task('join', ['left', 'right']),
    ]);
    const shuffled = buildMissionGraph([
      task('join', ['right', 'left']),
      task('right', ['root']),
      task('root'),
      task('left', ['root']),
    ]);
    expect(shuffled.graph.order).toEqual(forward.graph.order);
    expect(shuffled.graph.layers).toEqual(forward.graph.layers);
  });

  it('groups independent tasks into one layer', () => {
    const result = buildMissionGraph([
      task('root'),
      task('left', ['root']),
      task('right', ['root']),
      task('join', ['left', 'right']),
    ]);
    expect(result.graph.layers).toEqual([['root'], ['left', 'right'], ['join']]);
  });

  it('breaks ties lexicographically', () => {
    const result = buildMissionGraph([task('zeta'), task('alpha'), task('mid')]);
    expect(result.graph.order).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('deduplicates a repeated dependency without changing the order', () => {
    const result = buildMissionGraph([task('a'), task('b', ['a', 'a', 'a'])]);
    expect(result.valid).toBe(true);
    expect(result.graph.order).toEqual(['a', 'b']);
  });
});

describe('delegation', () => {
  it('treats a parent as an implicit dependency', () => {
    const result = buildMissionGraph([task('child', [], { parentTaskId: 'parent' }), task('parent')]);
    expect(result.valid).toBe(true);
    expect(result.graph.order).toEqual(['parent', 'child']);
  });

  it('counts depth from the delegation chain, not the dependency edges', () => {
    const result = buildMissionGraph([
      task('root'),
      task('mid', [], { parentTaskId: 'root' }),
      task('leaf', [], { parentTaskId: 'mid' }),
      task('sibling', ['root']),
    ]);
    const depth = (id: string): number =>
      result.graph.tasks.find((t) => t.id === id)?.depth ?? -1;
    expect(depth('root')).toBe(0);
    expect(depth('mid')).toBe(1);
    expect(depth('leaf')).toBe(2);
    expect(depth('sibling')).toBe(0);
  });

  it('rejects a delegation chain past the ceiling', () => {
    const chain: MissionTaskInput[] = [task('t0')];
    for (let i = 1; i <= MAX_DELEGATION_DEPTH + 1; i += 1) {
      chain.push(task(`t${i}`, [], { parentTaskId: `t${i - 1}` }));
    }
    expect(codes(chain)).toContain(MISSION_CODES.limitDepthExceeded);
  });
});

describe('normalization', () => {
  it('lower-cases and slugifies ids consistently', () => {
    const result = buildMissionGraph([task('Alpha'), task('beta', ['Alpha'])]);
    expect(result.valid).toBe(true);
    expect(result.graph.order).toEqual(['alpha', 'beta']);
  });
});
