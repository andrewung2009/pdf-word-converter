export type FileKind = 'pdf' | 'docx' | 'doc' | 'unknown';

export interface InspectedFile {
  kind: FileKind;
  extension: string;
  looksCorrupt: boolean;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function matches(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((value, index) => bytes[index] === value);
}

export function getExtension(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match ? match[1].toLowerCase() : '';
}

export function stripExtension(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, '');
}

export function outputFilename(filename: string, extension: 'pdf' | 'docx'): string {
  const base = stripExtension(filename).trim() || 'converted-document';
  return `${base}.${extension}`;
}

export async function inspectFile(file: File): Promise<InspectedFile> {
  const extension = getExtension(file.name);
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (matches(header, PDF_MAGIC)) {
    return { kind: 'pdf', extension, looksCorrupt: false };
  }
  if (matches(header, ZIP_MAGIC)) {
    return { kind: 'docx', extension, looksCorrupt: false };
  }
  if (matches(header, OLE_MAGIC)) {
    return { kind: 'doc', extension, looksCorrupt: false };
  }
  if (extension === 'pdf') {
    return { kind: 'pdf', extension, looksCorrupt: true };
  }
  if (extension === 'docx') {
    return { kind: 'docx', extension, looksCorrupt: true };
  }
  if (extension === 'doc') {
    return { kind: 'doc', extension, looksCorrupt: false };
  }
  return { kind: 'unknown', extension, looksCorrupt: false };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatPages(count: number): string {
  return count === 1 ? '1 page' : `${count} pages`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function baseName(filename: string): string {
  return stripExtension(filename.split(/[\\/]/).pop() ?? filename);
}
