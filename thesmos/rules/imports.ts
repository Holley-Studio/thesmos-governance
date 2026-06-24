import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, TS_EXT, isTestPath, isCommentLine } from './helpers';

export const IMPORT_RULES: ThesmosRule[] = [
  {
    id: 'IMPORT_001',
    category: 'barrel_import_performance',
    description: 'Importing from barrel files (index.ts) prevents tree-shaking and inflates bundle size.',
    severity: 'MEDIUM',
    tags: ['imports', 'performance', 'bundler'],
    sinceVersion: '3.0.0',
    explain: {
      why: "import { Button } from '@/components' (barrel) forces the bundler to load all components even if only Button is used. import { Button } from '@/components/Button' allows tree-shaking.",
      commonViolations: ["import { Button, Card, Modal } from '@/components'", "import { useAuth } from '@/hooks'"],
      goodExample: "import { Button } from '@/components/Button/Button'",
      badExample: "import { Button } from '@/components'  // entire components barrel loaded",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('barrel_import_performance', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/import\s*\{[^}]{30,}\}\s*from\s*['"]@\/(?:components|hooks|utils|lib)['"]/.test(line)) {
            findings.push({ severity, category: 'barrel_import_performance', file: path, line: i + 1, message: 'Importing many items from a barrel file — prevents tree-shaking.', suggestion: 'Import directly from the source file to enable tree-shaking.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_002',
    category: 'circular_import',
    description: 'Circular imports (A imports B, B imports A) cause initialization order bugs and are a design smell.',
    severity: 'HIGH',
    tags: ['imports', 'architecture', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'When A and B import each other, one module sees the other as {} at runtime due to unresolved initialization order. This produces "X is undefined" errors that are extremely hard to debug.',
      commonViolations: ['// a.ts imports from b.ts while b.ts imports from a.ts'],
      goodExample: '// Extract shared types/utilities to a third module (c.ts) that both A and B import',
      badExample: '// userService.ts imports from authService.ts\n// authService.ts imports from userService.ts — circular!',
      relatedPlaybooks: ['architecture.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('circular_import', config.severityRules);
      const findings: Finding[] = [];
      const importMap = new Map<string, Set<string>>();
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const imports = new Set<string>();
        const lines = content.split('\n');
        for (const line of lines) {
          const m = line.match(/^import[^'"]+from\s*['"]([^'"]+)['"]/);
          if (m && !m[1]!.startsWith('.')) continue;
          if (m) imports.add(m[1]!);
        }
        importMap.set(path, imports);
      }
      for (const [fileA, importsA] of importMap) {
        for (const [fileB, importsB] of importMap) {
          if (fileA === fileB) continue;
          const aImportsB = [...importsA].some(i => fileB.includes(i.replace('../', '').replace('./', '')));
          const bImportsA = [...importsB].some(i => fileA.includes(i.replace('../', '').replace('./', '')));
          if (aImportsB && bImportsA) {
            findings.push({ severity, category: 'circular_import', file: fileA, message: `Possible circular import detected between ${fileA} and ${fileB}.`, suggestion: 'Extract shared dependencies to a third module that both files import.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_003',
    category: 'import_side_effects',
    description: "Side-effect imports (import './polyfill') without comments are confusing to readers and bundlers.",
    severity: 'LOW',
    tags: ['imports', 'quality'],
    sinceVersion: '3.0.0',
    explain: {
      why: "import './sideEffect' imports that run code without exporting anything are confusing. Future developers will try to remove the \"unused\" import and break functionality. Always document why.",
      commonViolations: ["import './polyfills'", "import 'reflect-metadata'"],
      goodExample: "import 'reflect-metadata'  // required for tsyringe decorator support",
      badExample: "import './setup'  // why? what does this do?",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('import_side_effects', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^import\s+['"][^'"]+['"]\s*;?\s*$/.test(line) && !line.includes('//')) {
            findings.push({ severity, category: 'import_side_effects', file: path, line: i + 1, message: 'Side-effect import without comment explaining its purpose.', suggestion: "Add a comment: import 'reflect-metadata'  // required for DI decorators." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_004',
    category: 'import_star_namespace',
    description: "import * as X prevents tree-shaking and makes it unclear which exports are actually used.",
    severity: 'MEDIUM',
    tags: ['imports', 'performance', 'bundler'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'import * as utils bundles the entire utils module even if only one function is used. Named imports tell bundlers exactly which exports to keep.',
      commonViolations: ["import * as _ from 'lodash'", "import * as utils from '@/utils'"],
      goodExample: "import { debounce, throttle } from 'lodash-es'",
      badExample: "import * as _ from 'lodash'  // bundles entire 70KB lodash",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('import_star_namespace', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/import\s+\*\s+as\s+\w+\s+from\s+['"](?!node:)/.test(line)) {
            findings.push({ severity, category: 'import_star_namespace', file: path, line: i + 1, message: 'Namespace import (import * as X) prevents tree-shaking.', suggestion: 'Use named imports: import { specificThing } from "module".' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_005',
    category: 'server_module_in_client',
    description: "Importing server-only modules (node:fs, node:crypto, prisma) in client-side components leaks them to the browser bundle.",
    severity: 'BLOCKER',
    tags: ['imports', 'security', 'nextjs'],
    sinceVersion: '3.0.0',
    explain: {
      why: "In Next.js App Router, importing 'node:fs' or '@prisma/client' inside a component file without 'use server' causes the bundler to include it in the browser bundle, exposing server internals or crashing (Node.js modules don't run in browsers).",
      commonViolations: ["'use client'\nimport { prisma } from '@/lib/prisma'", "'use client'\nimport { readFileSync } from 'node:fs'"],
      goodExample: "// Move database access to a Server Action or API route\nasync function getData() { 'use server'; return prisma.post.findMany() }",
      badExample: "'use client'\nimport { prisma } from '@/lib/prisma'  // Prisma shipped to browser bundle",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('server_module_in_client', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx|ts|js)$/.test(path)) continue;
        if (!content.includes("'use client'") && !content.includes('"use client"')) continue;
        const SERVER_MODULES = /from\s+['"](?:node:|@prisma\/client|better-sqlite3|bcrypt|argon2|jsonwebtoken)/;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (SERVER_MODULES.test(line)) {
            findings.push({ severity, category: 'server_module_in_client', file: path, line: i + 1, message: 'Server-only module imported in a "use client" file — bundles to the browser.', suggestion: 'Move this logic to a Server Action, API route, or server component.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_006',
    category: 'dynamic_require_in_esm',
    description: 'require() calls in ES modules are not available at runtime unless using a CJS interop shim.',
    severity: 'HIGH',
    tags: ['imports', 'esm', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'In native ESM (type: "module" in package.json), require is undefined. Using require() causes "require is not defined" at runtime. Use import() for dynamic loading.',
      commonViolations: ['const config = require("./config")', 'const mod = require(dynamicPath)'],
      goodExample: "const config = await import('./config.js')",
      badExample: "const mod = require(moduleName)  // ReferenceError in ESM context",
      relatedPlaybooks: ['esm-migration.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('dynamic_require_in_esm', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\brequire\s*\(\s*(?!['"][^'"]+['"]\s*\)\s*\.)\w/.test(line)) {
            findings.push({ severity, category: 'dynamic_require_in_esm', file: path, line: i + 1, message: 'Dynamic require() in potential ESM context — use await import() instead.', suggestion: "const mod = await import('./module.js') for dynamic imports in ESM." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_007',
    category: 'missing_ts_extension',
    description: 'Relative imports without .js extension fail in native ESM Node.js environments.',
    severity: 'HIGH',
    tags: ['imports', 'esm', 'typescript'],
    sinceVersion: '3.0.0',
    explain: {
      why: "TypeScript compiles .ts to .js but doesn't rewrite import paths. In ESM (Node.js native), import './utils' fails because there's no ./utils file — you must write import './utils.js' (even though the source is .ts).",
      commonViolations: ["import { helper } from './utils'", "import type { Foo } from './types'"],
      goodExample: "import { helper } from './utils.js'\nimport type { Foo } from './types.js'",
      badExample: "import { helper } from './utils'  // fails in Node.js ESM",
      relatedPlaybooks: ['esm-migration.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_ts_extension', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^import\s+(?:type\s+)?\{[^}]+\}\s+from\s+['"]\.\.?\/[^'"]+['"]/.test(line)) {
            if (!line.includes('.js') && !line.includes('.json') && !line.includes('.css') && !line.includes('.svg')) {
              findings.push({ severity, category: 'missing_ts_extension', file: path, line: i + 1, message: 'Relative import without .js extension — fails in native ESM Node.js.', suggestion: "Add .js extension: import { X } from './module.js' (TypeScript resolves to .ts at build time)." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_008',
    category: 'lodash_full_import',
    description: "import _ from 'lodash' loads the entire library. Use lodash-es named imports or per-method packages.",
    severity: 'MEDIUM',
    tags: ['imports', 'performance', 'bundle-size'],
    sinceVersion: '3.0.0',
    explain: {
      why: "lodash is 70KB minified (30KB gzipped). If you only need debounce, import { debounce } from 'lodash-es' (tree-shakable). Or use lodash/debounce for CommonJS.",
      commonViolations: ["import _ from 'lodash'", "import { debounce } from 'lodash'"],
      goodExample: "import { debounce } from 'lodash-es'  // tree-shakable ESM version",
      badExample: "import _ from 'lodash'  // 70KB for one function",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('lodash_full_import', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/from\s+['"]lodash['"]/.test(line) && !line.includes('lodash-es') && !line.includes('lodash/')) {
            findings.push({ severity, category: 'lodash_full_import', file: path, line: i + 1, message: "Importing from 'lodash' loads the full 70KB bundle.", suggestion: "Use 'lodash-es' for tree-shaking: import { debounce } from 'lodash-es'." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_009',
    category: 'moment_import',
    description: "moment.js is 67KB minified and unmaintained. Use date-fns or Temporal instead.",
    severity: 'MEDIUM',
    tags: ['imports', 'performance', 'dependencies'],
    sinceVersion: '3.0.0',
    explain: {
      why: "moment.js bundles all locales (67KB), is mutable (causes bugs), and has been in maintenance mode since 2021. The team recommends migrating to date-fns (tree-shakable), dayjs (2KB), or the Temporal API.",
      commonViolations: ["import moment from 'moment'", "const moment = require('moment')"],
      goodExample: "import { format, addDays } from 'date-fns'  // tree-shakable, immutable",
      badExample: "import moment from 'moment'  // 67KB bundle, mutable, maintenance mode",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('moment_import', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/from\s+['"]moment['"]\s*$/.test(line) || /require\s*\(\s*['"]moment['"]\s*\)/.test(line)) {
            findings.push({ severity, category: 'moment_import', file: path, line: i + 1, message: "moment.js is 67KB and in maintenance mode.", suggestion: "Migrate to date-fns (tree-shakable), dayjs (2KB), or the native Temporal API." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_010',
    category: 'client_env_in_server',
    description: "NEXT_PUBLIC_ env vars should not be used in server-side code — they expose client-facing values as server config.",
    severity: 'MEDIUM',
    tags: ['imports', 'nextjs', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: "NEXT_PUBLIC_ vars are inlined at build time and shipped to the browser. Using them server-side accidentally documents your public surface in your server logic, and may use wrong values in SSR vs. client renders.",
      commonViolations: ['process.env.NEXT_PUBLIC_API_URL  // in a server action'],
      goodExample: 'process.env.INTERNAL_API_URL  // private, server-only',
      badExample: 'const apiUrl = process.env.NEXT_PUBLIC_API_URL  // in server code — use private env var',
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('client_env_in_server', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (content.includes("'use client'") || content.includes('"use client"')) return findings;
        if (!path.includes('app/') && !path.includes('pages/api') && !path.includes('server') && !path.includes('action')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/process\.env\.NEXT_PUBLIC_/.test(line)) {
            findings.push({ severity, category: 'client_env_in_server', file: path, line: i + 1, message: 'NEXT_PUBLIC_ env var used in server-side code — use a private env var instead.', suggestion: 'Create a private env var (without NEXT_PUBLIC_ prefix) for server-only configuration.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_011',
    category: 'test_lib_in_production',
    description: "Test utilities (vitest, jest, msw) imported in non-test production files inflate the bundle.",
    severity: 'HIGH',
    tags: ['imports', 'testing', 'bundle-size'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Accidentally importing jest.fn() or vi.mock() in production code includes test framework runtime in the browser bundle, adding hundreds of KB and potentially breaking non-test environments.',
      commonViolations: ["import { vi } from 'vitest'  // in production code", "import { expect } from 'vitest'"],
      goodExample: '// Test utilities only in *.test.ts / *.spec.ts files',
      badExample: "import { vi } from 'vitest'  // in src/lib/utils.ts — ships to production",
      relatedPlaybooks: ['testing.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('test_lib_in_production', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/from\s+['"](?:vitest|jest|@testing-library|msw)['"]/.test(line)) {
            findings.push({ severity, category: 'test_lib_in_production', file: path, line: i + 1, message: 'Test library imported in production file — ships to production bundle.', suggestion: 'Move test utilities to *.test.ts or *.spec.ts files only.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_012',
    category: 'type_only_import_missing',
    description: "Type-only imports without the 'type' keyword include the module at runtime, bloating the bundle.",
    severity: 'LOW',
    tags: ['imports', 'typescript', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: "import { Foo } from './foo' where Foo is only a type causes TypeScript to emit a real JS import. import type { Foo } from './foo' is erased at compile time, reducing bundle size.",
      commonViolations: ["import { SomeType } from './types'", "import { ApiResponse } from './api'"],
      goodExample: "import type { SomeType } from './types.js'",
      badExample: "import { SomeType } from './types'  // type import at runtime costs bundle size",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('type_only_import_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^import\s+\{[^}]+\}\s+from\s+['"][^'"]+types['"]/.test(line) && !line.includes('import type')) {
            findings.push({ severity, category: 'type_only_import_missing', file: path, line: i + 1, message: "Type import from 'types' file without 'import type' keyword — emitted at runtime.", suggestion: "Use 'import type { Foo } from \"./types.js\"' to erase at compile time." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_013',
    category: 'deep_relative_import',
    description: 'Deep relative imports (../../../lib/utils) are brittle and break on file moves.',
    severity: 'LOW',
    tags: ['imports', 'architecture', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Three or more levels of ../../../ makes imports fragile — move the file one level and half the codebase breaks. Configure path aliases (@/lib/utils) for stable absolute-like imports.',
      commonViolations: ["import { helper } from '../../../lib/utils'", "from '../../../../shared/types'"],
      goodExample: "import { helper } from '@/lib/utils'\n// tsconfig.json: { paths: { '@/*': ['./src/*'] } }",
      badExample: "import { formatDate } from '../../../../utils/date'  // breaks on file moves",
      relatedPlaybooks: ['architecture.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('deep_relative_import', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/from\s+['"](?:\.\.\/){3,}/.test(line)) {
            findings.push({ severity, category: 'deep_relative_import', file: path, line: i + 1, message: 'Deep relative import (3+ levels) — fragile on file moves.', suggestion: "Configure path aliases in tsconfig.json: \"@/*\": [\"./src/*\"] and use import from '@/lib/utils'." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_014',
    category: 'default_export_large_module',
    description: 'Default exports from large modules cannot be tree-shaken — use named exports for utility modules.',
    severity: 'LOW',
    tags: ['imports', 'performance', 'bundler'],
    sinceVersion: '3.0.0',
    explain: {
      why: "export default { fn1, fn2, fn3 } or export default class LargeUtils includes everything when anyone imports it. Named exports allow bundlers to include only what is used.",
      commonViolations: ['export default { format, parse, validate, transform }  // utils object'],
      goodExample: 'export { format, parse, validate, transform }  // named — tree-shakable',
      badExample: 'export default { format, parse }  // importing format also bundles parse',
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('default_export_large_module', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!path.includes('util') && !path.includes('helper') && !path.includes('lib/')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^export\s+default\s+\{/.test(line)) {
            findings.push({ severity, category: 'default_export_large_module', file: path, line: i + 1, message: 'Default export of object in utility module — prevents tree-shaking.', suggestion: 'Use named exports: export { fn1, fn2 } for each utility function.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_015',
    category: 'enum_import_increases_bundle',
    description: "TypeScript const enums imported across module boundaries don't inline in all bundlers, causing duplicate code.",
    severity: 'LOW',
    tags: ['imports', 'typescript', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Regular TypeScript enums emit JavaScript runtime objects. Importing an enum from a .d.ts declaration file with 'const enum' causes esbuild and some bundlers to error or duplicate the values. Prefer union types or as const objects.",
      commonViolations: ['enum Status { Active, Inactive }  // emits runtime object'],
      goodExample: "const Status = { Active: 'active', Inactive: 'inactive' } as const;\ntype Status = typeof Status[keyof typeof Status];",
      badExample: 'enum Status { Active, Inactive }  // runtime object — cannot be optimized away',
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('enum_import_increases_bundle', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/^(?:export\s+)?enum\s+\w+\s*\{/.test(line)) {
            findings.push({ severity, category: 'enum_import_increases_bundle', file: path, line: i + 1, message: 'TypeScript enum emits runtime object — consider as const object for better bundler optimization.', suggestion: "const Status = { Active: 'active' } as const; type Status = typeof Status[keyof typeof Status]." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_016',
    category: 'crypto_browser_incompatible',
    description: "Importing Node.js 'node:crypto' in code that runs in browsers causes build failures or silent bugs.",
    severity: 'HIGH',
    tags: ['imports', 'compatibility', 'node'],
    sinceVersion: '3.0.0',
    explain: {
      why: "node:crypto is unavailable in browsers. Importing it in shared code (utils/, lib/) that may be bundled for the browser fails at runtime or build time depending on the bundler config.",
      commonViolations: ["import crypto from 'node:crypto'  // in utils/token.ts used by both client and server"],
      goodExample: "// For browser crypto: globalThis.crypto (Web Crypto API, available everywhere)\n// For server-only: import { randomBytes } from 'node:crypto'  // in server-only files",
      badExample: "import { randomBytes } from 'node:crypto'  // shared file bundled to browser",
      relatedPlaybooks: ['esm-migration.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('crypto_browser_incompatible', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (path.includes('server') || path.includes('api/') || path.includes('actions/')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/from\s+['"]node:crypto['"]/.test(line) && !content.includes("'use server'")) {
            findings.push({ severity, category: 'crypto_browser_incompatible', file: path, line: i + 1, message: "node:crypto imported in a file that may run in the browser.", suggestion: "Use globalThis.crypto (Web Crypto API) for browser-compatible cryptography, or mark file 'use server'." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_017',
    category: 'json_import_untyped',
    description: "import data from './file.json' without 'assert { type: \"json\" }' may fail in strict ESM environments.",
    severity: 'LOW',
    tags: ['imports', 'esm', 'typescript'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Node.js 17+ experimental JSON imports and some bundlers require assert { type: 'json' } (now with import). Without it, the import may fail or be typed as any.",
      commonViolations: ["import config from './config.json'"],
      goodExample: "import config from './config.json' with { type: 'json' }  // Stage 4 proposal",
      badExample: "import data from './data.json'  // may fail in strict ESM environments",
      relatedPlaybooks: ['esm-migration.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('json_import_untyped', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^import\s+\w+\s+from\s+['"][^'"]+\.json['"]\s*;?\s*$/.test(line) && !line.includes('assert') && !line.includes('with')) {
            findings.push({ severity, category: 'json_import_untyped', file: path, line: i + 1, message: 'JSON import without type assertion — may fail in strict ESM or Node.js 17+.', suggestion: "Add import attribute: import data from './data.json' with { type: 'json' }." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_018',
    category: 'react_import_unnecessary',
    description: "import React from 'react' is unnecessary with React 17+ JSX transform.",
    severity: 'LOW',
    tags: ['imports', 'react', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: "React 17 introduced the automatic JSX transform that no longer requires React to be in scope. import React from 'react' is now dead code in most setups. It can be removed.",
      commonViolations: ["import React from 'react'"],
      goodExample: "// No React import needed with jsxRuntime: 'automatic' in tsconfig",
      badExample: "import React from 'react'  // unnecessary with React 17+ automatic JSX transform",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('react_import_unnecessary', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^import\s+React\s+from\s+['"]react['"]/.test(line) && !content.includes('React.') && !content.includes('React,')) {
            findings.push({ severity, category: 'react_import_unnecessary', file: path, line: i + 1, message: "import React from 'react' is unnecessary with React 17+ automatic JSX transform.", suggestion: "Remove this import if you don't use React.* APIs directly. Enable jsxRuntime: 'automatic' in tsconfig." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_019',
    category: 'polyfill_import_scope',
    description: "Importing polyfills in shared modules pollutes all consumers. Import them only at the app entry point.",
    severity: 'MEDIUM',
    tags: ['imports', 'performance', 'compatibility'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Polyfills like core-js, whatwg-fetch, or reflect-metadata have global side effects. Importing them in shared utilities means they are applied in any context that imports the utility — test runners, server-side code, etc.",
      commonViolations: ["import 'core-js/stable'  // in src/lib/utils.ts"],
      goodExample: "// Only in src/index.tsx (app entry point)\nimport 'core-js/stable'",
      badExample: "// In src/lib/api.ts:\nimport 'whatwg-fetch'  // global polyfill in shared module",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('polyfill_import_scope', config.severityRules);
      const findings: Finding[] = [];
      const POLYFILLS = /from\s+['"](?:core-js|whatwg-fetch|cross-fetch\/polyfill|reflect-metadata)['"]/;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (path.includes('index.') || path.includes('main.') || path.includes('entry.')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (POLYFILLS.test(line)) {
            findings.push({ severity, category: 'polyfill_import_scope', file: path, line: i + 1, message: 'Polyfill imported in a shared module — pollutes all consumers.', suggestion: 'Move polyfill imports to the application entry point (index.ts / main.ts).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'IMPORT_020',
    category: 'unused_import',
    description: 'Unused imports add noise, increase parse time, and may cause false positives in dependency analyzers.',
    severity: 'LOW',
    tags: ['imports', 'quality', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Unused imports are dead code. They slow the parser, confuse new developers, and may keep modules from being garbage-collected by bundlers. Enable noUnusedLocals in tsconfig.json.',
      commonViolations: ["import { useState } from 'react'  // useState never used in file"],
      goodExample: '// Enable in tsconfig.json: "noUnusedLocals": true',
      badExample: "import { useEffect, useState } from 'react'  // useEffect unused in this file",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('unused_import', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const importMatches = [...content.matchAll(/^import\s+type?\s*\{([^}]+)\}\s*from/gm)];
        for (const match of importMatches) {
          const lineIdx = content.slice(0, match.index).split('\n').length - 1;
          const imported = match[1]!.split(',').map(s => s.trim().split(' as ')[0]!.trim()).filter(Boolean);
          for (const name of imported) {
            if (!name) continue;
            const rest = content.replace(match[0]!, '');
            const usage = new RegExp(`\\b${name}\\b`);
            if (!usage.test(rest)) {
              findings.push({ severity, category: 'unused_import', file: path, line: lineIdx + 1, message: `'${name}' is imported but never used.`, suggestion: `Remove '${name}' from the import, or enable "noUnusedLocals": true in tsconfig.json.` });
            }
          }
        }
      }
      return findings;
    },
  },
];
