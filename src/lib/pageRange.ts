export interface PageSelectionParse {
  ok: boolean;
  pages: number[];
  label: string;
  error?: string;
}

const MAX_SELECTED_PAGES = 5000;

function fail(error: string): PageSelectionParse {
  return { ok: false, pages: [], label: '', error };
}

export function formatPageList(pages: number[]): string {
  const sorted = [...new Set(pages)].filter((page) => Number.isInteger(page) && page > 0).sort((a, b) => a - b);
  if (!sorted.length) return '';

  const ranges: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (let index = 1; index <= sorted.length; index += 1) {
    const current = sorted[index];
    if (index < sorted.length && current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? String(start) : `${start}-${previous}`);
    if (index < sorted.length) {
      start = current;
      previous = current;
    }
  }

  return ranges.join(', ');
}

export function parsePageSelection(input: string, totalPages?: number | null): PageSelectionParse {
  const raw = input.trim();
  if (!raw) return fail('Enter page numbers or ranges, like 1-3, 5.');

  const normalized = raw.replace(/[–—−]/g, '-').replace(/\s*-\s*/g, '-');
  const tokens = normalized.split(/[,;\s]+/).filter(Boolean);
  if (!tokens.length) return fail('Enter page numbers or ranges, like 1-3, 5.');

  const selected = new Set<number>();

  for (const token of tokens) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token);
    if (!match) {
      return fail(`“${token}” isn’t a valid page number. Use numbers or ranges like 1-3, 5.`);
    }

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < 1) {
      return fail('Page numbers start at 1.');
    }
    if (end < start) {
      return fail(`The range ${start}-${end} is reversed.`);
    }
    if (typeof totalPages === 'number' && Number.isFinite(totalPages) && end > totalPages) {
      return fail(
        totalPages === 1
          ? 'This document has only 1 page.'
          : `This document has ${totalPages} pages; page ${end} is out of range.`,
      );
    }

    for (let page = start; page <= end; page += 1) {
      selected.add(page);
      if (selected.size > MAX_SELECTED_PAGES) {
        return fail(`That selection is too large. Choose fewer than ${MAX_SELECTED_PAGES} pages.`);
      }
    }
  }

  const pages = [...selected].sort((a, b) => a - b);
  if (!pages.length) return fail('Select at least one page.');

  return { ok: true, pages, label: formatPageList(pages) };
}
