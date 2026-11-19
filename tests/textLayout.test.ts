import { describe, expect, it } from 'vitest';
import {
  buildBlocks,
  clusterLines,
  detectAlignment,
  detectList,
  headingLevelFor,
  type RawTextItem,
  type TextLine,
} from '../src/converters/textLayout';

function line(
  text: string,
  x: number,
  endX: number,
  baseline: number,
  fontSize = 11,
  extra: Partial<TextLine> = {},
): TextLine {
  return {
    text,
    x,
    endX,
    baseline,
    fontSize,
    bold: false,
    italic: false,
    hasEOL: true,
    ...extra,
  };
}

function item(str: string, x: number, y: number, width: number, fontSize = 11): RawTextItem {
  return { str, x, y, width, fontSize, hasEOL: false };
}

describe('clusterLines', () => {
  it('groups items by baseline and inserts spaces between words', () => {
    const lines = clusterLines([
      item('Hello', 72, 100, 28),
      item('world', 104, 100, 28),
      item('Second line', 72, 116, 62),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('Hello world');
    expect(lines[1].text).toBe('Second line');
  });

  it('does not duplicate spaces already present in the PDF text', () => {
    const lines = clusterLines([item('Hello ', 72, 128, 33), item('world', 108, 128, 28)]);
    expect(lines[0].text).toBe('Hello world');
  });

  it('respects hasEOL when a line break is explicit', () => {
    const first = item('First', 72, 100, 30);
    first.hasEOL = true;
    const lines = clusterLines([first, item('Second', 72, 100, 40)]);
    expect(lines.map((entry) => entry.text)).toEqual(['First', 'Second']);
  });

  it('keeps font size and style hints', () => {
    const lines = clusterLines([
      { ...item('Bold text', 72, 100, 60, 18), fontName: 'Arial-BoldMT' },
      { ...item('italic', 72, 120, 26, 11), fontFamily: 'Arial-ItalicMT' },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].fontSize).toBeGreaterThan(11);
    expect(lines[0].bold).toBe(true);
    expect(lines[1].italic).toBe(true);
  });
});

describe('layout helpers', () => {
  it('detects centered and right-aligned lines', () => {
    expect(detectAlignment(line('Centered title', 240, 372, 100, 18), 612)).toBe('center');
    expect(detectAlignment(line('Right aligned', 480, 560, 120, 11), 612)).toBe('right');
    expect(detectAlignment(line('Left aligned', 72, 200, 140, 11), 612)).toBe('left');
  });

  it('detects bullet and numbered lists', () => {
    expect(detectList('• First item')).toMatchObject({ kind: 'bullet', text: 'First item' });
    expect(detectList('- Dashed item')).toMatchObject({ kind: 'bullet', text: 'Dashed item' });
    expect(detectList('1. First step')).toMatchObject({ kind: 'number', marker: '1.' });
    expect(detectList('A paragraph, not a list')).toBeNull();
  });

  it('finds headings by relative size and skips page numbers', () => {
    expect(headingLevelFor(line('Big title', 72, 200, 100, 22), 11)).toBe(1);
    expect(headingLevelFor(line('Section', 72, 200, 100, 16), 11)).toBe(2);
    expect(headingLevelFor(line('Smaller heading', 72, 200, 100, 13.5), 11)).toBe(3);
    expect(headingLevelFor(line('12', 300, 310, 100, 22), 11)).toBeNull();
    expect(headingLevelFor(line('Body text.', 72, 200, 100, 13), 11)).toBeNull();
  });
});

describe('buildBlocks', () => {
  it('creates headings, bullets, and merged paragraphs', () => {
    const { blocks, bodySize } = buildBlocks(
      [
        line('Sample document', 220, 392, 100, 20, { bold: true }),
        line('This is a slightly longer body paragraph that', 72, 520, 140, 11),
        line('continues on the next line.', 72, 300, 156, 11),
        line('• A bullet point', 72, 200, 172, 11),
        line('• Another bullet', 72, 180, 188, 11),
      ],
      612,
    );

    expect(bodySize).toBe(11);
    expect(blocks[0]).toMatchObject({ kind: 'heading', headingLevel: 1, alignment: 'center' });
    expect(blocks[1].kind).toBe('paragraph');
    expect(blocks[1].text).toBe('This is a slightly longer body paragraph that continues on the next line.');
    expect(blocks[2]).toMatchObject({ kind: 'bullet', text: 'A bullet point' });
    expect(blocks[3]).toMatchObject({ kind: 'bullet', text: 'Another bullet' });
  });

  it('keeps large vertical gaps as new paragraphs', () => {
    const { blocks } = buildBlocks(
      [
        line('First paragraph.', 72, 200, 100, 11),
        line('Second paragraph after a gap.', 72, 300, 150, 11),
      ],
      612,
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[1].spaceBefore).toBeGreaterThan(20);
  });

  it('joins hyphenated wrapped lines without a space', () => {
    const { blocks } = buildBlocks(
      [
        line('This is an inter-', 72, 250, 100, 11),
        line('national example.', 72, 250, 113, 11),
      ],
      612,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('This is an international example.');
  });
});
