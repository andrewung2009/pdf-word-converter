import { describe, expect, it } from 'vitest';
import { formatPageList, parsePageSelection } from '../src/lib/pageRange';

describe('parsePageSelection', () => {
  it('parses ranges and individual pages', () => {
    const result = parsePageSelection('1-3, 5, 8-10');
    expect(result.ok).toBe(true);
    expect(result.pages).toEqual([1, 2, 3, 5, 8, 9, 10]);
    expect(result.label).toBe('1-3, 5, 8-10');
  });

  it('accepts spaces, en dashes, duplicates, and unsorted input', () => {
    const result = parsePageSelection(' 5, 1 – 3, 2, 5 ');
    expect(result.ok).toBe(true);
    expect(result.pages).toEqual([1, 2, 3, 5]);
    expect(result.label).toBe('1-3, 5');
  });

  it('rejects invalid and empty input', () => {
    expect(parsePageSelection('').ok).toBe(false);
    expect(parsePageSelection('   ').ok).toBe(false);
    expect(parsePageSelection('abc').ok).toBe(false);
    expect(parsePageSelection('1-').ok).toBe(false);
    expect(parsePageSelection('1.5').ok).toBe(false);
    expect(parsePageSelection('0').ok).toBe(false);
    expect(parsePageSelection('5-3').ok).toBe(false);
  });

  it('checks the total page count when known', () => {
    const valid = parsePageSelection('1-3', 3);
    expect(valid.ok).toBe(true);
    expect(valid.pages).toEqual([1, 2, 3]);

    const invalid = parsePageSelection('1-4', 3);
    expect(invalid.ok).toBe(false);
    expect(invalid.error).toContain('3 pages');
  });

  it('parses a single page', () => {
    expect(parsePageSelection('7')).toEqual({ ok: true, pages: [7], label: '7' });
  });
});

describe('formatPageList', () => {
  it('compresses consecutive pages into ranges', () => {
    expect(formatPageList([1, 2, 3, 5, 8, 9, 10])).toBe('1-3, 5, 8-10');
    expect(formatPageList([4, 2, 3])).toBe('2-4');
    expect(formatPageList([])).toBe('');
  });
});
