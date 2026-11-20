import { assertNotAborted } from './errors';
import { loadPdfjs, pdfAssetUrls } from './pdfjs';

export interface PdfProbe {
  pageCount: number;
  textLength: number;
  previewText: string;
  encrypted: boolean;
  scanned: boolean;
}

export async function getPdfPageCount(file: File): Promise<number | null> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    ...pdfAssetUrls(),
  });

  try {
    const pdf = await task.promise;
    return pdf.numPages;
  } catch (error) {
    const name =
      typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name: unknown }).name)
        : '';
    if (name === 'PasswordException') return null;
    return null;
  } finally {
    try {
      await task.destroy();
    } catch {
      /* already destroyed */
    }
  }
}

export async function probePdf(
  file: File,
  signal: AbortSignal,
  pages?: number[],
): Promise<PdfProbe> {
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

    const selectedPages = pages?.length
      ? pages.filter((page) => page >= 1 && page <= pdf.numPages)
      : Array.from({ length: pdf.numPages }, (_, index) => index + 1);
    const pagesToRead = selectedPages.slice(0, 6);
    let textLength = 0;
    let previewText = '';

    for (const pageNumber of pagesToRead) {
      assertNotAborted(signal);
      const page = await pdf.getPage(pageNumber);
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
    const name =
      typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name: unknown }).name)
        : '';
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
