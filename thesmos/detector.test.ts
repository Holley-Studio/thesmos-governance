// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  detectFramework,
  detectAuth,
  detectTestingFramework,
  detectDeployment,
  detectApiConvention,
  detectEnvVars,
  detectTypeScript,
  detectPackageManager,
  detectCssFramework,
  detectUiLibrary,
} from './detector';

describe('detectFramework', () => {
  it('returns next for Next.js projects', () => {
    expect(detectFramework({ dependencies: { next: '^14.0.0' } })).toBe('next');
  });

  it('returns vite for Vite + React projects', () => {
    expect(
      detectFramework({ devDependencies: { vite: '^5.0.0', react: '^18.0.0' } })
    ).toBe('vite');
  });

  it('returns remix for Remix projects', () => {
    expect(detectFramework({ dependencies: { remix: '^2.0.0' } })).toBe('remix');
  });

  it('returns unknown when no recognized framework', () => {
    expect(detectFramework({ dependencies: { lodash: '^4.0.0' } })).toBe('unknown');
  });

  it('prefers next over other matches', () => {
    expect(
      detectFramework({ dependencies: { next: '*', react: '*' } })
    ).toBe('next');
  });
});

describe('detectAuth', () => {
  it('returns supabase when @supabase/ssr is present', () => {
    expect(detectAuth({ dependencies: { '@supabase/ssr': '*' } }, [])).toBe('supabase');
  });

  it('returns supabase when @supabase/supabase-js is present', () => {
    expect(detectAuth({ dependencies: { '@supabase/supabase-js': '*' } }, [])).toBe('supabase');
  });

  it('returns next-auth when next-auth is present', () => {
    expect(detectAuth({ dependencies: { 'next-auth': '*' } }, [])).toBe('next-auth');
  });

  it('returns none when no auth library found', () => {
    expect(detectAuth({ dependencies: { react: '*' } }, [])).toBe('none');
  });
});

describe('detectTestingFramework', () => {
  it('returns vitest when vitest is in devDependencies', () => {
    expect(detectTestingFramework({ devDependencies: { vitest: '*' } })).toBe('vitest');
  });

  it('returns jest when jest is in devDependencies', () => {
    expect(detectTestingFramework({ devDependencies: { jest: '*' } })).toBe('jest');
  });

  it('returns none when no testing framework found', () => {
    expect(detectTestingFramework({ devDependencies: { eslint: '*' } })).toBe('none');
  });
});

describe('detectDeployment', () => {
  it('returns vercel when vercel.json is present', () => {
    expect(detectDeployment(['vercel.json', 'package.json'])).toBe('vercel');
  });

  it('returns netlify when netlify.toml is present', () => {
    expect(detectDeployment(['netlify.toml', 'package.json'])).toBe('netlify');
  });

  it('returns unknown when no deployment config found', () => {
    expect(detectDeployment(['package.json', 'tsconfig.json'])).toBe('unknown');
  });
});

describe('detectApiConvention', () => {
  it('returns next-app-router for app/api/***/route.ts pattern', () => {
    expect(detectApiConvention(['app/api/users/route.ts'])).toBe('next-app-router');
  });

  it('returns next-pages-router for pages/api/*.ts pattern', () => {
    expect(detectApiConvention(['pages/api/users.ts'])).toBe('next-pages-router');
  });

  it('prefers app-router over pages-router', () => {
    expect(
      detectApiConvention(['app/api/foo/route.ts', 'pages/api/bar.ts'])
    ).toBe('next-app-router');
  });

  it('returns unknown when no API files found', () => {
    expect(detectApiConvention(['components/Button.tsx'])).toBe('unknown');
  });
});

describe('detectEnvVars', () => {
  it('extracts variable names from bracket notation', () => {
    const files = [
      {
        path: 'lib/config.ts',
        content: "const url = process['env' as 'env']['MY_URL'];",
      },
    ];
    expect(detectEnvVars(files)).toEqual(['MY_URL']);
  });

  it('deduplicates across multiple files', () => {
    const files = [
      { path: 'lib/a.ts', content: "process['env' as 'env']['SHARED_KEY']" },
      { path: 'lib/b.ts', content: "process['env' as 'env']['SHARED_KEY']" },
    ];
    expect(detectEnvVars(files)).toEqual(['SHARED_KEY']);
  });

  it('returns sorted results', () => {
    const files = [
      {
        path: 'lib/foo.ts',
        content: "process['env' as 'env']['Z_VAR']\nprocess['env' as 'env']['A_VAR']",
      },
    ];
    const result = detectEnvVars(files);
    expect(result).toEqual(['A_VAR', 'Z_VAR']);
  });

  it('returns empty array when no env vars found', () => {
    const files = [{ path: 'lib/foo.ts', content: 'const x = 1;' }];
    expect(detectEnvVars(files)).toEqual([]);
  });
});

describe('detectFramework — extended', () => {
  it('returns nuxt for nuxt projects', () => {
    expect(detectFramework({ dependencies: { nuxt: '^3.0.0' } })).toBe('nuxt');
  });

  it('returns astro for astro projects', () => {
    expect(detectFramework({ dependencies: { astro: '^4.0.0' } })).toBe('astro');
  });

  it('returns sveltekit for @sveltejs/kit projects', () => {
    expect(detectFramework({ devDependencies: { '@sveltejs/kit': '*' } })).toBe('sveltekit');
  });

  it('returns express for express-only projects', () => {
    expect(detectFramework({ dependencies: { express: '^4.0.0' } })).toBe('express');
  });

  it('returns remix for @remix-run/react projects', () => {
    expect(
      detectFramework({ dependencies: { '@remix-run/react': '*', '@remix-run/node': '*' } })
    ).toBe('remix');
  });
});

describe('detectAuth — extended', () => {
  it('returns clerk when @clerk/nextjs is present', () => {
    expect(detectAuth({ dependencies: { '@clerk/nextjs': '*' } }, [])).toBe('clerk');
  });

  it('returns auth0 when auth0 is present', () => {
    expect(detectAuth({ dependencies: { auth0: '*' } }, [])).toBe('auth0');
  });

  it('returns lucia when lucia is present', () => {
    expect(detectAuth({ dependencies: { lucia: '*' } }, [])).toBe('lucia');
  });

  it('returns better-auth when better-auth is present', () => {
    expect(detectAuth({ dependencies: { 'better-auth': '*' } }, [])).toBe('better-auth');
  });

  it('returns next-auth when @auth/core is present', () => {
    expect(detectAuth({ dependencies: { '@auth/core': '*' } }, [])).toBe('next-auth');
  });

  it('falls back to auth0 via file list', () => {
    expect(detectAuth({}, ['lib/auth0-client.ts'])).toBe('auth0');
  });

  it('falls back to clerk via file list', () => {
    expect(detectAuth({}, ['lib/clerk-utils.ts'])).toBe('clerk');
  });
});

describe('detectTestingFramework — extended', () => {
  it('returns playwright when @playwright/test is present', () => {
    expect(detectTestingFramework({ devDependencies: { '@playwright/test': '*' } })).toBe('playwright');
  });

  it('returns vitest over jest when both present', () => {
    expect(
      detectTestingFramework({ devDependencies: { vitest: '*', jest: '*' } })
    ).toBe('vitest');
  });
});

describe('detectDeployment — extended', () => {
  it('returns railway when railway.toml is present', () => {
    expect(detectDeployment(['railway.toml'])).toBe('railway');
  });

  it('returns fly when fly.toml is present', () => {
    expect(detectDeployment(['fly.toml'])).toBe('fly');
  });

  it('returns other for Dockerfile', () => {
    expect(detectDeployment(['Dockerfile', 'src/index.ts'])).toBe('other');
  });

  it('returns vercel for .vercel/ directory', () => {
    expect(detectDeployment(['.vercel/output/config.json'])).toBe('vercel');
  });
});

describe('detectTypeScript', () => {
  it('returns true when typescript is a devDependency', () => {
    expect(detectTypeScript({ devDependencies: { typescript: '*' } }, [])).toBe(true);
  });

  it('returns true when tsconfig.json is in file list', () => {
    expect(detectTypeScript({}, ['tsconfig.json'])).toBe(true);
  });

  it('returns false when neither typescript dep nor tsconfig found', () => {
    expect(detectTypeScript({ dependencies: { react: '*' } }, ['index.js'])).toBe(false);
  });
});

describe('detectPackageManager', () => {
  it('returns bun when bun.lockb is present', () => {
    expect(detectPackageManager(['bun.lockb', 'package.json'])).toBe('bun');
  });

  it('returns pnpm when pnpm-lock.yaml is present', () => {
    expect(detectPackageManager(['pnpm-lock.yaml'])).toBe('pnpm');
  });

  it('returns yarn when yarn.lock is present', () => {
    expect(detectPackageManager(['yarn.lock'])).toBe('yarn');
  });

  it('returns npm when package-lock.json is present', () => {
    expect(detectPackageManager(['package-lock.json'])).toBe('npm');
  });

  it('returns unknown when no lock file found', () => {
    expect(detectPackageManager(['package.json'])).toBe('unknown');
  });

  it('prefers bun over pnpm when both present', () => {
    expect(detectPackageManager(['bun.lockb', 'pnpm-lock.yaml'])).toBe('bun');
  });
});

describe('detectCssFramework', () => {
  it('returns tailwind when tailwindcss is a dependency', () => {
    expect(detectCssFramework({ devDependencies: { tailwindcss: '*' } }, [])).toBe('tailwind');
  });

  it('returns tailwind when tailwind.config.ts is present', () => {
    expect(detectCssFramework({}, ['tailwind.config.ts'])).toBe('tailwind');
  });

  it('returns styled-components when present', () => {
    expect(detectCssFramework({ dependencies: { 'styled-components': '*' } }, [])).toBe('styled-components');
  });

  it('returns emotion when @emotion/react is present', () => {
    expect(detectCssFramework({ dependencies: { '@emotion/react': '*' } }, [])).toBe('emotion');
  });

  it('returns sass when sass is a dependency', () => {
    expect(detectCssFramework({ devDependencies: { sass: '*' } }, [])).toBe('sass');
  });

  it('returns css-modules when .module.css files are present', () => {
    expect(detectCssFramework({}, ['components/Button.module.css'])).toBe('css-modules');
  });

  it('returns none when no CSS framework detected', () => {
    expect(detectCssFramework({ dependencies: { react: '*' } }, [])).toBe('none');
  });
});

describe('detectUiLibrary', () => {
  it('returns shadcn when radix + class-variance-authority are present', () => {
    expect(
      detectUiLibrary({
        dependencies: {
          '@radix-ui/react-dialog': '*',
          'class-variance-authority': '*',
        },
      })
    ).toBe('shadcn');
  });

  it('returns radix when radix is present without cva', () => {
    expect(
      detectUiLibrary({ dependencies: { '@radix-ui/react-slot': '*' } })
    ).toBe('radix');
  });

  it('returns chakra when @chakra-ui/react is present', () => {
    expect(detectUiLibrary({ dependencies: { '@chakra-ui/react': '*' } })).toBe('chakra');
  });

  it('returns mantine when @mantine/core is present', () => {
    expect(detectUiLibrary({ dependencies: { '@mantine/core': '*' } })).toBe('mantine');
  });

  it('returns headless-ui when @headlessui/react is present', () => {
    expect(detectUiLibrary({ dependencies: { '@headlessui/react': '*' } })).toBe('headless-ui');
  });

  it('returns antd when antd is present', () => {
    expect(detectUiLibrary({ dependencies: { antd: '*' } })).toBe('antd');
  });

  it('returns mui when @mui/material is present', () => {
    expect(detectUiLibrary({ dependencies: { '@mui/material': '*' } })).toBe('mui');
  });

  it('returns none when no UI library found', () => {
    expect(detectUiLibrary({ dependencies: { react: '*' } })).toBe('none');
  });
});
