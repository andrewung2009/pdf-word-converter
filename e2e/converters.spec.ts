import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const sampleDocx = join(process.cwd(), 'public', 'samples', 'sample.docx');
const samplePdf = join(process.cwd(), 'public', 'samples', 'sample.pdf');
const cmykPdf = join(process.cwd(), 'public', 'samples', 'cmyk-sample.pdf');
const multiSectionDocx = join(process.cwd(), 'public', 'samples', 'multi-section.docx');
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

async function extractPdfText(bytes: Buffer): Promise<{ pages: number; text: string }> {
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const pdf = await loadingTask.promise;
  let text = '';
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    text += `${content.items
      .filter((item) => 'str' in item)
      .map((item) => (item as { str: string }).str)
      .join(' ')}\n`;
  }
  const pages = pdf.numPages;
  await loadingTask.destroy();
  return { pages, text };
}

test.beforeEach(async ({ page }) => {
  await mkdir(resultsDir, { recursive: true });
  await page.goto('/');
  await expect(page.locator('#hero-title')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
});

test('Word to PDF selectable uses the print flow and keeps images', async ({ page }) => {
  const errors = watchErrors(page);
  await page.screenshot({ path: join(resultsDir, '01-landing-light.png'), fullPage: true });

  await page.setInputFiles('#file-input', sampleDocx);
  await expect(page.locator('#file-panel')).toBeVisible();
  await expect(page.locator('#output-options')).toBeVisible();
  await page.screenshot({ path: join(resultsDir, '02-file-selected.png'), fullPage: true });

  await page.click('#convert-button');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#primary-label')).toHaveText('Save selectable PDF');
  await expect(page.locator('#fallback-download')).toBeVisible();
  await expect(page.locator('#result-preview img.page-shot').first()).toBeVisible();
  await page.screenshot({ path: join(resultsDir, '03-result-word-selectable.png'), fullPage: true });

  await page.click('#primary-button');
  await page.waitForFunction(
    () => {
      const frame = document.querySelector('iframe');
      return Boolean(frame?.contentDocument?.querySelector('.docx-wrapper'));
    },
    { timeout: 30_000 },
  );
  const printInfo = await page.evaluate(() => {
    const frame = document.querySelector('iframe');
    return {
      title: frame?.contentDocument?.title ?? '',
      text: frame?.contentDocument?.body?.innerText ?? '',
    };
  });
  expect(printInfo.title).toBe('sample');
  expect(printInfo.text).toContain('Welcome to PDF');
  expect(printInfo.text).toContain('Page two');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('Word to PDF exact downloads a searchable image PDF', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setInputFiles('#file-input', sampleDocx);
  await page.check('input[name="output-style"][value="exact"]');
  await expect(page.locator('#output-hint')).toContainText('image PDF');
  await page.click('#convert-button');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#primary-label')).toHaveText('Download PDF');
  await page.screenshot({ path: join(resultsDir, '04-result-word-exact.png'), fullPage: true });

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#primary-button')]);
  const outputPath = join(resultsDir, 'converted-exact.pdf');
  await download.saveAs(outputPath);

  const bytes = await readFile(outputPath);
  expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
  const extracted = await extractPdfText(bytes);
  expect(extracted.text).toContain('Welcome to PDF');
  expect(extracted.text).toContain('Page two');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('Word to PDF keeps same-size sections as separate pages', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setInputFiles('#file-input', multiSectionDocx);
  await page.check('input[name="output-style"][value="exact"]');
  await page.click('#convert-button');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-meta')).toContainText('3 pages');

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#primary-button')]);
  const outputPath = join(resultsDir, 'converted-sections.pdf');
  await download.saveAs(outputPath);

  const pdf = await PDFDocument.load(await readFile(outputPath));
  expect(pdf.getPageCount()).toBe(3);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('Word to PDF converts only selected pages and prints only them', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setInputFiles('#file-input', multiSectionDocx);
  await expect(page.locator('#file-panel')).toBeVisible();
  await expect(page.locator('#page-total')).toContainText('Count after layout');
  await page.check('input[name="output-style"][value="exact"]');
  await page.locator('label.page-mode-option', { hasText: 'Custom' }).click();
  await page.fill('#page-input', '2');
  await page.click('#convert-button');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-meta')).toContainText('1 of 3 pages');
  await expect(page.locator('#result-details')).toContainText('Range');

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#primary-button')]);
  const outputPath = join(resultsDir, 'converted-section-2.pdf');
  await download.saveAs(outputPath);
  const pdf = await PDFDocument.load(await readFile(outputPath));
  expect(pdf.getPageCount()).toBe(1);

  await page.click('#change-pages');
  await expect(page.locator('#file-panel')).toBeVisible();
  await expect(page.locator('#page-total')).toContainText('3 pages');
  await page.check('input[name="output-style"][value="selectable"]');
  await page.click('#convert-button');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await page.click('#primary-button');
  await page.waitForFunction(
    () => Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('.docx-wrapper')),
    { timeout: 30_000 },
  );
  const printText = await page.evaluate(
    () => document.querySelector('iframe')?.contentDocument?.body?.innerText ?? '',
  );
  expect(printText).toContain('Section 2');
  expect(printText).not.toContain('Section 1');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('page range validation catches bad and out-of-range pages', async ({ page }) => {
  const errors = watchErrors(page);
  await page.click('#mode-pdf-docx');
  await page.setInputFiles('#file-input', samplePdf);
  await expect(page.locator('#page-total')).toContainText('2 pages');
  await page.locator('label.page-mode-option', { hasText: 'Custom' }).click();
  await page.fill('#page-input', '5');
  await expect(page.locator('#page-error')).toContainText('2 pages');
  await expect(page.locator('#convert-button')).toBeDisabled();

  await page.fill('#page-input', 'abc');
  await expect(page.locator('#page-error')).toContainText('valid page number');
  await expect(page.locator('#convert-button')).toBeDisabled();

  await page.fill('#page-input', '1-2');
  await expect(page.locator('#convert-button')).toBeEnabled();

  await page.click('#mode-docx-pdf');
  await page.setInputFiles('#file-input', multiSectionDocx);
  await page.waitForSelector('#file-panel', { state: 'visible' });
  await page.locator('label.page-mode-option', { hasText: 'Custom' }).click();
  await page.fill('#page-input', '5');
  await page.check('input[name="output-style"][value="exact"]');
  await page.click('#convert-button');
  await expect(page.locator('#inline-alert')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#page-total')).toContainText('3 pages');
  await expect(page.locator('#page-error')).toContainText('3 pages');
  await expect(page.locator('#convert-button')).toBeDisabled();

  expect(errors, errors.join('\n')).toEqual([]);
});

test('PDF to Word fast mode converts only selected pages', async ({ page }) => {
  const errors = watchErrors(page);
  await page.click('#mode-pdf-docx');
  await page.setInputFiles('#file-input', samplePdf);
  await expect(page.locator('#engine-settings')).toBeVisible();
  await expect(page.locator('#page-total')).toContainText('2 pages');
  await page.locator('label.page-mode-option', { hasText: 'Custom' }).click();
  await page.fill('#page-input', '2');
  await expect(page.locator('#page-hint')).toContainText('1 page selected');
  await page.click('#convert-button');
  await expect(page.locator('#engine-dialog')).toBeVisible();
  await page.click('#engine-fast');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-title')).toContainText('Word file is ready');
  await expect(page.locator('#result-details')).toContainText('1 of 2 pages');
  await expect(page.locator('#result-details')).toContainText('Range');
  await expect(page.locator('#result-details')).toContainText('Fast converter');
  await expect(page.locator('#result-preview .text-preview')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pdfword-pdf-engine'))).toBe('fast');
  await page.screenshot({ path: join(resultsDir, '05-result-pdf-fast.png'), fullPage: true });

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#primary-button')]);
  const outputPath = join(resultsDir, 'converted-fast.docx');
  await download.saveAs(outputPath);

  const bytes = await readFile(outputPath);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml).not.toContain('Welcome to PDF');
  expect(documentXml).toContain('Page two');
  expect(documentXml).toContain('<w:drawing>');
  expect(Object.keys(zip.files).some((name) => name.startsWith('word/media/'))).toBe(true);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('PDF to Word high fidelity honors a custom page range', async ({ page }) => {
  test.slow();
  const errors = watchErrors(page);
  await page.click('#mode-pdf-docx');
  await page.setInputFiles('#file-input', samplePdf);
  await expect(page.locator('#page-total')).toContainText('2 pages');
  await page.locator('label.page-mode-option', { hasText: 'Custom' }).click();
  await page.fill('#page-input', '2');
  await page.click('#convert-button');
  await expect(page.locator('#engine-dialog')).toBeVisible();
  await page.click('#engine-high');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 300_000 });
  await expect(page.locator('#result-alert')).toBeHidden();
  await expect(page.locator('#result-details')).toContainText('1 of 2 pages');
  await expect(page.locator('#result-details')).toContainText('pdf2docx');

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#primary-button')]);
  const outputPath = join(resultsDir, 'converted-high-custom.docx');
  await download.saveAs(outputPath);

  const zip = await JSZip.loadAsync(await readFile(outputPath));
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml).not.toContain('Welcome to PDF');
  expect(documentXml).toContain('Page two');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('PDF to Word exact embeds only selected pages', async ({ page }) => {
  const errors = watchErrors(page);
  await page.click('#mode-pdf-docx');
  await page.setInputFiles('#file-input', samplePdf);
  await expect(page.locator('#page-total')).toContainText('2 pages');
  await page.locator('label.page-mode-option', { hasText: 'Custom' }).click();
  await page.fill('#page-input', '2');
  await page.check('input[name="output-style"][value="exact"]');
  await page.click('#convert-button');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-details')).toContainText('1 of 2 pages');
  await expect(page.locator('#result-details')).toContainText('Exact layout');

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#primary-button')]);
  const outputPath = join(resultsDir, 'converted-exact-page-2.docx');
  await download.saveAs(outputPath);
  const zip = await JSZip.loadAsync(await readFile(outputPath));
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml).not.toContain('Welcome to PDF');
  expect(documentXml).toContain('<w:drawing>');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('PDF to Word high fidelity handles CMYK images and uses the on-device engine', async ({ page }) => {
  test.slow();
  const errors = watchErrors(page);
  await page.click('#mode-pdf-docx');
  await page.setInputFiles('#file-input', cmykPdf);
  await page.click('#convert-button');
  await expect(page.locator('#engine-dialog')).toBeVisible();
  await page.click('#engine-high');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 300_000 });
  await expect(page.locator('#result-alert')).toBeHidden();
  await expect(page.locator('#result-details')).toContainText('pdf2docx');
  await expect(page.locator('#result-details')).toContainText('high fidelity');
  expect(await page.evaluate(() => localStorage.getItem('pdfword-pdf-engine'))).toBe('high');
  await page.screenshot({ path: join(resultsDir, '06-result-pdf-high.png'), fullPage: true });

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#primary-button')]);
  const outputPath = join(resultsDir, 'converted-high.docx');
  await download.saveAs(outputPath);

  const bytes = await readFile(outputPath);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml).toContain('CMYK image conversion test');
  expect(documentXml).toContain('<w:drawing>');
  expect(Object.keys(zip.files).some((name) => name.startsWith('word/media/'))).toBe(true);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('PDF to Word exact keeps pages as images', async ({ page }) => {
  const errors = watchErrors(page);
  await page.click('#mode-pdf-docx');
  await page.setInputFiles('#file-input', samplePdf);
  await page.check('input[name="output-style"][value="exact"]');
  await page.click('#convert-button');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-hint')).toContainText('Pages are images');
  await page.screenshot({ path: join(resultsDir, '07-result-pdf-exact.png'), fullPage: true });

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#primary-button')]);
  const outputPath = join(resultsDir, 'converted-pdf-exact.docx');
  await download.saveAs(outputPath);

  const bytes = await readFile(outputPath);
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml).not.toContain('Welcome to PDF');
  expect(documentXml).toContain('<w:drawing>');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('scanned PDF warns and can switch to Exact layout', async ({ page }) => {
  const errors = watchErrors(page);
  await page.click('#mode-pdf-docx');
  await page.setInputFiles('#file-input', scannedPdf);
  await page.click('#convert-button');
  await expect(page.locator('#engine-dialog')).toBeVisible();
  await page.click('#engine-fast');
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-alert')).toContainText('little or no selectable text');
  await expect(page.locator('#switch-exact')).toBeVisible();
  await page.screenshot({ path: join(resultsDir, '08-scanned-warning.png'), fullPage: true });

  await page.click('#switch-exact');
  await expect(page.locator('#busy-state')).toBeVisible();
  await expect(page.locator('#result-state')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-alert')).toBeHidden();
  await expect(page.locator('#result-details')).toContainText('Exact layout');
  await page.screenshot({ path: join(resultsDir, '09-scanned-exact.png'), fullPage: true });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('share button copies the app link and rejects old .doc files', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => { (window as unknown as { __copied?: string }).__copied = text; } },
      configurable: true,
    });
  });
  await page.reload();
  await page.click('#share-button');
  await expect(page.locator('.toast')).toContainText('Link copied');
  const copied = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '');
  expect(copied).toContain('/');

  const legacyDoc = join(resultsDir, 'legacy.doc');
  await writeFile(legacyDoc, Buffer.from('not a real doc'));
  await page.setInputFiles('#file-input', legacyDoc);
  await expect(page.locator('#idle-alert')).toContainText('Older .doc files');

  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: join(resultsDir, '10-landing-dark.png'), fullPage: true });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('mobile layout renders cleanly', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('#hero-title')).toBeVisible();
  await page.screenshot({ path: join(resultsDir, '11-mobile-light.png'), fullPage: true });

  await page.setInputFiles('#file-input', sampleDocx);
  await expect(page.locator('#file-panel')).toBeVisible();
  await page.screenshot({ path: join(resultsDir, '12-mobile-file.png'), fullPage: true });

  expect(errors, errors.join('\n')).toEqual([]);
});
