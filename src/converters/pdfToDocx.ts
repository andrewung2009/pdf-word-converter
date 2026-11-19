import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  TextRun,
} from 'docx';
import { clamp, yieldToBrowser } from '../lib/dom';
import { AppError, assertNotAborted, isAbortError, UserCancelledError } from '../lib/errors';
import { outputFilename } from '../lib/files';
import { loadPdfjs, pdfAssetUrls } from '../lib/pdfjs';
import type { ConversionResult, PdfToDocxOptions } from '../types';
import { blockPreviewText, buildBlocks, clusterLines, type RawTextItem, type TextBlock } from './textLayout';

interface LoadedPdf {
  pdf: {
    numPages: number;
    getPage: (pageNumber: number) => Promise<any>;
  };
  destroy: () => Promise<void>;
}

interface PageExtract {
  width: number;
  height: number;
  blocks: TextBlock[];
}

interface ImagePage {
  width: number;
  height: number;
}

const HEADING_LEVELS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

const ALIGNMENTS = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const;

function ptToTwip(value: number): number {
  return Math.max(0, Math.round(value * 20));
}

function mapPdfError(error: unknown): Error {
  if (error instanceof AppError || isAbortError(error)) return error as Error;
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  if (name === 'PasswordException') {
    return new AppError('This PDF is password-protected', 'Enter the password when prompted, or remove it and try again.');
  }
  if (name === 'InvalidPDFException' || name === 'FormatError') {
    return new AppError('Couldn’t read this PDF', 'The file may be damaged or may not be a real PDF.');
  }
  return new AppError('Couldn’t convert this PDF', 'Try a different file, or convert it as images instead.');
}

async function loadPdf(file: File, options: PdfToDocxOptions): Promise<LoadedPdf> {
  const pdfjs = await loadPdfjs();
  assertNotAborted(options.signal);

  const data = new Uint8Array(await file.arrayBuffer());
  assertNotAborted(options.signal);

  const task = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    ...pdfAssetUrls(),
  });

  let passwordCancelled = false;
  task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
    void (async () => {
      try {
        if (!options.getPassword) {
          passwordCancelled = true;
          await task.destroy();
          return;
        }
        const password = await options.getPassword(reason === 2);
        if (password === null) {
          passwordCancelled = true;
          await task.destroy();
          return;
        }
        updatePassword(password);
      } catch {
        passwordCancelled = true;
        void task.destroy();
      }
    })();
  };

  task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
    if (options.signal.aborted) return;
    const ratio = total > 0 ? loaded / total : 0.2;
    options.onProgress({ stage: 'Reading your PDF…', percent: Math.round(clamp(ratio, 0, 1) * 8) });
  };

  const onAbort = () => {
    void task.destroy();
  };
  options.signal.addEventListener('abort', onAbort, { once: true });

  try {
    const pdf = await task.promise;
    return {
      pdf,
      destroy: async () => {
        options.signal.removeEventListener('abort', onAbort);
        try {
          await task.destroy();
        } catch {
          /* already destroyed */
        }
      },
    };
  } catch (error) {
    options.signal.removeEventListener('abort', onAbort);
    if (passwordCancelled || options.signal.aborted) throw new UserCancelledError();
    throw mapPdfError(error);
  }
}

function buildParagraph(block: TextBlock): Paragraph {
  const size = Math.round(clamp(block.fontSize, 6, 48) * 2);
  const alignment = ALIGNMENTS[block.alignment];
  const spacing = {
    before: ptToTwip(block.spaceBefore),
    after: ptToTwip(block.spaceAfter),
    line: 276,
  };
  const run = new TextRun({
    text: block.text,
    size,
    bold: block.bold,
    italics: block.italic,
    font: 'Calibri',
    color: '1A1A1A',
  });

  if (block.kind === 'heading' && block.headingLevel) {
    return new Paragraph({
      heading: HEADING_LEVELS[block.headingLevel],
      alignment,
      spacing,
      children: [run],
    });
  }

  if (block.kind === 'bullet') {
    return new Paragraph({
      bullet: { level: 0 },
      alignment,
      spacing,
      children: [run],
    });
  }

  if (block.kind === 'number') {
    return new Paragraph({
      alignment,
      spacing,
      indent: { left: 720, hanging: 360 },
      children: [run],
    });
  }

  return new Paragraph({
    alignment,
    spacing,
    children: [run],
  });
}

function pageSection(page: PageExtract, fullBleed = false) {
  const width = ptToTwip(page.width);
  const height = ptToTwip(page.height);
  const children = page.blocks.map(buildParagraph);
  if (!children.length) children.push(new Paragraph({ text: '' }));

  return {
    properties: {
      page: {
        size: {
          width,
          height,
          orientation: page.width > page.height ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
        },
        margin: fullBleed
          ? { top: 0, right: 0, bottom: 0, left: 0 }
          : { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children,
  };
}

async function extractTextPages(pdf: LoadedPdf['pdf'], options: PdfToDocxOptions): Promise<{ pages: PageExtract[]; totalChars: number }> {
  const pdfjs = await loadPdfjs();
  const pages: PageExtract[] = [];
  let totalChars = 0;

  for (let index = 1; index <= pdf.numPages; index += 1) {
    assertNotAborted(options.signal);
    const page = await pdf.getPage(index);
    assertNotAborted(options.signal);

    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: RawTextItem[] = [];

    for (const raw of content.items as Array<Record<string, any>>) {
      if (typeof raw.str !== 'string' || !Array.isArray(raw.transform)) continue;
      const transform = pdfjs.Util.transform(viewport.transform, raw.transform);
      const scaleA = Math.hypot(transform[0], transform[1]);
      const scaleB = Math.hypot(transform[2], transform[3]);
      const fontSize = clamp(scaleB || scaleA || Number(raw.height) || 11, 4, 72);
      const style = content.styles?.[raw.fontName as string];

      if (raw.str.trim()) {
        totalChars += raw.str.trim().length;
        items.push({
          str: raw.str,
          x: transform[4],
          y: transform[5],
          width: Number(raw.width) || 0,
          fontSize,
          fontName: typeof raw.fontName === 'string' ? raw.fontName : undefined,
          fontFamily: style?.fontFamily,
          hasEOL: Boolean(raw.hasEOL),
        });
      }
    }

    const lines = clusterLines(items);
    const { blocks } = buildBlocks(lines, viewport.width);
    pages.push({ width: viewport.width, height: viewport.height, blocks });

    page.cleanup?.();
    options.onProgress({
      stage: `Rebuilding page ${index} of ${pdf.numPages}…`,
      page: index,
      totalPages: pdf.numPages,
      percent: 8 + Math.round((index / pdf.numPages) * 66),
    });
    await yieldToBrowser();
  }

  return { pages, totalChars };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new AppError('Couldn’t create the Word document', 'Your browser could not process the page images.'));
      },
      type,
      quality,
    );
  });
}

function makePreview(canvas: HTMLCanvasElement): string {
  const maxWidth = 720;
  if (canvas.width <= maxWidth) return canvas.toDataURL('image/jpeg', 0.75);
  const ratio = maxWidth / canvas.width;
  const preview = document.createElement('canvas');
  preview.width = maxWidth;
  preview.height = Math.max(1, Math.round(canvas.height * ratio));
  const context = preview.getContext('2d');
  if (!context) return canvas.toDataURL('image/jpeg', 0.75);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, preview.width, preview.height);
  context.drawImage(canvas, 0, 0, preview.width, preview.height);
  return preview.toDataURL('image/jpeg', 0.75);
}

async function extractImagePages(
  pdf: LoadedPdf['pdf'],
  options: PdfToDocxOptions,
): Promise<{ pages: ImagePage[]; images: Uint8Array[]; previews: string[] }> {
  const sections: ImagePage[] = [];
  const images: Uint8Array[] = [];
  const previews: string[] = [];
  const renderScale = pdf.numPages > 80 ? 1.5 : 2;

  for (let index = 1; index <= pdf.numPages; index += 1) {
    assertNotAborted(options.signal);
    const page = await pdf.getPage(index);
    assertNotAborted(options.signal);

    const viewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new AppError('Couldn’t render this PDF', 'Your browser could not create the page canvas.');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    assertNotAborted(options.signal);

    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    images.push(new Uint8Array(await blob.arrayBuffer()));
    if (index === 1) previews.push(makePreview(canvas));

    sections.push({
      width: viewport.width / renderScale,
      height: viewport.height / renderScale,
    });

    page.cleanup?.();
    options.onProgress({
      stage: `Capturing page ${index} of ${pdf.numPages}…`,
      page: index,
      totalPages: pdf.numPages,
      percent: 8 + Math.round((index / pdf.numPages) * 68),
    });

    canvas.width = 1;
    canvas.height = 1;
    await yieldToBrowser();
  }

  return { pages: sections, images, previews };
}

export async function convertPdfToDocx(file: File, options: PdfToDocxOptions): Promise<ConversionResult> {
  let loaded: LoadedPdf | null = null;
  try {
    options.onProgress({ stage: 'Opening your PDF…', percent: 2 });
    loaded = await loadPdf(file, options);
    assertNotAborted(options.signal);

    let sections: ReturnType<typeof pageSection>[] = [];
    let previewText = '';
    let previewImages: string[] | undefined;
    let scanned = false;

    if (options.mode === 'text') {
      const { pages, totalChars } = await extractTextPages(loaded.pdf, options);
      assertNotAborted(options.signal);

      scanned = totalChars < Math.max(20, pages.length * 20);
      sections = pages.map((page) => pageSection(page));
      previewText = blockPreviewText(
        pages.flatMap((page) => page.blocks),
        1800,
      );
      previewImages = undefined;
    } else {
      options.onProgress({ stage: 'Preparing page images…', percent: 6 });
      const { pages, images, previews } = await extractImagePages(loaded.pdf, options);
      assertNotAborted(options.signal);

      sections = pages.map((page, index) => {
        const displayWidth = Math.max(1, Math.round(page.width * (96 / 72)));
        const displayHeight = Math.max(1, Math.round(page.height * (96 / 72)));
        return {
          properties: {
            page: {
              size: {
                width: ptToTwip(page.width),
                height: ptToTwip(page.height),
                orientation: page.width > page.height ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
              },
              margin: { top: 0, right: 0, bottom: 0, left: 0 },
            },
          },
          children: [
            new Paragraph({
              spacing: { before: 0, after: 0 },
              children: [
                new ImageRun({
                  type: 'jpg',
                  data: images[index],
                  transformation: { width: displayWidth, height: displayHeight },
                }),
              ],
            }),
          ],
        };
      });
      previewImages = previews;
      previewText = '';
      scanned = false;
    }

    assertNotAborted(options.signal);
    options.onProgress({ stage: 'Packaging your .docx…', percent: 88 });

    const document = new Document({
      creator: 'PDF ⇄ Word',
      title: file.name.replace(/\.[a-z0-9]+$/i, ''),
      description: 'Converted locally in the browser',
      sections,
    });
    const blob = await Packer.toBlob(document);
    assertNotAborted(options.signal);
    options.onProgress({ stage: 'Done', percent: 100 });

    return {
      blob,
      filename: outputFilename(file.name, 'docx'),
      kind: 'docx',
      pageCount: loaded.pdf.numPages,
      previewText: previewText || undefined,
      previewImages,
      scanned,
    };
  } catch (error) {
    if (isAbortError(error)) throw new UserCancelledError();
    throw mapPdfError(error);
  } finally {
    if (loaded) await loaded.destroy();
  }
}
