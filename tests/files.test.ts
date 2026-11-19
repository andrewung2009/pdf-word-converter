import { describe, expect, it } from 'vitest';
import { formatBytes, formatPages, getExtension, outputFilename, stripExtension } from '../src/lib/files';

describe('file helpers', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(18 * 1024 * 1024)).toBe('18 MB');
  });

  it('formats page counts', () => {
    expect(formatPages(1)).toBe('1 page');
    expect(formatPages(12)).toBe('12 pages');
  });

  it('reads extensions and strips them', () => {
    expect(getExtension('Report.FINAL.docx')).toBe('docx');
    expect(getExtension('no-extension')).toBe('');
    expect(stripExtension('Q3 budget.pdf')).toBe('Q3 budget');
  });

  it('builds output names in both directions', () => {
    expect(outputFilename('Q3 budget.docx', 'pdf')).toBe('Q3 budget.pdf');
    expect(outputFilename('Q3 budget.pdf', 'docx')).toBe('Q3 budget.docx');
    expect(outputFilename('.pdf', 'docx')).toBe('converted-document.docx');
  });
});
