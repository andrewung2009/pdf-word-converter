import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const sampleDocx = join(process.cwd(), 'public', 'samples', 'sample.docx');
const samplePdf = join(process.cwd(), 'public', 'samples', 'sample.pdf');
const scannedPdf = join(process.cwd(), 'public', 'samples', 'scanned-sample.pdf');
const resultsDir = join(process.cwd(), 'test-results');

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await mkdir(resultsDir, { recursive: true });
  await page.goto('/');
  await expect(page.locator('#hero-title')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
});

test('desktop: Word to PDF conversion, preview, and download', async ({ page }) => {
  const errors = watchErrors(page);
  await page.screenshot({ path: join(resultsDir, '01-landing-light.png'), fullPage: true });

  await page.setInputFiles('#file-input', sampleDocx);
  await expect(page.locator('#file-panel')).toBeVisible();
  await expect(page.locator('#file-name')).toHaveText('sample.docx');
  await page.screenshot({ path: join(resultsDir, '02-file-selected.png'), fullPage: true });

  await page.click('#convert-button');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-title')).toContainText('PDF is ready');
  await expect(page.locator('#result-preview img.page-shot').first()).toBeVisible();
  await page.screenshot({ path: join(resultsDir, '03-result-word-to-pdf.png'), fullPage: true });

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download-button')]);
  const outputPath = join(resultsDir, 'converted.pdf');
  await download.saveAs(outputPath);

  const bytes = await readFile(outputPath);
  expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const textPdf = await loadingTask.promise;
  let extracted = '';
  for (let pageNumber = 1; pageNumber <= textPdf.numPages; pageNumber += 1) {
    const textPage = await textPdf.getPage(pageNumber);
    const content = await textPage.getTextContent();
    extracted += `${content.items
      .filter((item) => 'str' in item)
      .map((item) => (item as { str: string }).str)
      .join(' ')}\n`;
  }
  await loadingTask.destroy();
  expect(extracted).toContain('Welcome to PDF');
  expect(extracted).toContain('Page two');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('desktop: PDF to Word conversion with editable text', async ({ page }) => {
  const errors = watchErrors(page);
  await page.click('#mode-pdf-docx');
  await page.setInputFiles('#file-input', samplePdf);
  await expect(page.locator('#file-name')).toHaveText('sample.pdf');
  await expect(page.locator('#pdf-options')).toBeVisible();

  await page.click('#convert-button');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-title')).toContainText('Word file is ready');
  await expect(page.locator('#result-preview .text-preview')).toBeVisible();
  await expect(page.locator('#result-details')).toContainText('Editable text + images');
  await expect(page.locator('#result-details')).toContainText('Images');
  await expect(page.locator('#print-button')).toBeHidden();
  await page.screenshot({ path: join(resultsDir, '04-result-pdf-to-word.png'), fullPage: true });

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download-button')]);
  const outputPath = join(resultsDir, 'converted.docx');
  await download.saveAs(outputPath);

  const bytes = await readFile(outputPath);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml).toContain('Welcome to PDF');
  expect(documentXml).toContain('Page two');
  expect(documentXml).toContain('<w:drawing>');
  expect((documentXml?.match(/<w:drawing>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'));
  expect(media.length).toBeGreaterThan(0);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('scanned PDF detects missing text and can fall back to exact layout', async ({ page }) => {
  const errors = watchErrors(page);
  await page.click('#mode-pdf-docx');
  await page.setInputFiles('#file-input', scannedPdf);
  await page.click('#convert-button');

  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-alert')).toBeVisible();
  await expect(page.locator('#result-alert')).toContainText('little or no selectable text');
  await expect(page.locator('#image-mode-button')).toBeVisible();
  await page.screenshot({ path: join(resultsDir, '05-scanned-warning.png'), fullPage: true });

  await page.click('#image-mode-button');
  await expect(page.locator('#busy-state')).toBeVisible();
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-alert')).toBeHidden();
  await expect(page.locator('#result-preview img.page-shot').first()).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download-button')]);
  const outputPath = join(resultsDir, 'scanned.docx');
  await download.saveAs(outputPath);
  const bytes = await readFile(outputPath);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  await page.screenshot({ path: join(resultsDir, '06-scanned-image-mode.png'), fullPage: true });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('rejects old .doc files with clear guidance and supports dark mode', async ({ page }) => {
  const errors = watchErrors(page);
  const legacyDoc = join(resultsDir, 'legacy.doc');
  await writeFile(legacyDoc, Buffer.from('not a real doc'));

  await page.setInputFiles('#file-input', legacyDoc);
  await expect(page.locator('#idle-alert')).toBeVisible();
  await expect(page.locator('#idle-alert')).toContainText('Older .doc files');

  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: join(resultsDir, '07-landing-dark.png'), fullPage: true });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('mobile layout renders cleanly', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('#hero-title')).toBeVisible();
  await page.screenshot({ path: join(resultsDir, '08-mobile-light.png'), fullPage: true });

  await page.setInputFiles('#file-input', sampleDocx);
  await expect(page.locator('#file-panel')).toBeVisible();
  await page.screenshot({ path: join(resultsDir, '09-mobile-file.png'), fullPage: true });

  expect(errors, errors.join('\n')).toEqual([]);
});
