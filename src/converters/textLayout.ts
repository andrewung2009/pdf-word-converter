export interface RawTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontName?: string;
  fontFamily?: string;
  hasEOL?: boolean;
}

export interface TextLine {
  text: string;
  x: number;
  endX: number;
  baseline: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  hasEOL: boolean;
}

export type Alignment = 'left' | 'center' | 'right';
export type BlockKind = 'paragraph' | 'heading' | 'bullet' | 'number';

export interface TextBlock {
  kind: BlockKind;
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  alignment: Alignment;
  headingLevel?: 1 | 2 | 3;
  marker?: string;
  spaceBefore: number;
  spaceAfter: number;
  top: number;
  bottom: number;
}

export interface BuildBlocksResult {
  blocks: TextBlock[];
  bodySize: number;
}

interface SizedWeight {
  size: number;
  weight: number;
}

export function weightedMedian(items: SizedWeight[], fallback = 11): number {
  if (!items.length) return fallback;
  const sorted = [...items].filter((item) => Number.isFinite(item.size) && item.size > 0).sort((a, b) => a.size - b.size);
  if (!sorted.length) return fallback;
  const total = sorted.reduce((sum, item) => sum + Math.max(1, item.weight), 0);
  let seen = 0;
  for (const item of sorted) {
    seen += Math.max(1, item.weight);
    if (seen * 2 >= total) return item.size;
  }
  return sorted[sorted.length - 1].size;
}

function normaliseText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\u00ad/g, '\u00ad');
}

function looksBold(item: RawTextItem): boolean {
  const name = `${item.fontName ?? ''} ${item.fontFamily ?? ''}`;
  return /bold|black|heavy|semibold|demi|extra-?bold|ultra-?bold|\b[789]00\b/i.test(name);
}

function looksItalic(item: RawTextItem): boolean {
  const name = `${item.fontName ?? ''} ${item.fontFamily ?? ''}`;
  return /italic|oblique/i.test(name);
}

function lineFromItems(items: RawTextItem[]): TextLine | null {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let text = '';
  let previousEnd = Number.NEGATIVE_INFINITY;
  let previousSize = 0;
  let boldChars = 0;
  let italicChars = 0;
  let totalChars = 0;
  let x = Number.POSITIVE_INFINITY;
  let endX = Number.NEGATIVE_INFINITY;

  for (const item of sorted) {
    const value = normaliseText(item.str);
    if (!value.trim()) {
      previousEnd = item.x + item.width;
      previousSize = item.fontSize;
      continue;
    }

    const startsWithSpace = /^\s/.test(value);
    const previousEndsWithSpace = /\s$/.test(text);
    if (text && !startsWithSpace && !previousEndsWithSpace) {
      const gap = item.x - previousEnd;
      const threshold = Math.max(0.5, Math.min(previousSize || item.fontSize, item.fontSize) * 0.16);
      if (gap > threshold) text += ' ';
    }

    text += value;
    totalChars += value.trim().length;
    if (looksBold(item)) boldChars += value.trim().length;
    if (looksItalic(item)) italicChars += value.trim().length;
    x = Math.min(x, item.x);
    endX = Math.max(endX, item.x + item.width);
    previousEnd = item.x + item.width;
    previousSize = item.fontSize;
  }

  const cleaned = text.replace(/[ \t]+/g, ' ').trim();
  if (!cleaned) return null;

  const fontSize = weightedMedian(
    sorted.map((item) => ({ size: item.fontSize, weight: Math.max(1, item.str.trim().length) })),
    11,
  );

  return {
    text: cleaned,
    x,
    endX,
    baseline: sorted.reduce((sum, item) => sum + item.y, 0) / sorted.length,
    fontSize,
    bold: totalChars > 0 && boldChars / totalChars >= 0.6,
    italic: totalChars > 0 && italicChars / totalChars >= 0.6,
    hasEOL: Boolean(sorted[sorted.length - 1]?.hasEOL),
  };
}

export function clusterLines(items: RawTextItem[]): TextLine[] {
  const usable = items.filter(
    (item) =>
      item &&
      typeof item.str === 'string' &&
      item.str.length > 0 &&
      Number.isFinite(item.x) &&
      Number.isFinite(item.y) &&
      Number.isFinite(item.fontSize) &&
      item.fontSize > 0,
  );
  if (!usable.length) return [];

  const sorted = [...usable].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextLine[] = [];
  let group: RawTextItem[] = [];
  let baseline = 0;
  let baseSize = 0;
  let forceBreak = true;

  const flushGroup = () => {
    if (!group.length) return;
    const line = lineFromItems(group);
    if (line) lines.push(line);
    group = [];
  };

  for (const item of sorted) {
    if (forceBreak && group.length) {
      flushGroup();
      forceBreak = false;
    }
    if (group.length === 0) {
      group = [item];
      baseline = item.y;
      baseSize = item.fontSize;
      forceBreak = Boolean(item.hasEOL);
      continue;
    }

    const tolerance = Math.max(1.6, Math.min(baseSize, item.fontSize) * 0.5);
    if (Math.abs(item.y - baseline) <= tolerance) {
      group.push(item);
      baseSize = Math.min(baseSize, item.fontSize);
      if (item.hasEOL) forceBreak = true;
    } else {
      flushGroup();
      group = [item];
      baseline = item.y;
      baseSize = item.fontSize;
      forceBreak = Boolean(item.hasEOL);
    }
  }
  flushGroup();

  return lines.sort((a, b) => a.baseline - b.baseline);
}

export function detectAlignment(line: TextLine, pageWidth: number): Alignment {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) return 'left';
  const width = line.endX - line.x;
  const leftSpace = line.x;
  const rightSpace = pageWidth - line.endX;
  const centered =
    Math.abs((line.x + line.endX) / 2 - pageWidth / 2) <= Math.max(8, pageWidth * 0.025) &&
    leftSpace > pageWidth * 0.1 &&
    rightSpace > pageWidth * 0.1 &&
    width < pageWidth * 0.7;

  if (centered) return 'center';
  if (rightSpace < pageWidth * 0.16 && leftSpace > pageWidth * 0.2 && width < pageWidth * 0.75) return 'right';
  return 'left';
}

export function headingLevelFor(line: TextLine, bodySize: number): 1 | 2 | 3 | null {
  if (!line.text.trim() || line.text.length > 160) return null;
  const ratio = line.fontSize / Math.max(1, bodySize);
  if (ratio < 1.18) return null;
  if (/^[\d\s.,/–—-]+$/.test(line.text)) return null;
  if (/[.!?;:]$/.test(line.text) && ratio < 1.5) return null;
  if (ratio >= 1.7) return 1;
  if (ratio >= 1.4) return 2;
  return 3;
}

interface ListInfo {
  kind: 'bullet' | 'number';
  text: string;
  marker: string;
}

const BULLET_RE = /^\s*([\u2022\u2023\u25e6\u25aa\u2027\u2219\u00b7\u25cf\u25cb\u25a0\u25a1\u2043]|[-–—*])\s+(.*)$/u;
const NUMBER_RE = /^\s*((?:\d{1,3}|[a-zA-Z]|[ivxlcdmIVXLCDM]{1,5})[.)])\s+(.*)$/u;

export function detectList(text: string): ListInfo | null {
  const bulletMatch = BULLET_RE.exec(text);
  if (bulletMatch && bulletMatch[2].trim()) {
    return { kind: 'bullet', text: bulletMatch[2].trim(), marker: bulletMatch[1] };
  }
  const numberMatch = NUMBER_RE.exec(text);
  if (numberMatch && numberMatch[2].trim()) {
    return { kind: 'number', text: text.trim(), marker: numberMatch[1] };
  }
  return null;
}

function mergeText(previous: string, next: string): string {
  if (previous.endsWith('\u00ad')) return previous.slice(0, -1) + next;
  if (/-$/.test(previous) && /^[a-z]/.test(next)) return previous.slice(0, -1) + next;
  return `${previous} ${next}`;
}

function spaceBefore(previous: TextLine | null, line: TextLine, foreignAlignment: boolean): number {
  if (!previous) return 0;
  const gap = line.baseline - previous.baseline;
  const expected = Math.max(previous.fontSize, line.fontSize) * 1.15;
  const extra = Math.max(0, gap - expected);
  return Math.min(26, (foreignAlignment ? Math.max(extra, 5) : extra));
}

function lineTop(line: TextLine): number {
  return line.baseline - line.fontSize;
}

function lineBottom(line: TextLine): number {
  return line.baseline + line.fontSize * 0.32;
}

function canMerge(current: TextBlock, previous: TextLine | null, line: TextLine, alignment: Alignment): boolean {
  if (!previous) return false;
  if (current.kind === 'heading') return false;
  if (current.alignment !== alignment) return false;

  const sizeDelta = Math.abs(previous.fontSize - line.fontSize);
  if (sizeDelta > Math.max(1.5, previous.fontSize * 0.16)) return false;

  const gap = line.baseline - previous.baseline;
  const baseSize = Math.max(previous.fontSize, line.fontSize);
  if (gap <= baseSize * 0.6) return false;
  if (gap > baseSize * 1.5) return false;

  return true;
}

export function buildBlocks(lines: TextLine[], pageWidth: number): BuildBlocksResult {
  const filtered = lines.filter((line) => line.text.trim().length > 0);
  const bodySize = weightedMedian(
    filtered.map((line) => ({ size: line.fontSize, weight: Math.max(1, line.text.length) })),
    11,
  );

  const blocks: TextBlock[] = [];
  let current: TextBlock | null = null;
  let previous: TextLine | null = null;

  for (const line of filtered) {
    const alignment = detectAlignment(line, pageWidth);
    const list = detectList(line.text);
    const level = headingLevelFor(line, bodySize);
    const foreignAlignment = previous ? current !== null && alignment !== current.alignment : false;
    const before = spaceBefore(previous, line, foreignAlignment);

    if (level !== null) {
      const block: TextBlock = {
        kind: 'heading',
        text: line.text,
        fontSize: line.fontSize,
        bold: true,
        italic: line.italic,
        alignment,
        headingLevel: level,
        spaceBefore: Math.max(before, level === 1 ? 12 : 8),
        spaceAfter: 5,
        top: lineTop(line),
        bottom: lineBottom(line),
      };
      blocks.push(block);
      current = null;
    } else if (list) {
      const block: TextBlock = {
        kind: list.kind,
        text: list.text,
        marker: list.marker,
        fontSize: line.fontSize,
        bold: line.bold,
        italic: line.italic,
        alignment,
        spaceBefore: Math.max(before, 1),
        spaceAfter: 2,
        top: lineTop(line),
        bottom: lineBottom(line),
      };
      blocks.push(block);
      current = block;
    } else if (current && canMerge(current, previous, line, alignment)) {
      current.text = mergeText(current.text, line.text);
      current.bold = current.bold || line.bold;
      current.italic = current.italic || line.italic;
      current.top = Math.min(current.top, lineTop(line));
      current.bottom = Math.max(current.bottom, lineBottom(line));
    } else {
      const block: TextBlock = {
        kind: 'paragraph',
        text: line.text,
        fontSize: line.fontSize,
        bold: line.bold,
        italic: line.italic,
        alignment,
        spaceBefore: before,
        spaceAfter: 4,
        top: lineTop(line),
        bottom: lineBottom(line),
      };
      blocks.push(block);
      current = block;
    }

    previous = line;
  }

  return { blocks, bodySize };
}

export function blockPreviewText(blocks: TextBlock[], limit = 1600): string {
  const parts: string[] = [];
  let total = 0;
  for (const block of blocks) {
    const prefix = block.kind === 'bullet' ? '• ' : '';
    const text = `${prefix}${block.text}`;
    if (total + text.length > limit) {
      parts.push(`${text.slice(0, Math.max(0, limit - total))}…`);
      break;
    }
    parts.push(text);
    total += text.length + 1;
  }
  return parts.join('\n\n');
}
