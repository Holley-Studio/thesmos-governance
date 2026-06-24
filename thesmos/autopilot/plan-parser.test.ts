import { describe, it, expect } from 'vitest';
import { parsePlan, parseDoneCriterion, isVerifiableCriterion, slugFromTitle } from './plan-parser.js';

const VALID_PLAN = `---
project: TestApp
adapter: claude
gates:
  - npm test
  - thesmos review --ci
commit_on_pass: true
max_retries: 2
---

## Task 1: Add JWT authentication

Context: Users need to log in via JWT tokens.
Scope: src/auth/
New packages allowed: jsonwebtoken@9.x
Done when:
  - file:src/auth/jwt.ts
  - command:npm test -- src/auth

## Task 2: Add rate limiting

Context: Protect API routes from abuse.
Scope: src/middleware/
Done when:
  - file:src/middleware/rate-limit.ts
  - command:npm test
`;

const CHECKPOINT_PLAN = `---
adapter: claude
gates:
  - npm test
---

## Task 1: First task

Scope: src/auth/
Done when:
  - file:src/auth/index.ts

---CHECKPOINT---

## Task 2: Second task

Scope: src/api/
Done when:
  - file:src/api/index.ts
`;

describe('parseDoneCriterion', () => {
  it('parses file: criteria', () => {
    const result = parseDoneCriterion('file:src/auth/jwt.ts');
    expect(result).toEqual({ type: 'file_exists', value: 'src/auth/jwt.ts', raw: 'file:src/auth/jwt.ts' });
  });

  it('parses command: criteria', () => {
    const result = parseDoneCriterion('command:npm test -- src/auth');
    expect(result).toEqual({ type: 'command_passes', value: 'npm test -- src/auth', raw: 'command:npm test -- src/auth' });
  });

  it('parses grep: criteria', () => {
    const result = parseDoneCriterion('grep:src/auth/jwt.ts:export function sign');
    expect(result).toEqual({ type: 'grep_matches', value: 'src/auth/jwt.ts:export function sign', raw: 'grep:src/auth/jwt.ts:export function sign' });
  });

  it('parses no-grep: criteria', () => {
    const result = parseDoneCriterion('no-grep:src/auth/jwt.ts:localStorage');
    expect(result).toEqual({ type: 'grep_not_matches', value: 'src/auth/jwt.ts:localStorage', raw: 'no-grep:src/auth/jwt.ts:localStorage' });
  });

  it('returns null for fuzzy criteria', () => {
    expect(parseDoneCriterion('User registration works end to end')).toBeNull();
    expect(parseDoneCriterion('The API returns correct responses')).toBeNull();
  });
});

describe('isVerifiableCriterion', () => {
  it('returns true for verifiable formats', () => {
    expect(isVerifiableCriterion('file:src/foo.ts')).toBe(true);
    expect(isVerifiableCriterion('command:npm test')).toBe(true);
    expect(isVerifiableCriterion('grep:file:pattern')).toBe(true);
    expect(isVerifiableCriterion('no-grep:file:pattern')).toBe(true);
  });

  it('returns false for fuzzy text', () => {
    expect(isVerifiableCriterion('The feature works')).toBe(false);
    expect(isVerifiableCriterion('All tests pass correctly')).toBe(false);
  });
});

describe('parsePlan', () => {
  it('parses a valid plan with tasks', () => {
    const { plan, issues } = parsePlan(VALID_PLAN);
    expect(plan).not.toBeNull();
    expect(issues.filter(i => i.type === 'error')).toHaveLength(0);
    expect(plan!.project).toBe('TestApp');
    expect(plan!.adapter).toBe('claude');
    expect(plan!.gates).toEqual(['npm test', 'thesmos review --ci']);
    expect(plan!.commitOnPass).toBe(true);
    expect(plan!.maxRetries).toBe(2);
    expect(plan!.tasks).toHaveLength(2);
  });

  it('parses task fields correctly', () => {
    const { plan } = parsePlan(VALID_PLAN);
    const task1 = plan!.tasks[0];
    expect(task1.title).toBe('Task 1: Add JWT authentication');
    expect(task1.scope).toEqual(['src/auth/']);
    expect(task1.allowedPackages).toEqual(['jsonwebtoken@9.x']);
    expect(task1.doneCriteria).toHaveLength(2);
    expect(task1.doneCriteria[0]).toEqual({ type: 'file_exists', value: 'src/auth/jwt.ts', raw: 'file:src/auth/jwt.ts' });
    expect(task1.doneCriteria[1]).toEqual({ type: 'command_passes', value: 'npm test -- src/auth', raw: 'command:npm test -- src/auth' });
    expect(task1.isCheckpoint).toBe(false);
    expect(task1.index).toBe(0);
  });

  it('parses checkpoint markers', () => {
    const { plan } = parsePlan(CHECKPOINT_PLAN);
    expect(plan).not.toBeNull();
    expect(plan!.tasks).toHaveLength(3);
    expect(plan!.tasks[1].isCheckpoint).toBe(true);
    expect(plan!.tasks[1].title).toBe('CHECKPOINT');
    expect(plan!.tasks[0].isCheckpoint).toBe(false);
    expect(plan!.tasks[2].isCheckpoint).toBe(false);
  });

  it('errors on missing scope', () => {
    const plan = `---
adapter: claude
gates:
  - npm test
---

## Task 1: Missing scope
Done when:
  - file:src/foo.ts
`;
    const { issues } = parsePlan(plan);
    const errors = issues.filter(i => i.type === 'error');
    expect(errors.some(e => e.message.includes('no Scope'))).toBe(true);
  });

  it('errors on missing done criteria', () => {
    const plan = `---
adapter: claude
gates:
  - npm test
---

## Task 1: Missing criteria
Scope: src/foo/
`;
    const { issues } = parsePlan(plan);
    const errors = issues.filter(i => i.type === 'error');
    expect(errors.some(e => e.message.includes('no Done criteria'))).toBe(true);
  });

  it('errors on unknown adapter', () => {
    const plan = `---
adapter: devin
gates:
  - npm test
---

## Task 1: Test
Scope: src/
Done when:
  - file:src/foo.ts
`;
    const { issues } = parsePlan(plan);
    expect(issues.some(i => i.type === 'error' && i.message.includes('Unknown adapter'))).toBe(true);
  });

  it('warns on scope overlap between tasks', () => {
    const plan = `---
adapter: claude
gates:
  - npm test
---

## Task 1: First
Scope: src/middleware/
Done when:
  - file:src/middleware/a.ts

## Task 2: Second
Scope: src/middleware/
Done when:
  - file:src/middleware/b.ts
`;
    const { issues } = parsePlan(plan);
    expect(issues.some(i => i.type === 'warning' && i.field === 'scope_overlap')).toBe(true);
  });

  it('errors when no tasks found', () => {
    const { issues } = parsePlan('---\nadapter: claude\n---\n\nNo tasks here.\n');
    expect(issues.some(i => i.type === 'error' && i.message.includes('No tasks found'))).toBe(true);
  });

  it('defaults adapter to claude when not specified', () => {
    const plan = `---
gates:
  - npm test
---

## Task 1: Test
Scope: src/
Done when:
  - file:src/foo.ts
`;
    const { plan: parsed } = parsePlan(plan);
    expect(parsed?.adapter).toBe('claude');
  });

  it('defaults gates to npm test when not specified', () => {
    const plan = `---
adapter: claude
---

## Task 1: Test
Scope: src/
Done when:
  - file:src/foo.ts
`;
    const { plan: parsed } = parsePlan(plan);
    expect(parsed?.gates).toEqual(['npm test']);
  });

  it('handles plan with no frontmatter gracefully', () => {
    const plan = `## Task 1: Test
Scope: src/
Done when:
  - file:src/foo.ts
`;
    const { plan: parsed, issues } = parsePlan(plan);
    // Should parse tasks but have no frontmatter-derived config
    expect(parsed).not.toBeNull();
    expect(parsed?.adapter).toBe('claude');
    expect(issues.filter(i => i.type === 'error')).toHaveLength(0);
  });
});

describe('parsePlan — dependency ordering', () => {
  it('errors when task depends on a non-existent task number', () => {
    const plan = `---
adapter: claude
gates:
  - npm test
---

## Task 1: Setup
Scope: src/setup/
Done when:
  - file:src/setup/index.ts

## Task 2: Build
Scope: src/build/
Depends on: 99
Done when:
  - file:src/build/index.ts
`;
    const { issues } = parsePlan(plan);
    expect(issues.some((i) => i.type === 'error' && i.message.includes('Task 99') && i.message.includes('does not exist'))).toBe(true);
  });

  it('errors when task depends on a later task', () => {
    const plan = `---
adapter: claude
gates:
  - npm test
---

## Task 1: Setup
Scope: src/setup/
Depends on: 2
Done when:
  - file:src/setup/index.ts

## Task 2: Build
Scope: src/build/
Done when:
  - file:src/build/index.ts
`;
    const { issues } = parsePlan(plan);
    expect(issues.some((i) => i.type === 'error' && i.message.includes('comes after it'))).toBe(true);
  });

  it('is valid when task depends on an earlier task', () => {
    const plan = `---
adapter: claude
gates:
  - npm test
---

## Task 1: Setup
Scope: src/setup/
Done when:
  - file:src/setup/index.ts

## Task 2: Build
Scope: src/build/
Depends on: 1
Done when:
  - file:src/build/index.ts
`;
    const { issues } = parsePlan(plan);
    const depErrors = issues.filter((i) => i.type === 'error' && i.field?.includes('dependsOn'));
    expect(depErrors).toHaveLength(0);
  });

  it('suppresses scope overlap warning when dependency is declared', () => {
    const plan = `---
adapter: claude
gates:
  - npm test
---

## Task 1: First
Scope: src/shared/
Done when:
  - file:src/shared/a.ts

## Task 2: Second
Scope: src/shared/
Depends on: 1
Done when:
  - file:src/shared/b.ts
`;
    const { issues } = parsePlan(plan);
    // overlap warning should NOT fire because task 2 declares Depends on: 1
    expect(issues.filter((i) => i.field === 'scope_overlap')).toHaveLength(0);
  });
});

describe('parsePlan — implied dependency detection', () => {
  it('warns when scope overlaps without a declared dependency', () => {
    const plan = `---
adapter: claude
gates:
  - npm test
---

## Task 1: Create model
Scope: src/models/
Done when:
  - file:src/models/widget.ts

## Task 2: Create service
Scope: src/models/
Done when:
  - file:src/models/widget-service.ts
`;
    const { issues } = parsePlan(plan);
    expect(issues.some((i) => i.type === 'warning' && i.message.includes('Depends on: 1'))).toBe(true);
  });

  it('does not warn when overlapping scope has declared dependency', () => {
    const plan = `---
adapter: claude
gates:
  - npm test
---

## Task 1: Create model
Scope: src/models/
Done when:
  - file:src/models/widget.ts

## Task 2: Extend model
Scope: src/models/
Depends on: 1
Done when:
  - file:src/models/widget-service.ts
`;
    const { issues } = parsePlan(plan);
    const impliedWarnings = issues.filter((i) => i.message.includes('Depends on: 1'));
    expect(impliedWarnings).toHaveLength(0);
  });
});

describe('slugFromTitle', () => {
  it('converts title to slug', () => {
    expect(slugFromTitle('Add JWT Authentication')).toBe('add-jwt-authentication');
    expect(slugFromTitle('Task 1: Add Rate Limiting')).toBe('task-1-add-rate-limiting');
    expect(slugFromTitle('My Complex Feature (v2)!')).toBe('my-complex-feature-v2');
  });

  it('truncates long titles', () => {
    const long = 'A'.repeat(100);
    expect(slugFromTitle(long).length).toBeLessThanOrEqual(50);
  });
});
