import { assertNotAborted } from './errors';
import { loadPdfjs, pdfAssetUrls } from './pdfjs';

export interface PdfProbe {
  pageCount: number;
  textLength: number;
  previewText: string;
  encrypted: boolean;
  scanned: boolean;
}

export async function probePdf(file: File, signal: AbortSignal): Promise<PdfProbe> {
  const pdfjs = await loadPdfjs();
  assertNotAborted(signal);
  const data = new Uint8Array(await file.arrayBuffer());
  assertNotAborted(signal);

  const task = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    ...pdfAssetUrls(),
  });

  try {
    const pdf = await task.promise;
    assertNotAborted(signal);
    const pagesToRead = Math.min(pdf.numPages, 4);
    let textLength = 0;
    let previewText = '';

    for (let index = 1; index <= pagesToRead; index += 1) {
      assertNotAborted(signal);
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      const text = content.items
        .filter((item) => 'str' in item)
        .map((item) => (item as { str: string }).str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      textLength += text.length;
      if (previewText.length < 1800) {
        previewText = `${previewText}${previewText ? '\n\n' : ''}${text}`.slice(0, 1800);
      }
      page.cleanup?.();
    }

    return {
      pageCount: pdf.numPages,
      textLength,
      previewText,
      encrypted: false,
      scanned: textLength === 0,
    };
  } catch (error) {
    const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
    if (name === 'PasswordException') {
      return { pageCount: 0, textLength: 0, previewText: '', encrypted: true, scanned: false };
    }
    throw error;
  } finally {
    try {
      await task.destroy();
    } catch {
      /* already destroyed */
    }
  }
}
