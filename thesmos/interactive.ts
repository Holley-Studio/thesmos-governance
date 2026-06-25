/**
 * Lightweight interactive prompts for the Thesmos CLI.
 *
 * Uses Node.js built-in readline — no external dependencies.
 * All prompts write to process.stdout and read from process.stdin by default,
 * but both streams are injectable for testability.
 *
 * Design:
 *   - Pure formatting helpers (no I/O)
 *   - I/O entry points return Promises
 *   - Gracefully handles non-TTY (CI) environments
 */

import { createInterface, type Interface } from 'node:readline';
import { type Writable, type Readable } from 'node:stream';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelectOption<T = string> {
  label: string;
  value: T;
  description?: string;
}

export interface PromptOptions {
  input?: Readable;
  output?: Writable;
}

// ── TTY detection ─────────────────────────────────────────────────────────────

/** Returns true when running in a real interactive terminal. */
export function isTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

// ── Pure formatting ───────────────────────────────────────────────────────────

/** Format a question with a prompt character. */
export function formatQuestion(question: string, hint?: string): string {
  return hint ? `${question} ${hint}: ` : `${question}: `;
}

/** Format a yes/no hint. */
export function ynHint(defaultYes: boolean): string {
  return defaultYes ? '[Y/n]' : '[y/N]';
}

/** Format a numbered list of options for display. */
export function formatSelectList<T>(options: SelectOption<T>[]): string {
  return options
    .map((o, i) => {
      const num  = `  ${i + 1})`.padEnd(6);
      const desc = o.description ? `  — ${o.description}` : '';
      return `${num}${o.label}${desc}`;
    })
    .join('\n');
}

/** Format a checkbox list with current selection state. */
export function formatCheckboxList<T>(options: SelectOption<T>[], selected: Set<number>): string {
  return options
    .map((o, i) => {
      const box  = selected.has(i) ? '[x]' : '[ ]';
      const num  = `  ${i + 1})`.padEnd(6);
      const desc = o.description ? `  — ${o.description}` : '';
      return `${num}${box} ${o.label}${desc}`;
    })
    .join('\n');
}

// ── readline factory ──────────────────────────────────────────────────────────

function makeRl(opts: PromptOptions): Interface {
  return createInterface({
    input:  opts.input  ?? process.stdin,
    output: opts.output ?? process.stdout,
    terminal: false,
  });
}

function writeLine(output: Writable, text: string): void {
  output.write(text);
}

// ── Prompt primitives ─────────────────────────────────────────────────────────

/** Prompt for a free-text answer. Returns the trimmed input. */
export function prompt(
  question: string,
  defaultValue?: string,
  opts: PromptOptions = {},
): Promise<string> {
  return new Promise((resolve) => {
    const output = opts.output ?? process.stdout;
    const hint   = defaultValue ? `(${defaultValue})` : undefined;
    writeLine(output, formatQuestion(question, hint));

    const rl = makeRl(opts);
    rl.once('line', (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
    rl.once('close', () => resolve(defaultValue || ''));
  });
}

/** Prompt for yes/no. Returns a boolean. */
export function confirm(
  question: string,
  defaultYes = true,
  opts: PromptOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const output = opts.output ?? process.stdout;
    writeLine(output, formatQuestion(question, ynHint(defaultYes)));

    const rl = makeRl(opts);
    rl.once('line', (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (!trimmed) return resolve(defaultYes);
      resolve(trimmed === 'y' || trimmed === 'yes');
    });
    rl.once('close', () => resolve(defaultYes));
  });
}

/**
 * Present a numbered list and ask the user to pick one.
 * Returns the selected option's value.
 */
export async function select<T>(
  question: string,
  options: SelectOption<T>[],
  opts: PromptOptions = {},
): Promise<T> {
  const output = opts.output ?? process.stdout;
  writeLine(output, `\n${question}\n`);
  writeLine(output, formatSelectList(options) + '\n');

  while (true) {
    const answer = await prompt(`Choose 1–${options.length}`, String(1), opts);
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < options.length) {
      return options[idx].value;
    }
    writeLine(output, `Please enter a number between 1 and ${options.length}.\n`);
  }
}

/**
 * Present a numbered checklist and ask the user to toggle items.
 * Returns the values of all selected options.
 *
 * Input format: comma-separated numbers or ranges (e.g. "1,2,4" or "all" or "none").
 * Items can be pre-selected via defaultSelected.
 */
export async function multiSelect<T>(
  question: string,
  options: SelectOption<T>[],
  defaultSelected: number[] = [],
  opts: PromptOptions = {},
): Promise<T[]> {
  const output  = opts.output ?? process.stdout;
  const selected = new Set<number>(defaultSelected);

  writeLine(output, `\n${question}\n`);
  writeLine(output, formatCheckboxList(options, selected) + '\n');
  writeLine(output, 'Enter numbers to toggle (e.g. "1,3"), "all", or "none". Press Enter to confirm.\n');

  while (true) {
    const answer = await prompt('Selection', '', opts);

    if (!answer) break;

    if (answer.toLowerCase() === 'all') {
      options.forEach((_, i) => selected.add(i));
    } else if (answer.toLowerCase() === 'none') {
      selected.clear();
    } else {
      for (const part of answer.split(',')) {
        const idx = parseInt(part.trim(), 10) - 1;
        if (idx >= 0 && idx < options.length) {
          if (selected.has(idx)) selected.delete(idx);
          else selected.add(idx);
        }
      }
    }

    writeLine(output, '\n' + formatCheckboxList(options, selected) + '\n');
    writeLine(output, 'Press Enter to confirm, or continue toggling.\n');
  }

  return options.filter((_, i) => selected.has(i)).map((o) => o.value);
}
