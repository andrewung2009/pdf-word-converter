import './styles.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { AppError, isAbortError, UserCancelledError } from './lib/errors';
import { byId, clamp, prefersReducedMotion } from './lib/dom';
import { downloadBlob, formatBytes, formatPages, inspectFile, outputFilename } from './lib/files';
import { convertPdfWithHighFidelity, destroyHighFidelityEngine, type EngineStage } from './lib/highFidelityEngine';
import { probePdf } from './lib/pdfProbe';
import type { ConversionMode, ConversionResult, EngineChoice, OutputStyle, ProgressUpdate } from './types';

type Theme = 'light' | 'dark';

const MODE_KEY = 'pdfword-mode';
const THEME_KEY = 'pdfword-theme';
const STYLE_KEY = 'pdfword-output-style';
const ENGINE_KEY = 'pdfword-pdf-engine';

const elements = {
  themeToggle: byId<HTMLButtonElement>('theme-toggle'),
  shareButton: byId<HTMLButtonElement>('share-button'),
  modeDocxPdf: byId<HTMLButtonElement>('mode-docx-pdf'),
  modePdfDocx: byId<HTMLButtonElement>('mode-pdf-docx'),
  toolCard: byId('tool-card'),
  idleState: byId('idle-state'),
  busyState: byId('busy-state'),
  resultState: byId('result-state'),
  dropzone: byId<HTMLDivElement>('dropzone'),
  fileInput: byId<HTMLInputElement>('file-input'),
  sampleButton: byId<HTMLButtonElement>('sample-button'),
  sampleLabel: byId('sample-label'),
  formatNote: byId('format-note'),
  filePanel: byId('file-panel'),
  fileName: byId('file-name'),
  fileSub: byId('file-sub'),
  removeFile: byId<HTMLButtonElement>('remove-file'),
  outputOptions: byId<HTMLFieldSetElement>('output-options'),
  selectableDesc: byId('selectable-desc'),
  exactDesc: byId('exact-desc'),
  outputHint: byId('output-hint'),
  engineSettings: byId<HTMLButtonElement>('engine-settings'),
  fileWarning: byId('file-warning'),
  fileWarningTitle: byId('file-warning-title'),
  fileWarningText: byId('file-warning-text'),
  inlineAlert: byId('inline-alert'),
  inlineAlertTitle: byId('inline-alert-title'),
  inlineAlertText: byId('inline-alert-text'),
  idleAlert: byId('idle-alert'),
  idleAlertTitle: byId('idle-alert-title'),
  idleAlertText: byId('idle-alert-text'),
  convertButton: byId<HTMLButtonElement>('convert-button'),
  changeFile: byId<HTMLButtonElement>('change-file'),
  busyTitle: byId('busy-title'),
  busySub: byId('busy-sub'),
  progress: byId('progress'),
  progressFill: byId('progress-fill'),
  progressLabel: byId('progress-label'),
  progressPercent: byId('progress-percent'),
  cancelButton: byId<HTMLButtonElement>('cancel-button'),
  resultTitle: byId('result-title'),
  resultMeta: byId('result-meta'),
  resultPreview: byId('result-preview'),
  resultDetails: byId('result-details'),
  resultAlert: byId('result-alert'),
  resultAlertTitle: byId('result-alert-title'),
  resultAlertText: byId('result-alert-text'),
  primaryButton: byId<HTMLButtonElement>('primary-button'),
  primaryLabel: byId('primary-label'),
  primaryIconUse: byId('primary-icon-use'),
  fallbackDownload: byId<HTMLButtonElement>('fallback-download'),
  resultHint: byId('result-hint'),
  tryHighFidelity: byId<HTMLButtonElement>('try-high-fidelity'),
  switchExact: byId<HTMLButtonElement>('switch-exact'),
  convertAnother: byId<HTMLButtonElement>('convert-another'),
  dragOverlay: byId('drag-overlay'),
  toastStack: byId('toast-stack'),
  passwordDialog: byId<HTMLDialogElement>('password-dialog'),
  passwordForm: byId<HTMLFormElement>('password-form'),
  passwordInput: byId<HTMLInputElement>('password-input'),
  passwordMessage: byId('password-message'),
  passwordError: byId('password-error'),
  passwordCancel: byId<HTMLButtonElement>('password-cancel'),
  engineDialog: byId<HTMLDialogElement>('engine-dialog'),
  engineCancel: byId<HTMLButtonElement>('engine-cancel'),
  engineFast: byId<HTMLButtonElement>('engine-fast'),
  engineHigh: byId<HTMLButtonElement>('engine-high'),
  renderStage: byId('render-stage'),
};

const state: {
  mode: ConversionMode;
  style: OutputStyle;
  engine: EngineChoice | null;
  file: File | null;
  fileLabel: string;
  busy: boolean;
  abort: AbortController | null;
  result: ConversionResult | null;
} = {
  mode: readMode(),
  style: readStyle(),
  engine: readEngineChoice(),
  file: null,
  fileLabel: '',
  busy: false,
  abort: null,
  result: null,
};

let passwordResolver: ((value: string | null) => void) | null = null;
let engineChoiceResolver: ((value: EngineChoice | null) => void) | null = null;
let primaryAction: 'download' | 'print' = 'download';
let dragDepth = 0;

function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function readMode(): ConversionMode {
  return safeStorageGet(MODE_KEY) === 'pdf-to-docx' ? 'pdf-to-docx' : 'docx-to-pdf';
}

function readStyle(): OutputStyle {
  return safeStorageGet(STYLE_KEY) === 'exact' ? 'exact' : 'selectable';
}

function readEngineChoice(): EngineChoice | null {
  const value = safeStorageGet(ENGINE_KEY);
  return value === 'high' || value === 'fast' ? value : null;
}

function currentStyle(): OutputStyle {
  const checked = document.querySelector<HTMLInputElement>('input[name="output-style"]:checked');
  return checked?.value === 'exact' ? 'exact' : 'selectable';
}

function showToast(message: string, duration = 3400): void {
  while (elements.toastStack.children.length >= 2) {
    elements.toastStack.firstElementChild?.remove();
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  elements.toastStack.append(toast);
  window.setTimeout(() => {
    toast.style.transition = 'opacity 160ms ease';
    toast.style.opacity = '0';
    window.setTimeout(() => toast.remove(), 180);
  }, duration);
}

function applyTheme(theme: Theme, persist = false): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  elements.themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0F0F10' : '#F7F6F3');
  if (persist) safeStorageSet(THEME_KEY, theme);
}

function initTheme(): void {
  const theme: Theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  applyTheme(theme);
  elements.themeToggle.addEventListener('click', () => {
    const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
  });
}

function updateTabs(): void {
  const tabs: Array<[HTMLButtonElement, ConversionMode]> = [
    [elements.modeDocxPdf, 'docx-to-pdf'],
    [elements.modePdfDocx, 'pdf-to-docx'],
  ];
  for (const [tab, value] of tabs) {
    const selected = value === state.mode;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  const activeId = state.mode === 'docx-to-pdf' ? 'mode-docx-pdf' : 'mode-pdf-docx';
  elements.toolCard.setAttribute('role', 'tabpanel');
  elements.toolCard.setAttribute('aria-labelledby', activeId);
}

function updateModeCopy(): void {
  const wordMode = state.mode === 'docx-to-pdf';
  byId('dz-title').textContent = wordMode ? 'Drop your .docx here' : 'Drop your .pdf here';
  elements.formatNote.textContent = wordMode
    ? 'Word document (.docx) · up to ~25 MB recommended'
    : 'PDF document (.pdf) · up to ~25 MB recommended';
  elements.fileInput.accept = wordMode
    ? '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : '.pdf,application/pdf';
  elements.outputOptions.hidden = false;
  elements.convertButton.textContent = wordMode ? 'Convert to PDF' : 'Convert to Word';
  elements.formatNote.title = wordMode ? 'Accepts .docx only. For .doc, save as .docx first.' : 'Accepts .pdf files.';
  updateOutputCopy();
}

function updateOutputCopy(): void {
  const wordMode = state.mode === 'docx-to-pdf';
  if (wordMode) {
    elements.selectableDesc.textContent =
      'Save a real, selectable PDF through the print dialog. Layout and images stay exact.';
    elements.exactDesc.textContent = 'Download a page-perfect image PDF with a searchable text layer.';
    elements.outputHint.textContent =
      state.style === 'selectable'
        ? 'You’ll confirm “Save as PDF” in your browser’s print dialog.'
        : 'Downloads an image PDF immediately; text is searchable but not vector.';
    elements.engineSettings.hidden = true;
    return;
  }

  elements.selectableDesc.textContent =
    'High-fidelity editable text and images. Complex layouts may still shift.';
  elements.exactDesc.textContent = 'Each page becomes an image. Perfect visuals, but the text is not editable.';
  elements.outputHint.textContent =
    state.style === 'selectable'
      ? state.engine === 'high'
        ? 'High-fidelity engine selected. First use downloads about 50–55 MB.'
        : state.engine === 'fast'
          ? 'Fast converter selected. High fidelity is available for better tables and images.'
          : 'Choose the conversion engine on your first high-fidelity conversion.'
      : 'Exact layout stores each page as an image; text is not editable.';
  elements.engineSettings.hidden = state.style !== 'selectable';
  elements.engineSettings.textContent =
    state.engine === 'high'
      ? 'Engine: High fidelity · Change'
      : state.engine === 'fast'
        ? 'Engine: Fast · Change'
        : 'Engine: Choose high-fidelity or fast mode';
}

function setTabsEnabled(enabled: boolean): void {
  elements.modeDocxPdf.disabled = !enabled;
  elements.modePdfDocx.disabled = !enabled;
}

function hideAlerts(): void {
  elements.idleAlert.hidden = true;
  elements.inlineAlert.hidden = true;
  elements.fileWarning.hidden = true;
  elements.resultAlert.hidden = true;
}

function showIdleAlert(title: string, text: string): void {
  elements.idleAlertTitle.textContent = title;
  elements.idleAlertText.textContent = text;
  elements.idleAlert.hidden = false;
  elements.idleAlert.tabIndex = -1;
  elements.idleAlert.focus({ preventScroll: true });
}

function showInlineAlert(title: string, text: string): void {
  elements.inlineAlertTitle.textContent = title;
  elements.inlineAlertText.textContent = text;
  elements.inlineAlert.hidden = false;
  elements.inlineAlert.tabIndex = -1;
  elements.inlineAlert.focus({ preventScroll: true });
}

function showResultAlert(title: string, text: string): void {
  elements.resultAlertTitle.textContent = title;
  elements.resultAlertText.textContent = text;
  elements.resultAlert.hidden = false;
}

function setFilePanelVisible(visible: boolean): void {
  elements.filePanel.hidden = !visible;
  elements.dropzone.hidden = visible;
  const underDrop = elements.dropzone.parentElement?.querySelector<HTMLElement>('.under-drop');
  if (underDrop) underDrop.hidden = visible;
}

function updateFilePanel(): void {
  if (!state.file) {
    setFilePanelVisible(false);
    return;
  }
  const kindLabel = state.mode === 'docx-to-pdf' ? 'Word document' : 'PDF document';
  elements.fileName.textContent = state.file.name;
  elements.fileName.title = state.file.name;
  elements.fileSub.textContent = `${formatBytes(state.file.size)} · ${kindLabel}`;
  elements.outputOptions.hidden = false;
  elements.convertButton.textContent = state.mode === 'docx-to-pdf' ? 'Convert to PDF' : 'Convert to Word';
  updateOutputCopy();

  const sizeMb = state.file.size / (1024 * 1024);
  if (sizeMb > 25) {
    elements.fileWarningTitle.textContent = 'This is a large file';
    elements.fileWarningText.textContent = `At ${formatBytes(state.file.size)}, conversion may take longer and use more memory. Continue when you’re ready.`;
    elements.fileWarning.hidden = false;
  } else {
    elements.fileWarning.hidden = true;
  }
}

function clearPreview(): void {
  elements.resultPreview.replaceChildren();
  elements.resultDetails.replaceChildren();
  elements.renderStage.replaceChildren();
}

function resetToIdle(options: { keepFile?: boolean; message?: string } = {}): void {
  const keepFile = Boolean(options.keepFile && state.file);
  elements.idleState.hidden = false;
  elements.busyState.hidden = true;
  elements.resultState.hidden = true;
  elements.busyTitle.textContent = 'Converting…';
  elements.busySub.textContent = 'Reading your file';
  elements.progress.classList.remove('is-indeterminate');
  elements.progressFill.style.width = '0%';
  elements.progress.setAttribute('aria-valuenow', '0');
  elements.progressPercent.textContent = '0%';
  elements.progressLabel.textContent = state.file?.name ?? '';
  elements.cancelButton.disabled = false;
  elements.primaryButton.disabled = false;
  primaryAction = 'download';
  hideAlerts();
  clearPreview();
  state.result = null;

  if (!keepFile) {
    state.file = null;
    state.fileLabel = '';
    setFilePanelVisible(false);
  } else {
    setFilePanelVisible(true);
    updateFilePanel();
  }
  elements.fileInput.value = '';
  setTabsEnabled(true);

  if (options.message) showToast(options.message);
}

function setMode(next: ConversionMode, options: { reset?: boolean; silent?: boolean } = {}): void {
  if (state.busy) return;
  if (next === state.mode) {
    if (options.reset) resetToIdle();
    updateModeCopy();
    return;
  }
  state.mode = next;
  safeStorageSet(MODE_KEY, next);
  updateTabs();
  updateModeCopy();
  if (options.reset !== false) {
    resetToIdle();
  }
  if (!options.silent) {
    void preloadForMode(next);
  }
}

function preloadForMode(mode: ConversionMode): void {
  if (mode === 'docx-to-pdf') {
    void import('./converters/docxToPdf');
  } else {
    void import('./converters/pdfToDocx');
    void import('./lib/pdfjs').then((module) => module.loadPdfjs());
  }
}

async function handleFile(file: File): Promise<void> {
  if (state.busy) {
    showToast('Wait for the current conversion to finish.');
    return;
  }
  resetToIdle();

  const inspected = await inspectFile(file);

  if (inspected.kind === 'doc') {
    showIdleAlert(
      'Older .doc files aren’t supported',
      'Open the file in Word and use File → Save As → Word Document (.docx), then drop it here.',
    );
    return;
  }

  if (inspected.kind === 'unknown') {
    showIdleAlert(
      'That file type isn’t supported',
      'Choose a .docx Word document or a .pdf file. Old .doc files need to be saved as .docx first.',
    );
    return;
  }

  if (inspected.kind !== 'pdf' && inspected.kind !== 'docx') {
    showIdleAlert('That file isn’t supported', 'Choose a .docx Word document or a .pdf file.');
    return;
  }

  if (inspected.looksCorrupt) {
    showIdleAlert(
      'Couldn’t read this file',
      'It may be damaged or not a real document. Try opening it in Word or a PDF reader, then save a fresh copy.',
    );
    return;
  }

  const expected: ConversionMode = inspected.kind === 'pdf' ? 'pdf-to-docx' : 'docx-to-pdf';
  if (expected !== state.mode) {
    setMode(expected, { reset: true, silent: true });
    showToast(`Switched to ${expected === 'pdf-to-docx' ? 'PDF → Word' : 'Word → PDF'} for this file.`);
  }

  if (file.size > 100 * 1024 * 1024) {
    showIdleAlert(
      'This file is too large for the browser',
      'Please use a file under 100 MB. Very large documents are best handled on a desktop computer.',
    );
    return;
  }

  state.file = file;
  state.fileLabel = file.name;
  elements.progressLabel.textContent = file.name;
  setFilePanelVisible(true);
  updateFilePanel();
  elements.idleState.hidden = false;
  elements.busyState.hidden = true;
  elements.resultState.hidden = true;
  elements.inlineAlert.hidden = true;
  elements.idleAlert.hidden = true;
  elements.convertButton.focus({ preventScroll: true });
}

function setProgress(update: ProgressUpdate): void {
  if (typeof update.percent === 'number') {
    const percent = clamp(Math.round(update.percent), 0, 100);
    elements.progress.classList.remove('is-indeterminate');
    elements.progressFill.style.width = `${percent}%`;
    elements.progress.setAttribute('aria-valuenow', String(percent));
    elements.progressPercent.textContent = `${percent}%`;
  }
  elements.busySub.textContent = update.stage;
  elements.progress.setAttribute('aria-valuetext', update.stage);
}

function setEngineProgress(stage: EngineStage): void {
  const copy: Record<EngineStage, string> = {
    loading: 'Loading the high-fidelity engine (one-time download)…',
    converting: 'Converting with the high-fidelity engine…',
    packaging: 'Packaging your .docx…',
  };
  elements.progress.classList.add('is-indeterminate');
  elements.progressFill.style.width = '38%';
  elements.progress.removeAttribute('aria-valuenow');
  elements.progressPercent.textContent = '…';
  elements.busySub.textContent = copy[stage];
  elements.progress.setAttribute('aria-valuetext', copy[stage]);
}

function askEngineChoice(): Promise<EngineChoice | null> {
  if (engineChoiceResolver) return Promise.resolve(null);
  elements.engineDialog.showModal();
  return new Promise((resolve) => {
    engineChoiceResolver = resolve;
  });
}

function finishEngineChoice(choice: EngineChoice | null): void {
  const resolve = engineChoiceResolver;
  engineChoiceResolver = null;
  if (elements.engineDialog.open) elements.engineDialog.close();
  if (choice) {
    state.engine = choice;
    safeStorageSet(ENGINE_KEY, choice);
    updateOutputCopy();
  }
  resolve?.(choice);
}

async function shareApp(): Promise<void> {
  const url = window.location.href.split('#')[0];
  const payload = {
    title: 'PDF ⇄ Word',
    text: 'Private Word and PDF conversion, right in your browser.',
    url,
  };

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(payload);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    showToast('Link copied to clipboard.');
  } catch {
    showToast(`Share this link: ${url}`, 6500);
  }
}

function askPassword(incorrect: boolean): Promise<string | null> {
  if (passwordResolver) {
    passwordResolver(null);
    passwordResolver = null;
  }

  elements.passwordMessage.textContent = incorrect
    ? 'That password didn’t work. Check it and try again.'
    : 'This PDF is password-protected. Enter the password to continue.';
  elements.passwordError.textContent = 'That password didn’t work. Try again.';
  elements.passwordError.hidden = !incorrect;
  elements.passwordInput.value = '';
  if (!elements.passwordDialog.open) elements.passwordDialog.showModal();
  window.setTimeout(() => elements.passwordInput.focus(), 30);

  return new Promise((resolve) => {
    passwordResolver = resolve;
  });
}

function finishPassword(value: string | null): void {
  const resolve = passwordResolver;
  passwordResolver = null;
  if (elements.passwordDialog.open) elements.passwordDialog.close();
  resolve?.(value);
}

function addDetail(label: string, value: string): void {
  const row = document.createElement('div');
  row.className = 'detail-row';
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  row.append(term, description);
  elements.resultDetails.append(row);
}

function renderPreview(
  result: ConversionResult,
  context: { mode: ConversionMode; style: OutputStyle; engine?: EngineChoice },
): void {
  elements.resultPreview.replaceChildren();

  if (result.previewImages?.length) {
    result.previewImages.forEach((source, index) => {
      const image = document.createElement('img');
      image.className = 'page-shot';
      image.src = source;
      image.alt = `Preview of page ${index + 1}`;
      image.loading = index === 0 ? 'eager' : 'lazy';
      elements.resultPreview.append(image);
    });
    if (result.pageCount > result.previewImages.length) {
      const caption = document.createElement('p');
      caption.className = 'preview-caption';
      caption.textContent = `Showing ${result.previewImages.length} of ${result.pageCount} pages. Download for the full file.`;
      elements.resultPreview.append(caption);
    }
    return;
  }

  if (context.mode === 'pdf-to-docx' && context.style === 'selectable' && result.previewText) {
    const text = document.createElement('div');
    text.className = 'text-preview';
    text.textContent = result.previewText;
    const caption = document.createElement('p');
    caption.className = 'preview-caption';
    caption.textContent =
      context.engine === 'high'
        ? 'Preview of the extracted text. The high-fidelity .docx also includes tables and images.'
        : result.images
          ? 'Preview of the extracted text. Images from the PDF are embedded in the .docx.'
          : 'Preview of the extracted text. Open the .docx to see the full document.';
    elements.resultPreview.append(text, caption);
    return;
  }

  const empty = document.createElement('div');
  empty.className = 'preview-empty';
  empty.textContent =
    context.mode === 'pdf-to-docx'
      ? 'No text preview is available. Download the Word file to view it.'
      : 'Preview is not available. Download the PDF to view it.';
  elements.resultPreview.append(empty);
}

function showResult(
  result: ConversionResult,
  source: File,
  context: {
    mode: ConversionMode;
    style: OutputStyle;
    engine?: EngineChoice;
    fallbackReason?: string;
  },
): void {
  state.result = result;
  const wordOutput = context.mode === 'docx-to-pdf';
  const selectableWord = wordOutput && context.style === 'selectable';

  elements.idleState.hidden = true;
  elements.busyState.hidden = true;
  elements.resultState.hidden = false;
  elements.resultTitle.textContent = selectableWord
    ? 'Ready to save your selectable PDF.'
    : result.kind === 'pdf'
      ? 'Done. Your PDF is ready.'
      : 'Done. Your Word file is ready.';
  elements.resultMeta.textContent = selectableWord
    ? `${result.filename} · ${formatPages(result.pageCount)} · Selectable PDF`
    : `${result.filename} · ${formatBytes(result.blob.size)} · ${formatPages(result.pageCount)}`;

  primaryAction = selectableWord ? 'print' : 'download';
  elements.primaryButton.disabled = false;
  elements.primaryButton.hidden = false;
  elements.primaryLabel.textContent = selectableWord
    ? 'Save selectable PDF'
    : result.kind === 'pdf'
      ? 'Download PDF'
      : 'Download Word file';
  elements.primaryIconUse.setAttribute('href', selectableWord ? '#icon-printer' : '#icon-download');
  elements.fallbackDownload.hidden = !selectableWord;
  elements.fallbackDownload.textContent = 'Download image PDF instead';
  elements.resultHint.hidden = true;
  elements.tryHighFidelity.hidden = true;
  elements.switchExact.hidden = true;
  elements.resultDetails.replaceChildren();

  const method =
    context.mode === 'pdf-to-docx'
      ? context.style === 'exact'
        ? 'Exact layout (page images)'
        : context.engine === 'high'
          ? 'Selectable text + images (high fidelity)'
          : 'Selectable text + images (fast)'
      : context.style === 'selectable'
        ? 'Selectable text (vector via print)'
        : 'Exact layout (image PDF + searchable layer)';

  addDetail('Source', `${source.name} · ${formatBytes(source.size)}`);
  addDetail(
    'Output',
    selectableWord
      ? `${result.filename} · vector PDF via print`
      : `${result.filename} · ${formatBytes(result.blob.size)}`,
  );
  addDetail('Pages', String(result.pageCount));
  if (result.images && result.images > 0) addDetail('Images', String(result.images));
  if (context.mode === 'pdf-to-docx' && context.style === 'selectable') {
    addDetail(
      'Engine',
      context.engine === 'high'
        ? 'pdf2docx (on-device)'
        : context.engine === 'fast'
          ? 'Fast converter (on-device)'
          : 'On-device',
    );
  }
  addDetail('Method', method);
  if (selectableWord) addDetail('Fallback', `${formatBytes(result.blob.size)} image PDF`);

  const hint = selectableWord
    ? 'In the print dialog, choose “Save as PDF.” The file stays on your device.'
    : context.mode === 'pdf-to-docx' && context.style === 'exact'
      ? 'Pages are images; text is not editable.'
      : context.mode === 'pdf-to-docx' && context.engine === 'high'
        ? 'Editable text and images. Complex layouts can still shift.'
        : context.mode === 'pdf-to-docx' && context.engine === 'fast'
          ? 'Fast editable text and images. Use the high-fidelity engine for better tables and layouts.'
          : 'Page-perfect image PDF with a searchable text layer.';
  if (!context.fallbackReason && hint) {
    elements.resultHint.textContent = hint;
    elements.resultHint.hidden = false;
  }

  elements.resultAlert.classList.remove('warning');
  elements.resultAlert.hidden = true;
  if (context.fallbackReason) {
    elements.resultAlert.classList.add('warning');
    showResultAlert('High-fidelity engine unavailable', `${context.fallbackReason} The fast converter was used.`);
  } else if (result.scanned) {
    elements.resultAlert.classList.add('warning');
    showResultAlert(
      'This PDF has little or no selectable text',
      'It looks like a scan. Switch to Exact layout to keep the page looking right. OCR is not included.',
    );
  }

  const canTryHigh =
    context.mode === 'pdf-to-docx' &&
    context.style === 'selectable' &&
    context.engine === 'fast' &&
    !result.scanned &&
    !context.fallbackReason;
  elements.tryHighFidelity.hidden = !canTryHigh;
  elements.tryHighFidelity.textContent = context.fallbackReason
    ? 'Try high fidelity again'
    : 'Try the high-fidelity engine';

  const canSwitchExact =
    context.mode === 'pdf-to-docx' &&
    context.style === 'selectable' &&
    (Boolean(result.scanned) || Boolean(context.fallbackReason));
  elements.switchExact.hidden = !canSwitchExact;
  elements.switchExact.textContent = 'Switch to Exact layout';

  renderPreview(result, context);
  elements.resultState.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  window.setTimeout(() => elements.primaryButton.focus({ preventScroll: true }), 80);
}

async function startConversion(
  overrides: { style?: OutputStyle; engine?: EngineChoice } = {},
): Promise<void> {
  if (!state.file || state.busy) return;

  const source = state.file;
  const mode = state.mode;
  const style = overrides.style ?? state.style;
  if (style !== state.style) {
    state.style = style;
    safeStorageSet(STYLE_KEY, style);
    const radio = document.querySelector<HTMLInputElement>(`input[name="output-style"][value="${style}"]`);
    if (radio) radio.checked = true;
    updateOutputCopy();
  }

  let engine = mode === 'pdf-to-docx' ? overrides.engine ?? state.engine : null;
  if (mode === 'pdf-to-docx' && style === 'selectable' && !engine) {
    const choice = await askEngineChoice();
    if (!choice) return;
    engine = choice;
  }

  state.busy = true;
  state.abort = new AbortController();
  hideAlerts();
  elements.idleState.hidden = true;
  elements.resultState.hidden = true;
  elements.busyState.hidden = false;
  elements.resultState.setAttribute('aria-busy', 'true');
  elements.busyTitle.textContent =
    mode === 'docx-to-pdf'
      ? style === 'selectable'
        ? 'Preparing your selectable PDF'
        : 'Converting Word → PDF'
      : style === 'exact'
        ? 'Converting PDF → Word (exact layout)'
        : engine === 'high'
          ? 'Converting PDF → Word (high fidelity)'
          : 'Converting PDF → Word';
  elements.busySub.textContent = mode === 'docx-to-pdf' ? 'Reading your Word document…' : 'Reading your PDF…';
  elements.progressLabel.textContent = source.name;
  elements.progress.classList.remove('is-indeterminate');
  elements.progressFill.style.width = '0%';
  elements.progressPercent.textContent = '0%';
  elements.progress.setAttribute('aria-valuenow', '0');
  elements.cancelButton.disabled = false;
  setTabsEnabled(false);

  const signal = state.abort.signal;
  const onProgress = (update: ProgressUpdate) => setProgress(update);
  let fallbackReason: string | undefined;
  let engineUsed: EngineChoice | undefined;
  let result: ConversionResult | null = null;

  const fastPdfToWord = async (): Promise<ConversionResult> => {
    const { convertPdfToDocx } = await import('./converters/pdfToDocx');
    return convertPdfToDocx(source, {
      signal,
      onProgress,
      mode: 'text',
      getPassword: askPassword,
    });
  };

  try {
    if (mode === 'docx-to-pdf') {
      const { convertDocxToPdf } = await import('./converters/docxToPdf');
      result = await convertDocxToPdf(source, {
        signal,
        onProgress,
        renderStage: elements.renderStage,
      });
    } else if (style === 'exact') {
      const { convertPdfToDocx } = await import('./converters/pdfToDocx');
      result = await convertPdfToDocx(source, {
        signal,
        onProgress,
        mode: 'image',
        getPassword: askPassword,
      });
    } else if (engine === 'high') {
      setProgress({ stage: 'Checking your PDF…', percent: 4 });
      const probe = await probePdf(source, signal);
      if (probe.encrypted) {
        fallbackReason = 'High-fidelity mode does not support password-protected PDFs.';
        engineUsed = 'fast';
        elements.busySub.textContent = 'Password-protected PDF; using fast mode…';
        result = await fastPdfToWord();
      } else if (probe.scanned) {
        engineUsed = 'fast';
        elements.busySub.textContent = 'This PDF looks scanned; using fast mode…';
        result = await fastPdfToWord();
      } else {
        try {
          elements.busySub.textContent = 'Starting the high-fidelity engine…';
          const pdfBytes = await source.arrayBuffer();
          if (signal.aborted) throw new UserCancelledError();
          const docx = await convertPdfWithHighFidelity(pdfBytes, {
            signal,
            onStatus: (stage) => setEngineProgress(stage),
          });
          if (signal.aborted) throw new UserCancelledError();
          result = {
            blob: docx,
            filename: outputFilename(source.name, 'docx'),
            kind: 'docx',
            pageCount: probe.pageCount,
            previewText: probe.previewText,
            scanned: false,
          };
          engineUsed = 'high';
        } catch (error) {
          if (isAbortError(error) || signal.aborted) throw error;
          fallbackReason =
            error instanceof AppError
              ? error.detail ?? error.title
              : 'The high-fidelity engine could not finish this PDF.';
          engineUsed = 'fast';
          elements.busySub.textContent = 'High-fidelity engine failed; using fast mode…';
          result = await fastPdfToWord();
        }
      }
    } else {
      engineUsed = 'fast';
      result = await fastPdfToWord();
    }

    if (!result) throw new AppError('Conversion produced no result', 'Try again with a different file.');
    if (signal.aborted) throw new UserCancelledError();
    showResult(result, source, { mode, style, engine: engineUsed, fallbackReason });
  } catch (error) {
    resetToIdle({ keepFile: true });
    if (error instanceof UserCancelledError || isAbortError(error) || signal.aborted) {
      showToast('Conversion cancelled.');
    } else if (error instanceof AppError) {
      showInlineAlert(error.title, error.detail ?? 'Try a different file or a different conversion mode.');
    } else {
      console.error(error);
      showInlineAlert(
        'Something went wrong during conversion',
        'Try again, or use a different file. Very complex documents may not convert reliably in a browser.',
      );
    }
  } finally {
    state.busy = false;
    state.abort = null;
    setTabsEnabled(true);
    elements.resultState.removeAttribute('aria-busy');
  }
}

async function openPrintView(filename: string): Promise<void> {
  try {
    const { printDocxStage } = await import('./converters/docxToPdf');
    await printDocxStage(elements.renderStage, filename);
  } catch (error) {
    if (error instanceof AppError) {
      showResultAlert(error.title, error.detail ?? 'Use the image PDF fallback instead.');
    } else {
      showResultAlert('Couldn’t open the print view', 'Use the image PDF fallback instead, or try a different browser.');
    }
  }
}

async function loadSample(): Promise<void> {  if (state.busy) return;
  const extension = state.mode === 'docx-to-pdf' ? 'docx' : 'pdf';
  elements.sampleButton.disabled = true;
  elements.sampleLabel.textContent = 'Loading sample…';
  try {
    const url = new URL(`samples/sample.${extension}`, document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Sample request failed: ${response.status}`);
    const blob = await response.blob();
    const file = new File([blob], `Welcome-to-PDF-Word.${extension}`, {
      type:
        extension === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await handleFile(file);
  } catch {
    showIdleAlert('Couldn’t load the sample file', 'Drop your own file instead, or check your connection and try again.');
  } finally {
    elements.sampleButton.disabled = false;
    elements.sampleLabel.textContent = 'Try a sample';
  }
}

function wireEvents(): void {
  elements.shareButton.addEventListener('click', () => void shareApp());
  elements.modeDocxPdf.addEventListener('click', () => setMode('docx-to-pdf'));
  elements.modePdfDocx.addEventListener('click', () => setMode('pdf-to-docx'));

  const tabButtons = [elements.modeDocxPdf, elements.modePdfDocx];
  tabButtons.forEach((tab, index) => {
    tab.addEventListener('keydown', (event) => {
      let nextIndex = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabButtons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabButtons.length - 1;
      else return;
      event.preventDefault();
      const next = tabButtons[nextIndex];
      next.focus();
      next.click();
    });
    tab.addEventListener('pointerenter', () => void preloadForMode(tab.dataset.mode as ConversionMode));
    tab.addEventListener('focus', () => void preloadForMode(tab.dataset.mode as ConversionMode));
  });

  elements.dropzone.addEventListener('click', () => elements.fileInput.click());
  elements.dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      elements.fileInput.click();
    }
  });

  elements.dropzone.addEventListener('dragenter', (event) => {
    if (!state.busy) {
      event.preventDefault();
      elements.dropzone.classList.add('is-dragover');
    }
  });
  elements.dropzone.addEventListener('dragleave', () => elements.dropzone.classList.remove('is-dragover'));
  elements.dropzone.addEventListener('drop', () => elements.dropzone.classList.remove('is-dragover'));

  elements.fileInput.addEventListener('change', () => {
    const file = elements.fileInput.files?.[0];
    elements.fileInput.value = '';
    if (file) void handleFile(file);
  });

  elements.sampleButton.addEventListener('click', () => void loadSample());
  elements.removeFile.addEventListener('click', () => resetToIdle());
  elements.changeFile.addEventListener('click', () => elements.fileInput.click());
  elements.convertButton.addEventListener('click', () => void startConversion());

  document.querySelectorAll<HTMLInputElement>('input[name="output-style"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      state.style = currentStyle();
      safeStorageSet(STYLE_KEY, state.style);
      updateOutputCopy();
    });
  });

  elements.engineSettings.addEventListener('click', () => {
    void askEngineChoice();
  });
  elements.engineHigh.addEventListener('click', () => finishEngineChoice('high'));
  elements.engineFast.addEventListener('click', () => finishEngineChoice('fast'));
  elements.engineCancel.addEventListener('click', () => finishEngineChoice(null));
  elements.engineDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finishEngineChoice(null);
  });
  elements.engineDialog.addEventListener('close', () => {
    if (engineChoiceResolver) {
      const resolve = engineChoiceResolver;
      engineChoiceResolver = null;
      resolve(null);
    }
  });

  elements.cancelButton.addEventListener('click', () => {
    elements.cancelButton.disabled = true;
    elements.busySub.textContent = 'Cancelling…';
    state.abort?.abort();
  });

  elements.primaryButton.addEventListener('click', () => {
    if (!state.result) return;
    if (primaryAction === 'print') {
      void openPrintView(state.result.filename);
      return;
    }
    downloadBlob(state.result.blob, state.result.filename);
    showToast(`Download started: ${state.result.filename}`);
  });

  elements.fallbackDownload.addEventListener('click', () => {
    if (!state.result) return;
    downloadBlob(state.result.blob, state.result.filename);
    showToast(`Downloaded image PDF: ${state.result.filename}`);
  });

  elements.tryHighFidelity.addEventListener('click', () => {
    if (state.busy || !state.file) return;
    state.engine = 'high';
    safeStorageSet(ENGINE_KEY, 'high');
    updateOutputCopy();
    void startConversion({ style: 'selectable', engine: 'high' });
  });

  elements.switchExact.addEventListener('click', () => {
    if (state.busy || !state.file) return;
    state.style = 'exact';
    safeStorageSet(STYLE_KEY, 'exact');
    const radio = document.querySelector<HTMLInputElement>('input[name="output-style"][value="exact"]');
    if (radio) radio.checked = true;
    updateOutputCopy();
    void startConversion({ style: 'exact' });
  });

  elements.convertAnother.addEventListener('click', () => {
    resetToIdle();
    elements.dropzone.focus({ preventScroll: true });
    elements.toolCard.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  });

  elements.passwordForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = elements.passwordInput.value;
    if (!value) {
      elements.passwordError.textContent = 'Enter the PDF password.';
      elements.passwordError.hidden = false;
      elements.passwordInput.focus();
      return;
    }
    finishPassword(value);
  });
  elements.passwordCancel.addEventListener('click', () => finishPassword(null));
  elements.passwordDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finishPassword(null);
  });
  elements.passwordDialog.addEventListener('close', () => {
    if (passwordResolver) {
      const resolve = passwordResolver;
      passwordResolver = null;
      resolve(null);
    }
  });

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event) || state.busy) return;
    event.preventDefault();
    dragDepth += 1;
    elements.dragOverlay.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event) && dragDepth === 0) return;
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) elements.dragOverlay.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    elements.dragOverlay.hidden = true;
    elements.dropzone.classList.remove('is-dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  });
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function init(): void {
  initTheme();
  updateTabs();
  updateModeCopy();
  const styleRadio = document.querySelector<HTMLInputElement>(
    `input[name="output-style"][value="${state.style}"]`,
  );
  if (styleRadio) styleRadio.checked = true;
  updateOutputCopy();
  setTabsEnabled(true);
  wireEvents();
  elements.passwordError.textContent = 'That password didn’t work. Try again.';
  window.addEventListener('pagehide', () => destroyHighFidelityEngine());
  if (state.mode === 'pdf-to-docx') void preloadForMode('pdf-to-docx');
}

init();
