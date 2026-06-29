// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Shared command context: root directory + loaded config.
 * I/O-bound — not unit tested directly; command handlers are thin wrappers.
 */
import { loadConfig } from '../../config.ts';
import type { ThesmosConfig } from '../../types.ts';

export interface CommandContext {
  root: string;
  config: ThesmosConfig;
}

export function createContext(): CommandContext {
  const root = process.cwd();
  const config = loadConfig(root);
  return { root, config };
}
