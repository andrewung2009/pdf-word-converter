import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { assertNotAborted, AppError, isAbortError, UserCancelledError } from '../lib/errors';
import { outputFilename } from '../lib/files';
import type { ConversionResult, DocxToPdfOptions } from '../types';

const FONT_MAP: Array<[RegExp, string]> = [
  [/(["']?)Calibri(?: Light)?\1/gi, 'Carlito, Calibri'],
  [/(["']?)Cambria(?: Math)?\1/gi, 'Caladea, Cambria'],
];

function mapFonts(root: HTMLElement): void {
  const elements = root.querySelectorAll<HTMLElement>('[style*="font-family"]');
  for (const element of elements) {
    const current = element.style.fontFamily;
    let next = current;
    for (const [pattern, replacement] of FONT_MAP) {
      next = next.replace(pattern, replacement);
    }
    if (next !== current) element.style.fontFamily = next;
  }
}

async function waitForAssets(root: HTMLElement): Promise<void> {
  await document.fonts.ready;
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    images.map(async (image) => {
      if (image.complete) {
        try {
          await image.decode?.();
        } catch {
          /* ignore a broken image */
        }
        return;
      }
      await new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      });
    }),
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function makePreview(canvas: HTMLCanvasElement): string {
  const maxWidth = 720;
  if (canvas.width <= maxWidth) return canvas.toDataURL('image/jpeg', 0.76);
  const ratio = maxWidth / canvas.width;
  const preview = document.createElement('canvas');
  preview.width = maxWidth;
  preview.height = Math.max(1, Math.round(canvas.height * ratio));
  const context = preview.getContext('2d');
  if (!context) return canvas.toDataURL('image/jpeg', 0.76);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, preview.width, preview.height);
  context.drawImage(canvas, 0, 0, preview.width, preview.height);
  return preview.toDataURL('image/jpeg', 0.76);
}

function findRenderedPages(stage: HTMLElement): HTMLElement[] {
  const pages = Array.from(stage.querySelectorAll<HTMLElement>('.docx-wrapper > section.docx'));
  if (pages.length) return pages;
  const fallback = Array.from(stage.querySelectorAll<HTMLElement>('section.docx'));
  if (fallback.length) return fallback;
  const single = stage.querySelector<HTMLElement>('.docx');
  return single ? [single] : [];
}

async function loadDocumentFonts(): Promise<void> {
  await Promise.all([
    import('@fontsource/carlito/latin-400.css'),
    import('@fontsource/carlito/latin-700.css'),
    import('@fontsource/carlito/latin-400-italic.css'),
    import('@fontsource/carlito/latin-700-italic.css'),
    import('@fontsource/caladea/latin-400.css'),
    import('@fontsource/caladea/latin-700.css'),
    import('@fontsource/caladea/latin-400-italic.css'),
    import('@fontsource/caladea/latin-700-italic.css'),
  ]);
  await document.fonts.ready;
}

export async function convertDocxToPdf(file: File, options: DocxToPdfOptions): Promise<ConversionResult> {
  try {
    options.onProgress({ stage: 'Opening your Word document…', percent: 3 });
    const data = await file.arrayBuffer();
    assertNotAborted(options.signal);

    const header = new Uint8Array(data.slice(0, 4));
    if (!(header[0] === 0x50 && header[1] === 0x4b)) {
      throw new AppError(
        'Couldn’t read this Word document',
        'The file may be an older .doc file or damaged. In Word, use File → Save As → Word Document (.docx).',
      );
    }

    options.onProgress({ stage: 'Loading document fonts…', percent: 7 });
    await loadDocumentFonts();
    assertNotAborted(options.signal);

    options.onProgress({ stage: 'Laying out your document…', percent: 11 });
    options.renderStage.replaceChildren();
    await renderAsync(data, options.renderStage, undefined, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: false,
      renderEndnotes: false,
      ignoreLastRenderedPageBreak: false,
      useBase64URL: true,
      experimental: true,
      debug: false,
    });
    assertNotAborted(options.signal);

    mapFonts(options.renderStage);
    options.onProgress({ stage: 'Waiting for images and fonts…', percent: 16 });
    await waitForAssets(options.renderStage);
    assertNotAborted(options.signal);

    const pages = findRenderedPages(options.renderStage);
    if (!pages.length) {
      throw new AppError(
        'Couldn’t read this Word document',
        'The file may be damaged or use an unsupported format. Try re-saving it as a .docx file.',
      );
    }

    const previewImages: string[] = [];
    let pdf: jsPDF | null = null;

    for (let index = 0; index < pages.length; index += 1) {
      assertNotAborted(options.signal);
      const page = pages[index];
      const rect = page.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || page.offsetWidth));
      const height = Math.max(1, Math.round(rect.height || page.offsetHeight));

      const widthPt = width * (72 / 96);
      const heightPt = height * (72 / 96);
      const orientation = widthPt >= heightPt ? 'landscape' : 'portrait';

      const scale = Math.min(2, Math.max(1, Math.sqrt(16_000_000 / (width * height))));
      const previousShadow = page.style.boxShadow;
      page.style.boxShadow = 'none';

      let canvas: HTMLCanvasElement;
      try {
        canvas = await html2canvas(page, {
          scale,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
          imageTimeout: 20000,
          signal: options.signal,
        });
      } finally {
        page.style.boxShadow = previousShadow;
      }
      assertNotAborted(options.signal);

      if (!pdf) {
        pdf = new jsPDF({
          orientation,
          unit: 'pt',
          format: [widthPt, heightPt],
          compress: true,
        });
      } else {
        pdf.addPage([widthPt, heightPt], orientation);
      }

      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, widthPt, heightPt, undefined, 'FAST');
      if (previewImages.length < 6) previewImages.push(makePreview(canvas));

      canvas.width = 1;
      canvas.height = 1;

      options.onProgress({
        stage: `Rendering page ${index + 1} of ${pages.length}…`,
        page: index + 1,
        totalPages: pages.length,
        percent: 16 + Math.round(((index + 1) / pages.length) * 76),
      });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    if (!pdf) throw new AppError('Couldn’t convert this Word document', 'No pages were found in the file.');
    assertNotAborted(options.signal);

    options.onProgress({ stage: 'Packaging your PDF…', percent: 96 });
    const blob = pdf.output('blob');
    options.onProgress({ stage: 'Done', percent: 100 });

    return {
      blob,
      filename: outputFilename(file.name, 'pdf'),
      kind: 'pdf',
      pageCount: pages.length,
      previewImages,
    };
  } catch (error) {
    if (isAbortError(error)) throw new UserCancelledError();
    if (error instanceof AppError) throw error;
    throw new AppError(
      'Couldn’t convert this Word document',
      'It may use an unsupported layout or be password-protected. Try re-saving it as a .docx file.',
    );
  }
}

export async function printDocxStage(stage: HTMLElement): Promise<void> {
  const wrapper = stage.querySelector('.docx-wrapper');
  if (!wrapper) {
    throw new AppError('Nothing to print', 'Convert the document first, then try printing again.');
  }

  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((element) => element.outerHTML)
    .join('\n');

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = '1000px';
  iframe.style.height = '1000px';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';

  const printCss = `
    @page { size: auto; margin: 0; }
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .docx-wrapper { padding: 0 !important; background: #fff !important; display: block !important; }
    .docx-wrapper > section.docx {
      box-shadow: none !important;
      margin: 0 auto !important;
      break-after: page;
      page-break-after: always;
    }
    .docx-wrapper > section.docx:last-child {
      break-after: auto;
      page-break-after: auto;
    }
  `;

  const html = `<!doctype html><html><head><meta charset="utf-8"><base href="${document.baseURI}">${styles}<style>${printCss}</style></head><body>${wrapper.outerHTML}</body></html>`;

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new AppError('Couldn’t open the print view', 'Try again, or use Download instead.'));
    }, 20000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      iframe.remove();
    };

    iframe.onload = () => {
      void (async () => {
        try {
          const frameDocument = iframe.contentDocument;
          const frameWindow = iframe.contentWindow;
          if (!frameDocument || !frameWindow) throw new Error('No print document');
          await frameDocument.fonts?.ready;
          const images = Array.from(frameDocument.querySelectorAll('img'));
          await Promise.all(
            images.map(async (image) => {
              try {
                await image.decode?.();
              } catch {
                /* ignore */
              }
            }),
          );
          frameWindow.focus();
          frameWindow.print();
          window.clearTimeout(timeout);
          frameWindow.addEventListener('afterprint', cleanup, { once: true });
          window.setTimeout(cleanup, 60000);
          resolve();
        } catch {
          cleanup();
          reject(new AppError('Couldn’t open the print view', 'Your browser blocked printing. Use Download instead.'));
        }
      })();
    };

    iframe.srcdoc = html;
    document.body.append(iframe);
  });
}
