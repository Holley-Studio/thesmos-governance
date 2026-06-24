import { describe, it, expect } from 'vitest';
import {
  isTTY,
  formatQuestion,
  ynHint,
  formatSelectList,
  formatCheckboxList,
  type SelectOption,
} from './interactive.ts';

// All pure formatting helpers — no I/O

describe('formatQuestion', () => {
  it('formats without hint', () => {
    expect(formatQuestion('What is your name')).toBe('What is your name: ');
  });

  it('formats with hint', () => {
    expect(formatQuestion('Confirm', '[Y/n]')).toBe('Confirm [Y/n]: ');
  });
});

describe('ynHint', () => {
  it('returns [Y/n] when defaultYes is true', () => {
    expect(ynHint(true)).toBe('[Y/n]');
  });

  it('returns [y/N] when defaultYes is false', () => {
    expect(ynHint(false)).toBe('[y/N]');
  });
});

describe('formatSelectList', () => {
  const options: SelectOption[] = [
    { label: 'Alpha',   value: 'a' },
    { label: 'Beta',    value: 'b', description: 'second option' },
    { label: 'Gamma',   value: 'c' },
  ];

  it('numbers each option starting from 1', () => {
    const output = formatSelectList(options);
    expect(output).toContain('1)');
    expect(output).toContain('2)');
    expect(output).toContain('3)');
  });

  it('includes option labels', () => {
    const output = formatSelectList(options);
    expect(output).toContain('Alpha');
    expect(output).toContain('Beta');
  });

  it('includes descriptions when present', () => {
    const output = formatSelectList(options);
    expect(output).toContain('second option');
  });

  it('does not include description marker when absent', () => {
    const output = formatSelectList([{ label: 'Solo', value: 's' }]);
    expect(output).not.toContain('—');
  });
});

describe('formatCheckboxList', () => {
  const options: SelectOption[] = [
    { label: 'Claude', value: 'claude' },
    { label: 'Gemini', value: 'gemini' },
    { label: 'Cursor', value: 'cursor' },
  ];

  it('shows [x] for selected and [ ] for unselected', () => {
    const selected = new Set([0, 2]);
    const output = formatCheckboxList(options, selected);
    const lines = output.split('\n');
    expect(lines[0]).toContain('[x]');
    expect(lines[1]).toContain('[ ]');
    expect(lines[2]).toContain('[x]');
  });

  it('shows all unselected when set is empty', () => {
    const output = formatCheckboxList(options, new Set());
    expect(output).not.toContain('[x]');
  });

  it('shows all selected when all indices present', () => {
    const output = formatCheckboxList(options, new Set([0, 1, 2]));
    expect(output).not.toContain('[ ]');
  });
});

describe('isTTY', () => {
  it('returns a boolean', () => {
    expect(typeof isTTY()).toBe('boolean');
  });
});
