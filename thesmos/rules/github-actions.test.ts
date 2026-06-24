import { describe, it, expect } from 'vitest';
import { GITHUB_ACTIONS_RULES } from './github-actions';
import { CONFIG_DEFAULTS } from '../config';
import type { DetectInput, ScanResult } from '../types';

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
  pages: [],
  apiRoutes: [],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

function rule(id: string) {
  const r = GITHUB_ACTIONS_RULES.find((r) => r.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function detect(id: string, files: Array<{ path: string; content: string }>) {
  const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files };
  return rule(id).detect(input);
}

// ── GHA_001 — Script injection via untrusted GitHub context ──────────────

describe('GHA_001 — script injection via GitHub context', () => {
  it('fires when github.event.issue.body is used in a run block', () => {
    const findings = detect('GHA_001', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          'jobs:',
          '  build:',
          '    steps:',
          '      - name: Print issue',
          '        run: |',
          '          echo "${{ github.event.issue.body }}"',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('gha_script_injection');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires when github.event.pull_request.title is used in a run block', () => {
    const findings = detect('GHA_001', [
      {
        path: '.github/workflows/deploy.yml',
        content: [
          '    steps:',
          '      - name: Deploy',
          '        run: deploy --message "${{ github.event.pull_request.title }}"',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('gha_script_injection');
  });

  it('fires when github.event.comment.body is used in a run block', () => {
    const findings = detect('GHA_001', [
      {
        path: '.github/workflows/bot.yml',
        content: [
          '      - name: Process comment',
          '        run: |',
          '          process "${{ github.event.comment.body }}"',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when dangerous context is set as env var (not in run line itself)', () => {
    const findings = detect('GHA_001', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          '      - name: Safe step',
          '        env:',
          '          ISSUE_BODY: ${{ github.event.issue.body }}',
          '        run: echo "$ISSUE_BODY"',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-workflow files', () => {
    const findings = detect('GHA_001', [
      {
        path: 'src/deploy.sh',
        content: 'run: echo "${{ github.event.issue.body }}"',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when dangerous context appears outside any run block', () => {
    const findings = detect('GHA_001', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          '      - name: Use title',
          '        env:',
          '          TITLE: ${{ github.event.pull_request.title }}',
          '      - name: Some other step',
          '        uses: actions/checkout@main',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GHA_002 — pull_request_target with PR head checkout ──────────────────

describe('GHA_002 — pull_request_target with dangerous checkout', () => {
  it('fires when pull_request_target combined with PR head sha checkout', () => {
    const findings = detect('GHA_002', [
      {
        path: '.github/workflows/pr-checks.yml',
        content: [
          'on:',
          '  pull_request_target:',
          'jobs:',
          '  test:',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '        with:',
          '          ref: ${{ github.event.pull_request.head.sha }}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('gha_pull_request_target_checkout');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires when pull_request_target combined with PR head ref checkout', () => {
    const findings = detect('GHA_002', [
      {
        path: '.github/workflows/pr-checks.yml',
        content: [
          'on: pull_request_target',
          'jobs:',
          '  test:',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '        with:',
          '          ref: ${{ github.event.pull_request.head.ref }}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when pull_request_target without dangerous checkout', () => {
    const findings = detect('GHA_002', [
      {
        path: '.github/workflows/pr-checks.yml',
        content: [
          'on:',
          '  pull_request_target:',
          'jobs:',
          '  test:',
          '    steps:',
          '      - uses: actions/checkout@v4',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on pull_request (not _target) with head checkout', () => {
    const findings = detect('GHA_002', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          'on:',
          '  pull_request:',
          'jobs:',
          '  test:',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '        with:',
          '          ref: ${{ github.event.pull_request.head.sha }}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-workflow files', () => {
    const findings = detect('GHA_002', [
      {
        path: 'scripts/deploy.sh',
        content: 'pull_request_target\nref: ${{ github.event.pull_request.head.sha }}',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GHA_003 — permissions: write-all ─────────────────────────────────────

describe('GHA_003 — permissions: write-all', () => {
  it('fires on permissions: write-all at workflow level', () => {
    const findings = detect('GHA_003', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          'name: CI',
          'permissions: write-all',
          'jobs:',
          '  build:',
          '    runs-on: ubuntu-latest',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('gha_write_all_permissions');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on permissions: write-all at job level', () => {
    const findings = detect('GHA_003', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          'jobs:',
          '  deploy:',
          '    permissions: write-all',
          '    runs-on: ubuntu-latest',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on scoped permissions', () => {
    const findings = detect('GHA_003', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          'permissions:',
          '  contents: read',
          '  pull-requests: write',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-workflow files', () => {
    const findings = detect('GHA_003', [
      {
        path: 'config/settings.yml',
        content: 'permissions: write-all',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GHA_004 — unpinned action ─────────────────────────────────────────────

describe('GHA_004 — unpinned action (branch/tag reference)', () => {
  it('fires on uses: actions/checkout@v4', () => {
    const findings = detect('GHA_004', [
      {
        path: '.github/workflows/ci.yml',
        content: '      - uses: actions/checkout@v4',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('gha_unpinned_action');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires on uses: owner/repo@main', () => {
    const findings = detect('GHA_004', [
      {
        path: '.github/workflows/ci.yml',
        content: '      - uses: my-org/my-action@main',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on uses: third-party/action@latest', () => {
    const findings = detect('GHA_004', [
      {
        path: '.github/workflows/ci.yml',
        content: '      - uses: some-org/some-action@latest',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when pinned to a full SHA', () => {
    const findings = detect('GHA_004', [
      {
        path: '.github/workflows/ci.yml',
        content: '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af68e',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-workflow files', () => {
    const findings = detect('GHA_004', [
      {
        path: 'README.md',
        content: '      - uses: actions/checkout@v4',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GHA_005 — secrets echoed in run step ─────────────────────────────────

describe('GHA_005 — secrets logged via echo', () => {
  it('fires on echo with secrets.MY_TOKEN', () => {
    const findings = detect('GHA_005', [
      {
        path: '.github/workflows/ci.yml',
        content: '        run: echo "Token is ${{ secrets.MY_TOKEN }}"',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('gha_secrets_logged');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on bare echo of secrets.API_KEY', () => {
    const findings = detect('GHA_005', [
      {
        path: '.github/workflows/ci.yml',
        content: '        run: echo ${{ secrets.API_KEY }}',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when secret is passed as env var (not echoed)', () => {
    const findings = detect('GHA_005', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          '        env:',
          '          TOKEN: ${{ secrets.MY_TOKEN }}',
          '        run: deploy --token "$TOKEN"',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-workflow files', () => {
    const findings = detect('GHA_005', [
      {
        path: 'scripts/deploy.sh',
        content: 'echo ${{ secrets.MY_TOKEN }}',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GHA_006 — self-hosted runner with public trigger ─────────────────────

describe('GHA_006 — self-hosted runner with public contribution trigger', () => {
  it('fires on self-hosted runner with pull_request trigger', () => {
    const findings = detect('GHA_006', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          'on:',
          '  pull_request:',
          'jobs:',
          '  build:',
          '    runs-on: self-hosted',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('gha_self_hosted_runner');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on self-hosted runner with issue_comment trigger', () => {
    const findings = detect('GHA_006', [
      {
        path: '.github/workflows/bot.yml',
        content: [
          'on:',
          '  issue_comment:',
          'jobs:',
          '  respond:',
          '    runs-on: self-hosted',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on self-hosted with only push trigger', () => {
    const findings = detect('GHA_006', [
      {
        path: '.github/workflows/deploy.yml',
        content: [
          'on:',
          '  push:',
          '    branches: [main]',
          'jobs:',
          '  deploy:',
          '    runs-on: self-hosted',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on ubuntu-latest with pull_request trigger', () => {
    const findings = detect('GHA_006', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          'on:',
          '  pull_request:',
          'jobs:',
          '  build:',
          '    runs-on: ubuntu-latest',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-workflow files', () => {
    const findings = detect('GHA_006', [
      {
        path: 'Makefile',
        content: 'pull_request:\nruns-on: self-hosted',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GHA_007 — workflow inputs in run step ────────────────────────────────

describe('GHA_007 — workflow inputs interpolated directly into run:', () => {
  it('fires on inputs.environment used directly in run block', () => {
    const findings = detect('GHA_007', [
      {
        path: '.github/workflows/deploy.yml',
        content: [
          '      - name: Deploy',
          '        run: deploy --env ${{ inputs.environment }}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('gha_env_from_input');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on github.event.inputs.* in run block', () => {
    const findings = detect('GHA_007', [
      {
        path: '.github/workflows/release.yml',
        content: [
          '      - name: Tag release',
          '        run: git tag ${{ github.event.inputs.version }}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when input is assigned to env var (env block above run)', () => {
    const findings = detect('GHA_007', [
      {
        path: '.github/workflows/deploy.yml',
        content: [
          '      - name: Deploy',
          '        env:',
          '          DEPLOY_ENV: ${{ inputs.environment }}',
          '        run: deploy --env "$DEPLOY_ENV"',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when inputs appear in an env: block not in a run context', () => {
    const findings = detect('GHA_007', [
      {
        path: '.github/workflows/deploy.yml',
        content: [
          'env:',
          '  GLOBAL_ENV: ${{ inputs.environment }}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-workflow files', () => {
    const findings = detect('GHA_007', [
      {
        path: 'deploy.sh',
        content: 'run: deploy --env ${{ inputs.environment }}',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GHA_008 — upload-artifact path traversal ─────────────────────────────

describe('GHA_008 — artifact path containing GitHub context expression', () => {
  it('fires on upload-artifact path with ${{ expression }}', () => {
    const findings = detect('GHA_008', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          '      - uses: actions/upload-artifact@v4',
          '        with:',
          '          name: build',
          '          path: dist/${{ github.event.pull_request.head.ref }}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('gha_artifact_path_traversal');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires on upload-artifact path with github.sha in path', () => {
    const findings = detect('GHA_008', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          '      - uses: actions/upload-artifact@v4',
          '        with:',
          '          path: output/${{ github.sha }}/build',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when path is static', () => {
    const findings = detect('GHA_008', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          '      - uses: actions/upload-artifact@v4',
          '        with:',
          '          name: build-output',
          '          path: dist/',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on download-artifact (different action)', () => {
    const findings = detect('GHA_008', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          '      - uses: actions/download-artifact@v4',
          '        with:',
          '          path: dist/${{ github.sha }}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-workflow files', () => {
    const findings = detect('GHA_008', [
      {
        path: 'scripts/build.sh',
        content: 'uses: actions/upload-artifact@v4\npath: dist/${{ github.sha }}',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GHA_009 — mutable cache restore-keys ─────────────────────────────────

describe('GHA_009 — cache restore-keys ending with github.ref', () => {
  it('fires on restore-keys ending with ${{ github.ref }}', () => {
    const findings = detect('GHA_009', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          '      - uses: actions/cache@v4',
          '        with:',
          '          key: ${{ runner.os }}-node-${{ hashFiles("**/package-lock.json") }}',
          '          restore-keys: |',
          '            ${{ runner.os }}-node-${{ github.ref }}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('gha_cache_restore_key_mutable');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires when restore-keys line ends with github.ref', () => {
    const findings = detect('GHA_009', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          '          restore-keys: ${{ runner.os }}-${{ github.ref }}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on restore-keys with only static prefix', () => {
    const findings = detect('GHA_009', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          '          restore-keys: |',
          '            ${{ runner.os }}-node-',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on restore-keys with hash-based suffix', () => {
    const findings = detect('GHA_009', [
      {
        path: '.github/workflows/ci.yml',
        content: [
          '          restore-keys: |',
          '            ${{ runner.os }}-node-${{ hashFiles("package-lock.json") }}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-workflow files', () => {
    const findings = detect('GHA_009', [
      {
        path: 'cache-config.yml',
        content: 'restore-keys: |\n  ${{ runner.os }}-${{ github.ref }}',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GHA_010 — deprecated ::set-env / ::add-path commands ─────────────────

describe('GHA_010 — deprecated ::set-env:: and ::add-path:: commands', () => {
  it('fires on echo "::set-env name=..."', () => {
    const findings = detect('GHA_010', [
      {
        path: '.github/workflows/ci.yml',
        content: '        run: echo "::set-env name=MY_VAR::my_value"',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('gha_deprecated_set_env');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on echo "::add-path::..."', () => {
    const findings = detect('GHA_010', [
      {
        path: '.github/workflows/ci.yml',
        content: '        run: echo "::add-path::$HOME/bin"',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('gha_deprecated_set_env');
  });

  it('fires on ::set-env name=PATH in run script', () => {
    const findings = detect('GHA_010', [
      {
        path: '.github/workflows/setup.yml',
        content: [
          '      - name: Setup path',
          '        run: |',
          '          echo "::set-env name=PATH::$HOME/bin:$PATH"',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when using $GITHUB_ENV file correctly', () => {
    const findings = detect('GHA_010', [
      {
        path: '.github/workflows/ci.yml',
        content: '        run: echo "MY_VAR=value" >> $GITHUB_ENV',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-workflow files', () => {
    const findings = detect('GHA_010', [
      {
        path: 'scripts/setup.sh',
        content: 'echo "::set-env name=PATH::$HOME/bin:$PATH"',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});
