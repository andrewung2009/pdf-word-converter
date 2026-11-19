import type * as PdfjsModule from 'pdfjs-dist';

type Pdfjs = typeof PdfjsModule;

let pdfjsPromise: Promise<Pdfjs> | null = null;

export interface PdfAssetUrls {
  cMapUrl: string;
  cMapPacked: boolean;
  standardFontDataUrl: string;
  wasmUrl: string;
  iccUrl: string;
}

export function pdfAssetUrls(): PdfAssetUrls {
  return {
    cMapUrl: new URL('pdfjs/cmaps/', document.baseURI).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('pdfjs/standard_fonts/', document.baseURI).href,
    wasmUrl: new URL('pdfjs/wasm/', document.baseURI).href,
    iccUrl: new URL('pdfjs/iccs/', document.baseURI).href,
  };
}

export function loadPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
      return pdfjs;
    })().catch((error) => {
      pdfjsPromise = null;
      throw error;
    });
  }
  return pdfjsPromise;
}
