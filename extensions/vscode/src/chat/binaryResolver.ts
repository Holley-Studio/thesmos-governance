// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Shared CLI binary resolution for agent subprocesses (claude, codex, …).
 * The extension host is often launched from Finder/Dock without the user's
 * shell PATH, so checking PATH alone is not enough — fall back to common
 * install locations, then to the login shell.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const cache = new Map<string, string>();

export function resolveBinary(name: string, extraCandidates: string[] = []): string {
  const cached = cache.get(name);
  if (cached) return cached;

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, name))) {
      cache.set(name, join(dir, name));
      return cache.get(name)!;
    }
  }

  const home = homedir();
  const candidates = [
    join(home, '.local', 'bin', name),
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    ...extraCandidates,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cache.set(name, candidate);
      return candidate;
    }
  }

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const found = execFileSync(shell, ['-lc', `command -v ${name}`], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim().split('\n')[0];
    if (found) {
      cache.set(name, found);
      return found;
    }
  } catch {
    // Shell lookup failed — fall through to the bare name.
  }
  return name;
}
