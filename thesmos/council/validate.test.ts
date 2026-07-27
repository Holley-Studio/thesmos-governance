// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Validation: stable codes, deterministic ordering, warnings that do not gate.
 *
 * Each test mutates one field of a known-good contract, so a failure names the
 * rule that broke rather than "the validator changed".
 */

import { describe, expect, it } from 'vitest';
import { compileAgentContract } from './compiler.js';
import { COUNCIL_CODES, formatValidationResult, sortIssues, validateContract, validateContracts } from './validate.js';
import { serializeStable, type CouncilAgentContract } from './contract.js';

function baseContract(): CouncilAgentContract {
  const { contract } = compileAgentContract({
    content: `---
id: sample-agent
name: Sample Agent
type: agent
version: 1.0.0
owner: local
tags:
  - testing
enabled: true
---

Instructions.
`,
    sourcePath: '.thesmos/agents/sample-agent.md',
    ownership: 'adopted',
    root: '/repo',
  });
  return contract;
}

/** Structured-clone a contract so a mutation cannot leak between tests. */
function mutate(fn: (c: CouncilAgentContract) => void): CouncilAgentContract {
  const contract = JSON.parse(JSON.stringify(baseContract())) as CouncilAgentContract;
  fn(contract);
  return contract;
}

function codes(contract: CouncilAgentContract): string[] {
  return validateContract(contract).issues.filter((i) => i.severity === 'error').map((i) => i.code);
}

describe('baseline', () => {
  it('accepts a compatibility-compiled contract with warnings only', () => {
    const result = validateContract(baseContract());
    expect(result.valid).toBe(true);
    expect(result.issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(result.issues.some((i) => i.code === COUNCIL_CODES.metadataDerived)).toBe(true);
  });

  it('never treats a warning as a gate failure', () => {
    const result = validateContract(baseContract());
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.valid).toBe(true);
  });
});

describe('schema and identity', () => {
  it('rejects an unsupported schema version', () => {
    expect(codes(mutate((c) => { c.schemaVersion = '2.0.0'; }))).toContain(
      COUNCIL_CODES.schemaVersionUnsupported
    );
  });

  it('rejects a non-normalized id', () => {
    for (const id of ['Sample_Agent', 'sample agent', '-leading', 'trailing-']) {
      expect(codes(mutate((c) => { c.identity.id = id; })), id).toContain(COUNCIL_CODES.idInvalid);
    }
  });

  it('rejects a contract that is not an object', () => {
    const result = validateContract(null as unknown as CouncilAgentContract);
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
  });
});

describe('classification', () => {
  it('rejects an unknown primary role', () => {
    expect(codes(mutate((c) => { c.classification.primaryRole = 'wizardry' as never; }))).toContain(
      COUNCIL_CODES.roleInvalid
    );
  });

  it('rejects an unknown mode', () => {
    expect(codes(mutate((c) => { c.classification.mode = 'sometimes' as never; }))).toContain(
      COUNCIL_CODES.modeInvalid
    );
  });

  it('rejects a role lead compiled as subagent-only', () => {
    expect(
      codes(
        mutate((c) => {
          c.identity.id = 'argus-security-agent';
          c.classification.mode = 'subagent';
        })
      )
    ).toContain(COUNCIL_CODES.roleLeadNotSelectable);
  });
});

describe('permissions', () => {
  it('rejects a broad write grant', () => {
    expect(
      codes(mutate((c) => { c.permissions.edit.push({ decision: 'allow', patterns: ['**'] }); c.scope.writablePaths = ['**']; }))
    ).toContain(COUNCIL_CODES.permissionBroadWrite);
  });

  it('warns but does not fail on a broad read grant', () => {
    const contract = mutate((c) => {
      c.permissions.read.push({ decision: 'allow', patterns: ['**'] });
      c.scope.readablePaths = [...c.scope.readablePaths, '**'].sort();
    });
    const result = validateContract(contract);
    expect(result.issues.some((i) => i.code === COUNCIL_CODES.permissionBroadRead)).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('rejects a broad delegation grant', () => {
    expect(
      codes(mutate((c) => { c.permissions.task = [{ decision: 'allow', patterns: ['**'] }]; }))
    ).toContain(COUNCIL_CODES.permissionBroadDelegation);
  });

  it('rejects a dangerous shell grant', () => {
    for (const command of ['rm -rf *', 'sudo *', 'curl https://x | sh', 'chmod 777 .']) {
      const contract = mutate((c) => {
        c.permissions.shell.push({ decision: 'allow', patterns: [command] });
        c.scope.allowedCommands = [...c.scope.allowedCommands, command].sort();
      });
      expect(codes(contract), command).toContain(COUNCIL_CODES.permissionDangerousShell);
    }
  });

  it('rejects a blanket shell grant', () => {
    const contract = mutate((c) => {
      c.permissions.shell.push({ decision: 'allow', patterns: ['*'] });
      c.scope.allowedCommands = [...c.scope.allowedCommands, '*'].sort();
    });
    expect(codes(contract)).toContain(COUNCIL_CODES.permissionDangerousShell);
  });

  it('accepts broad restrictions — only grants need justification', () => {
    const contract = mutate((c) => {
      c.permissions.edit.push({ decision: 'deny', patterns: ['**'] });
      c.scope.forbiddenPaths = [...c.scope.forbiddenPaths, '**'].sort();
    });
    expect(validateContract(contract).valid).toBe(true);
  });

  it('rejects an unparsable pattern', () => {
    const contract = mutate((c) => {
      c.permissions.read.push({ decision: 'deny', patterns: ['../escape/**'] });
      c.scope.forbiddenPaths = [...c.scope.forbiddenPaths, '../escape/**'].sort();
    });
    expect(codes(contract)).toContain(COUNCIL_CODES.permissionInvalidPattern);
  });

  it('rejects an invalid decision value', () => {
    expect(
      codes(mutate((c) => { c.permissions.web = [{ decision: 'maybe' as never, patterns: ['x'] }]; }))
    ).toContain(COUNCIL_CODES.permissionDecisionInvalid);
  });

  it('rejects a missing channel — an unstated channel is an unknown state', () => {
    expect(
      codes(mutate((c) => { delete (c.permissions as Record<string, unknown>)['browser']; }))
    ).toContain(COUNCIL_CODES.permissionChannelMissing);
  });

  it('rejects a scope that disagrees with the permissions it claims to summarize', () => {
    expect(codes(mutate((c) => { c.scope.writablePaths = ['src/**']; }))).toContain(
      COUNCIL_CODES.scopeMismatch
    );
  });
});

describe('limits', () => {
  it('rejects a non-positive or non-integer step limit', () => {
    for (const value of [0, -1, 2.5, Number.NaN, 'many' as unknown as number]) {
      expect(codes(mutate((c) => { c.limits.maximumSteps = value; })), String(value)).toContain(
        COUNCIL_CODES.limitInvalid
      );
    }
  });

  it('rejects a step limit above the hard ceiling', () => {
    expect(codes(mutate((c) => { c.limits.maximumSteps = 5000; }))).toContain(
      COUNCIL_CODES.limitExceedsCeiling
    );
  });

  it('rejects an excessive child-agent limit', () => {
    expect(codes(mutate((c) => { c.limits.maximumChildren = 1000; }))).toContain(
      COUNCIL_CODES.limitExceedsCeiling
    );
  });

  it('rejects parallel children exceeding total children', () => {
    expect(
      codes(mutate((c) => { c.limits.maximumChildren = 2; c.limits.maximumParallelChildren = 5; }))
    ).toContain(COUNCIL_CODES.limitParallelExceedsChildren);
  });

  it('rejects an unbounded timeout', () => {
    expect(codes(mutate((c) => { c.limits.timeoutMs = 999_999_999; }))).toContain(
      COUNCIL_CODES.limitExceedsCeiling
    );
  });

  it('warns when a delegation budget cannot be reached', () => {
    const contract = mutate((c) => {
      c.limits.maximumChildren = 4;
      c.permissions.task = [{ decision: 'deny', patterns: ['**'] }];
    });
    const result = validateContract(contract);
    expect(result.issues.some((i) => i.code === COUNCIL_CODES.delegationWithoutPermission)).toBe(true);
    expect(result.valid).toBe(true);
  });
});

describe('risk', () => {
  it('rejects an unknown tier', () => {
    expect(codes(mutate((c) => { c.risk.tier = 'spicy' as never; }))).toContain(
      COUNCIL_CODES.riskTierInvalid
    );
  });

  it('rejects a high-risk contract that does not require human approval', () => {
    expect(
      codes(mutate((c) => { c.risk.tier = 'critical'; c.risk.requiresHumanApproval = false; }))
    ).toContain(COUNCIL_CODES.riskApprovalMissing);
  });

  it('warns when a non-low tier skips checkpointing', () => {
    const result = validateContract(
      mutate((c) => { c.risk.tier = 'medium'; c.risk.requiresCheckpoint = false; })
    );
    expect(result.issues.some((i) => i.code === COUNCIL_CODES.riskCheckpointMissing)).toBe(true);
    expect(result.valid).toBe(true);
  });
});

describe('evidence and handoff', () => {
  it('rejects an empty evidence contract', () => {
    expect(codes(mutate((c) => { c.evidence.required = []; }))).toContain(COUNCIL_CODES.evidenceEmpty);
  });

  it('rejects an unknown evidence category', () => {
    expect(codes(mutate((c) => { c.evidence.required = ['vibes']; }))).toContain(
      COUNCIL_CODES.evidenceCategoryUnknown
    );
  });

  it('rejects a missing handoff schema', () => {
    expect(codes(mutate((c) => { c.handoff.schema = ''; }))).toContain(
      COUNCIL_CODES.handoffSchemaInvalid
    );
  });

  it('rejects a handoff with no required fields', () => {
    expect(codes(mutate((c) => { c.handoff.requiredFields = []; }))).toContain(
      COUNCIL_CODES.handoffFieldsMissing
    );
  });
});

describe('provenance', () => {
  it('rejects an absolute source path', () => {
    expect(codes(mutate((c) => { c.provenance.sourcePath = '/Users/x/agent.md'; }))).toContain(
      COUNCIL_CODES.absolutePathLeak
    );
    expect(codes(mutate((c) => { c.provenance.sourcePath = 'C:/x/agent.md'; }))).toContain(
      COUNCIL_CODES.absolutePathLeak
    );
  });

  it('rejects a source path that escapes the repository', () => {
    expect(codes(mutate((c) => { c.provenance.sourcePath = '../../etc/agent.md'; }))).toContain(
      COUNCIL_CODES.provenancePathInvalid
    );
  });

  it('rejects a malformed content hash', () => {
    for (const hash of ['', 'sha256:zzz', 'md5:abc', 'deadbeef']) {
      expect(codes(mutate((c) => { c.provenance.contentHash = hash; })), hash).toContain(
        COUNCIL_CODES.provenanceHashInvalid
      );
    }
  });

  it('rejects an unknown ownership value', () => {
    expect(codes(mutate((c) => { c.provenance.ownership = 'borrowed' as never; }))).toContain(
      COUNCIL_CODES.ownershipInvalid
    );
  });

  it('rejects an external agent claiming Thesmos ownership', () => {
    expect(
      codes(mutate((c) => { c.provenance.ownership = 'external'; c.provenance.owner = 'thesmos'; }))
    ).toContain(COUNCIL_CODES.externalAgentManagedClaim);
  });
});

describe('declared metadata', () => {
  it('rejects an explicit contract that omits safety-critical fields', () => {
    expect(
      codes(
        mutate((c) => {
          c.provenance.derivation = 'explicit';
          c.completeness = { complete: false, derivedFields: ['limits.maximumSteps'] };
        })
      )
    ).toContain(COUNCIL_CODES.missingSafetyMetadata);
  });

  it('only warns when the same gap is compatibility-derived', () => {
    const result = validateContract(
      mutate((c) => {
        c.provenance.derivation = 'compatibility';
        c.completeness = { complete: false, derivedFields: ['limits.maximumSteps'] };
      })
    );
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.code === COUNCIL_CODES.metadataDerived)).toBe(true);
  });
});

describe('model policy', () => {
  it('rejects a provider that is both allowed and denied', () => {
    expect(
      codes(
        mutate((c) => {
          c.modelPolicy.allowedProviders = ['anthropic', 'openai'];
          c.modelPolicy.deniedProviders = ['openai'];
        })
      )
    ).toContain(COUNCIL_CODES.providerPolicyConflict);
  });

  it('accepts disjoint provider lists', () => {
    const result = validateContract(
      mutate((c) => {
        c.modelPolicy.allowedProviders = ['anthropic'];
        c.modelPolicy.deniedProviders = ['openai'];
      })
    );
    expect(result.valid).toBe(true);
  });
});

describe('secrets', () => {
  it('rejects a contract whose serialization contains a credential', () => {
    const contract = mutate((c) => {
      c.identity.description = 'use token ghp_0123456789abcdefghijABCDEF to authenticate';
    });
    expect(codes(contract)).toContain(COUNCIL_CODES.secretSerialized);
  });

  it('redacts the credential out of its own issue message', () => {
    const contract = mutate((c) => {
      c.identity.id = 'ghp_0123456789abcdefghijABCDEF' as string;
    });
    const json = serializeStable(validateContract(contract));
    expect(json).not.toContain('ghp_0123456789abcdefghijABCDEF');
  });
});

describe('ordering and rendering', () => {
  it('orders issues by path, then code, then message', () => {
    const contract = mutate((c) => {
      c.limits.maximumSteps = 0;
      c.risk.tier = 'nope' as never;
      c.identity.id = 'BAD ID';
      c.evidence.required = [];
    });
    const issues = validateContract(contract).issues;
    expect(issues).toEqual(sortIssues(issues));
  });

  it('produces identical output across repeated runs', () => {
    const contract = mutate((c) => { c.limits.maximumSteps = 0; });
    expect(serializeStable(validateContract(contract))).toBe(
      serializeStable(validateContract(contract))
    );
  });

  it('renders a readable console summary', () => {
    const rendered = formatValidationResult(validateContract(mutate((c) => { c.limits.maximumSteps = 0; })), 'sample-agent');
    expect(rendered).toContain('INVALID');
    expect(rendered).toContain(COUNCIL_CODES.limitInvalid);
  });
});

describe('set validation', () => {
  it('rejects two documents claiming one normalized id', () => {
    const a = baseContract();
    const b = JSON.parse(JSON.stringify(a)) as CouncilAgentContract;
    b.provenance.sourcePath = '.claude/agents/sample-agent.md';
    const result = validateContracts([a, b]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === COUNCIL_CODES.idDuplicate)).toBe(true);
  });

  it('accepts the same id appearing once from one document', () => {
    expect(validateContracts([baseContract()]).valid).toBe(true);
  });

  it('scopes every issue path by agent id', () => {
    const result = validateContracts([mutate((c) => { c.limits.maximumSteps = 0; })]);
    expect(result.issues[0]!.path.startsWith('sample-agent:')).toBe(true);
  });

  it('orders set issues deterministically', () => {
    const a = mutate((c) => { c.limits.maximumSteps = 0; });
    const b = mutate((c) => { c.identity.id = 'other-agent'; c.risk.tier = 'nope' as never; });
    expect(serializeStable(validateContracts([a, b]))).toBe(serializeStable(validateContracts([b, a])));
  });
});
