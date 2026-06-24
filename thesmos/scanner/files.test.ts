// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  findLargeFiles,
  findRiskyFiles,
  findStoreFiles,
  findTestFiles,
  findScriptFiles,
  findSharedUiFiles,
  findDesignSystemFiles,
  findEnvFiles,
  findClientBoundaryRisks,
  type FileEntry,
} from './files';

function entry(path: string, lines: number): FileEntry {
  return { path, lines };
}

describe('findLargeFiles', () => {
  it('excludes files at or below threshold', () => {
    const entries = [entry('a.ts', 300), entry('b.ts', 299)];
    expect(findLargeFiles(entries, 300)).toHaveLength(0);
  });

  it('includes files above threshold', () => {
    const entries = [entry('a.ts', 301), entry('b.ts', 150)];
    expect(findLargeFiles(entries, 300)).toHaveLength(1);
    expect(findLargeFiles(entries, 300)[0].file).toBe('a.ts');
  });

  it('sorts by lines descending', () => {
    const entries = [entry('a.ts', 400), entry('b.ts', 900), entry('c.ts', 600)];
    const result = findLargeFiles(entries, 0);
    expect(result.map((f) => f.lines)).toEqual([900, 600, 400]);
  });

  it('sorts by file name when lines are equal', () => {
    const entries = [entry('z.ts', 500), entry('a.ts', 500)];
    const result = findLargeFiles(entries, 0);
    expect(result[0].file).toBe('a.ts');
    expect(result[1].file).toBe('z.ts');
  });

  it('returns empty array when no files exceed threshold', () => {
    expect(findLargeFiles([entry('a.ts', 10)], 300)).toHaveLength(0);
  });

  it('maps FileEntry to LargeFile shape', () => {
    const result = findLargeFiles([entry('foo.ts', 500)], 300);
    expect(result[0]).toEqual({ file: 'foo.ts', lines: 500 });
  });
});

describe('findRiskyFiles', () => {
  it('returns empty when patterns is empty', () => {
    expect(findRiskyFiles(['any/file.ts'], [])).toHaveLength(0);
  });

  it('matches files by regex pattern', () => {
    const paths = ['migrations/001.sql', 'src/app.ts', 'scripts/seed.ts'];
    const result = findRiskyFiles(paths, ['migrations/.*\\.sql']);
    expect(result).toEqual(['migrations/001.sql']);
  });

  it('matches multiple patterns', () => {
    const paths = ['migrations/001.sql', 'scripts/seed.ts', 'src/app.ts'];
    const result = findRiskyFiles(paths, ['migrations/', 'scripts/']);
    expect(result).toContain('migrations/001.sql');
    expect(result).toContain('scripts/seed.ts');
  });

  it('silently ignores invalid regex patterns', () => {
    expect(() => findRiskyFiles(['a.ts'], ['[invalid('])).not.toThrow();
  });

  it('returns sorted results', () => {
    const paths = ['z.ts', 'a.ts', 'm.ts'];
    const result = findRiskyFiles(paths, ['.*\\.ts']);
    expect(result).toEqual(['a.ts', 'm.ts', 'z.ts']);
  });
});

describe('findStoreFiles', () => {
  it('matches *.store.ts files', () => {
    expect(findStoreFiles(['auth.store.ts', 'index.ts'])).toContain('auth.store.ts');
  });

  it('matches files inside stores/ directory', () => {
    expect(findStoreFiles(['stores/auth.ts', 'src/app.ts'])).toContain('stores/auth.ts');
  });

  it('matches store/ directory (singular)', () => {
    expect(findStoreFiles(['store/index.ts'])).toContain('store/index.ts');
  });

  it('matches slice files', () => {
    expect(findStoreFiles(['features/auth/authSlice.ts'])).toContain('features/auth/authSlice.ts');
  });

  it('does not match unrelated files', () => {
    expect(findStoreFiles(['components/Button.tsx', 'lib/utils.ts'])).toHaveLength(0);
  });

  it('returns sorted results', () => {
    const paths = ['stores/z.ts', 'stores/a.ts'];
    expect(findStoreFiles(paths)).toEqual(['stores/a.ts', 'stores/z.ts']);
  });
});

describe('findTestFiles', () => {
  it('matches *.test.ts files', () => {
    expect(findTestFiles(['foo.test.ts'])).toContain('foo.test.ts');
  });

  it('matches *.spec.tsx files', () => {
    expect(findTestFiles(['Button.spec.tsx'])).toContain('Button.spec.tsx');
  });

  it('matches files inside __tests__ directory', () => {
    expect(findTestFiles(['src/__tests__/util.ts'])).toContain('src/__tests__/util.ts');
  });

  it('does not match non-test files', () => {
    expect(findTestFiles(['src/app.ts', 'lib/utils.tsx'])).toHaveLength(0);
  });

  it('returns sorted results', () => {
    const paths = ['z.test.ts', 'a.test.ts'];
    expect(findTestFiles(paths)).toEqual(['a.test.ts', 'z.test.ts']);
  });
});

describe('findScriptFiles', () => {
  it('matches files under scripts/', () => {
    expect(findScriptFiles(['scripts/seed.ts', 'src/app.ts'])).toEqual(['scripts/seed.ts']);
  });

  it('does not match scripts in other directories', () => {
    expect(findScriptFiles(['src/scripts/helper.ts'])).toHaveLength(0);
  });

  it('returns sorted results', () => {
    const paths = ['scripts/z.ts', 'scripts/a.ts'];
    expect(findScriptFiles(paths)).toEqual(['scripts/a.ts', 'scripts/z.ts']);
  });
});

describe('findSharedUiFiles', () => {
  it('matches components/ui/ directory', () => {
    const paths = ['components/ui/Button.tsx', 'components/Header.tsx'];
    expect(findSharedUiFiles(paths)).toEqual(['components/ui/Button.tsx']);
  });

  it('matches ui/ root directory', () => {
    expect(findSharedUiFiles(['ui/Card.tsx', 'src/app.ts'])).toContain('ui/Card.tsx');
  });

  it('matches shared/components/', () => {
    expect(findSharedUiFiles(['shared/components/Modal.tsx'])).toContain('shared/components/Modal.tsx');
  });

  it('matches src/components/ui/', () => {
    expect(findSharedUiFiles(['src/components/ui/Input.tsx'])).toContain('src/components/ui/Input.tsx');
  });

  it('does not match regular component directories', () => {
    expect(findSharedUiFiles(['components/Header.tsx', 'src/components/Page.tsx'])).toHaveLength(0);
  });

  it('returns sorted results', () => {
    const paths = ['components/ui/Z.tsx', 'components/ui/A.tsx'];
    expect(findSharedUiFiles(paths)).toEqual(['components/ui/A.tsx', 'components/ui/Z.tsx']);
  });
});

describe('findDesignSystemFiles', () => {
  it('matches files with "theme" in the path', () => {
    expect(findDesignSystemFiles(['styles/theme.ts', 'src/app.ts'])).toContain('styles/theme.ts');
  });

  it('matches styles/ directory', () => {
    expect(findDesignSystemFiles(['styles/globals.css'])).toContain('styles/globals.css');
  });

  it('matches tokens/ directory', () => {
    expect(findDesignSystemFiles(['tokens/colors.ts'])).toContain('tokens/colors.ts');
  });

  it('matches design-tokens in path', () => {
    expect(findDesignSystemFiles(['lib/design-tokens.ts'])).toContain('lib/design-tokens.ts');
  });

  it('matches design-system in path', () => {
    expect(findDesignSystemFiles(['design-system/index.ts'])).toContain('design-system/index.ts');
  });

  it('does not match unrelated files', () => {
    expect(findDesignSystemFiles(['src/app.ts', 'lib/utils.ts'])).toHaveLength(0);
  });

  it('returns sorted results', () => {
    const paths = ['tokens/z.ts', 'tokens/a.ts'];
    expect(findDesignSystemFiles(paths)).toEqual(['tokens/a.ts', 'tokens/z.ts']);
  });
});

describe('findEnvFiles', () => {
  it('matches .env file', () => {
    expect(findEnvFiles(['.env', 'src/app.ts'])).toContain('.env');
  });

  it('matches .env.local', () => {
    expect(findEnvFiles(['.env.local'])).toContain('.env.local');
  });

  it('matches .env.production', () => {
    expect(findEnvFiles(['.env.production'])).toContain('.env.production');
  });

  it('matches .env.example', () => {
    expect(findEnvFiles(['.env.example'])).toContain('.env.example');
  });

  it('does not match files with env in the name but no dot prefix', () => {
    expect(findEnvFiles(['src/env.ts', 'lib/environment.ts'])).toHaveLength(0);
  });

  it('returns sorted results', () => {
    const paths = ['.env.production', '.env.local', '.env'];
    expect(findEnvFiles(paths)).toEqual(['.env', '.env.local', '.env.production']);
  });
});

describe('findClientBoundaryRisks', () => {
  it('returns empty when no use-client files', () => {
    const files = [{ path: 'lib/server.ts', content: "import 'server-only';" }];
    expect(findClientBoundaryRisks(files)).toHaveLength(0);
  });

  it('detects admin-client risk', () => {
    const content = `'use client'\nimport { admin } from 'lib/supabase/admin';`;
    const result = findClientBoundaryRisks([{ path: 'components/Bad.tsx', content }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ file: 'components/Bad.tsx', risk: 'admin-client' });
  });

  it('detects server-only import risk', () => {
    const content = `'use client'\nimport 'server-only';`;
    const result = findClientBoundaryRisks([{ path: 'components/Bad.tsx', content }]);
    expect(result[0].risk).toBe('server-only-import');
  });

  it('detects next/headers import risk', () => {
    const content = `"use client"\nimport { cookies } from 'next/headers';`;
    const result = findClientBoundaryRisks([{ path: 'app/ClientComp.tsx', content }]);
    expect(result[0].risk).toBe('server-only-import');
  });

  it('detects direct env access risk', () => {
    const content = `'use client'\nconst url = process.env.NEXT_PUBLIC_URL;`;
    const result = findClientBoundaryRisks([{ path: 'components/Env.tsx', content }]);
    expect(result[0].risk).toBe('direct-env-access');
  });

  it('does not flag safe client components', () => {
    const content = `'use client'\nimport { useState } from 'react';`;
    expect(findClientBoundaryRisks([{ path: 'components/Safe.tsx', content }])).toHaveLength(0);
  });

  it('returns results sorted by file path', () => {
    const files = [
      { path: 'z/Bad.tsx', content: `'use client'\nimport 'server-only';` },
      { path: 'a/Bad.tsx', content: `'use client'\nimport 'server-only';` },
    ];
    const result = findClientBoundaryRisks(files);
    expect(result[0].file).toBe('a/Bad.tsx');
    expect(result[1].file).toBe('z/Bad.tsx');
  });
});
