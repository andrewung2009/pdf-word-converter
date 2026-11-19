export type ConversionMode = 'docx-to-pdf' | 'pdf-to-docx';
export type PdfOutputMode = 'text' | 'image';
export type OutputKind = 'pdf' | 'docx';

export interface ProgressUpdate {
  stage: string;
  percent?: number;
  page?: number;
  totalPages?: number;
}

export interface ConversionResult {
  blob: Blob;
  filename: string;
  kind: OutputKind;
  pageCount: number;
  images?: number;
  previewImages?: string[];
  previewText?: string;
  scanned?: boolean;
}

export interface ConvertContext {
  signal: AbortSignal;
  onProgress: (update: ProgressUpdate) => void;
  getPassword?: (incorrect: boolean) => Promise<string | null>;
}

export interface PdfToDocxOptions extends ConvertContext {
  mode: PdfOutputMode;
}

export interface DocxToPdfOptions extends ConvertContext {
  renderStage: HTMLElement;
}

export interface PasswordRequest {
  incorrect: boolean;
}
