import './styles.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { AppError, isAbortError, UserCancelledError } from './lib/errors';
import { byId, clamp, prefersReducedMotion } from './lib/dom';
import { downloadBlob, formatBytes, formatPages, inspectFile } from './lib/files';
import type { ConversionMode, ConversionResult, PdfOutputMode, ProgressUpdate } from './types';

type Theme = 'light' | 'dark';

const MODE_KEY = 'pdfword-mode';
const THEME_KEY = 'pdfword-theme';
const PDF_MODE_KEY = 'pdfword-pdf-mode';

const elements = {
  themeToggle: byId<HTMLButtonElement>('theme-toggle'),
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
  pdfOptions: byId<HTMLFieldSetElement>('pdf-options'),
  docxNote: byId('docx-note'),
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
  downloadButton: byId<HTMLButtonElement>('download-button'),
  downloadLabel: byId('download-label'),
  printButton: byId<HTMLButtonElement>('print-button'),
  imageModeButton: byId<HTMLButtonElement>('image-mode-button'),
  convertAnother: byId<HTMLButtonElement>('convert-another'),
  dragOverlay: byId('drag-overlay'),
  toastStack: byId('toast-stack'),
  passwordDialog: byId<HTMLDialogElement>('password-dialog'),
  passwordForm: byId<HTMLFormElement>('password-form'),
  passwordInput: byId<HTMLInputElement>('password-input'),
  passwordMessage: byId('password-message'),
  passwordError: byId('password-error'),
  passwordCancel: byId<HTMLButtonElement>('password-cancel'),
  renderStage: byId('render-stage'),
};

const state: {
  mode: ConversionMode;
  file: File | null;
  fileLabel: string;
  busy: boolean;
  abort: AbortController | null;
  result: ConversionResult | null;
  lastMode: ConversionMode | null;
  lastPdfMode: PdfOutputMode;
} = {
  mode: readMode(),
  file: null,
  fileLabel: '',
  busy: false,
  abort: null,
  result: null,
  lastMode: null,
  lastPdfMode: readPdfMode(),
};

let passwordResolver: ((value: string | null) => void) | null = null;
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

function readPdfMode(): PdfOutputMode {
  return safeStorageGet(PDF_MODE_KEY) === 'image' ? 'image' : 'text';
}

function currentPdfMode(): PdfOutputMode {
  const checked = document.querySelector<HTMLInputElement>('input[name="pdf-mode"]:checked');
  return checked?.value === 'image' ? 'image' : 'text';
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
  elements.pdfOptions.hidden = wordMode || !state.file;
  elements.docxNote.hidden = !wordMode;
  elements.convertButton.textContent = wordMode ? 'Convert to PDF' : 'Convert to Word';
  elements.formatNote.title = wordMode ? 'Accepts .docx only. For .doc, save as .docx first.' : 'Accepts .pdf files.';
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
  elements.pdfOptions.hidden = state.mode !== 'pdf-to-docx';
  elements.docxNote.hidden = state.mode !== 'docx-to-pdf';
  elements.convertButton.textContent = state.mode === 'docx-to-pdf' ? 'Convert to PDF' : 'Convert to Word';

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
  elements.progressFill.style.width = '0%';
  elements.progress.setAttribute('aria-valuenow', '0');
  elements.progressPercent.textContent = '0%';
  elements.progressLabel.textContent = state.file?.name ?? '';
  elements.cancelButton.disabled = false;
  hideAlerts();
  clearPreview();
  state.result = null;
  state.lastMode = null;

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
    elements.progressFill.style.width = `${percent}%`;
    elements.progress.setAttribute('aria-valuenow', String(percent));
    elements.progressPercent.textContent = `${percent}%`;
  }
  elements.busySub.textContent = update.stage;
  elements.progress.setAttribute('aria-valuetext', update.stage);
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

function renderPreview(result: ConversionResult, mode: ConversionMode, pdfMode: PdfOutputMode): void {
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

  if (mode === 'pdf-to-docx' && result.previewText && pdfMode === 'text') {
    const text = document.createElement('div');
    text.className = 'text-preview';
    text.textContent = result.previewText;
    const caption = document.createElement('p');
    caption.className = 'preview-caption';
    caption.textContent = 'Preview of the extracted text. Open the .docx to see the full document.';
    elements.resultPreview.append(text, caption);
    return;
  }

  const empty = document.createElement('div');
  empty.className = 'preview-empty';
  empty.textContent =
    mode === 'pdf-to-docx'
      ? 'No text preview is available. Download the Word file to view it.'
      : 'Preview is not available. Download the PDF to view it.';
  elements.resultPreview.append(empty);
}

function showResult(
  result: ConversionResult,
  source: File,
  mode: ConversionMode,
  pdfMode: PdfOutputMode,
): void {
  state.result = result;
  state.lastMode = mode;
  elements.idleState.hidden = true;
  elements.busyState.hidden = true;
  elements.resultState.hidden = false;
  elements.resultTitle.textContent = result.kind === 'pdf' ? 'Done. Your PDF is ready.' : 'Done. Your Word file is ready.';
  elements.resultMeta.textContent = `${result.filename} · ${formatBytes(result.blob.size)} · ${formatPages(result.pageCount)}`;
  elements.downloadLabel.textContent = result.kind === 'pdf' ? 'Download PDF' : 'Download Word file';
  elements.printButton.hidden = result.kind !== 'pdf';
  elements.imageModeButton.hidden = !(result.scanned && mode === 'pdf-to-docx' && pdfMode === 'text');
  elements.resultDetails.replaceChildren();

  const method = mode === 'pdf-to-docx' ? (pdfMode === 'text' ? 'Editable text' : 'Exact layout (images)') : 'High-quality pages';
  addDetail('Source', `${source.name} · ${formatBytes(source.size)}`);
  addDetail('Output', `${result.filename} · ${formatBytes(result.blob.size)}`);
  addDetail('Pages', String(result.pageCount));
  addDetail('Method', method);

  if (result.scanned) {
    elements.resultAlert.classList.add('warning');
    showResultAlert(
      'This PDF has little or no selectable text',
      'It looks like a scan. Convert it in “Exact layout (images)” mode to keep the page looking right. OCR is not included.',
    );
  } else {
    elements.resultAlert.classList.remove('warning');
    elements.resultAlert.hidden = true;
  }

  renderPreview(result, mode, pdfMode);

  if (mode === 'pdf-to-docx' && pdfMode === 'text') {
    elements.imageModeButton.hidden = !result.scanned;
  }

  elements.resultState.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  window.setTimeout(() => elements.downloadButton.focus({ preventScroll: true }), 80);
}

async function startConversion(forcedPdfMode?: PdfOutputMode): Promise<void> {
  if (!state.file || state.busy) return;

  const source = state.file;
  const mode = state.mode;
  const pdfMode = mode === 'pdf-to-docx' ? forcedPdfMode ?? currentPdfMode() : 'text';
  if (mode === 'pdf-to-docx') {
    state.lastPdfMode = pdfMode;
    safeStorageSet(PDF_MODE_KEY, pdfMode);
  }

  state.busy = true;
  state.abort = new AbortController();
  hideAlerts();
  elements.idleState.hidden = true;
  elements.resultState.hidden = true;
  elements.busyState.hidden = false;
  elements.resultState.setAttribute('aria-busy', 'true');
  elements.busyTitle.textContent = mode === 'docx-to-pdf' ? 'Converting Word → PDF' : 'Converting PDF → Word';
  elements.busySub.textContent = mode === 'docx-to-pdf' ? 'Reading your Word document…' : 'Reading your PDF…';
  elements.progressLabel.textContent = source.name;
  elements.progressFill.style.width = '0%';
  elements.progressPercent.textContent = '0%';
  elements.progress.setAttribute('aria-valuenow', '0');
  elements.cancelButton.disabled = false;
  setTabsEnabled(false);
  elements.busyState.focus?.({ preventScroll: true });

  const signal = state.abort.signal;
  const onProgress = (update: ProgressUpdate) => setProgress(update);

  try {
    let result: ConversionResult;
    if (mode === 'docx-to-pdf') {
      const { convertDocxToPdf } = await import('./converters/docxToPdf');
      result = await convertDocxToPdf(source, {
        signal,
        onProgress,
        renderStage: elements.renderStage,
      });
    } else {
      const { convertPdfToDocx } = await import('./converters/pdfToDocx');
      result = await convertPdfToDocx(source, {
        signal,
        onProgress,
        mode: pdfMode,
        getPassword: askPassword,
      });
    }
    if (signal.aborted) throw new UserCancelledError();
    showResult(result, source, mode, pdfMode);
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

async function loadSample(): Promise<void> {
  if (state.busy) return;
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

  document.querySelectorAll<HTMLInputElement>('input[name="pdf-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      state.lastPdfMode = currentPdfMode();
      safeStorageSet(PDF_MODE_KEY, state.lastPdfMode);
    });
  });

  elements.cancelButton.addEventListener('click', () => {
    elements.cancelButton.disabled = true;
    elements.busySub.textContent = 'Cancelling…';
    state.abort?.abort();
  });

  elements.downloadButton.addEventListener('click', () => {
    if (!state.result) return;
    downloadBlob(state.result.blob, state.result.filename);
    showToast(`Download started: ${state.result.filename}`);
  });

  elements.printButton.addEventListener('click', () => {
    void (async () => {
      try {
        const { printDocxStage } = await import('./converters/docxToPdf');
        await printDocxStage(elements.renderStage);
      } catch (error) {
        if (error instanceof AppError) showResultAlert(error.title, error.detail ?? 'Try downloading the PDF instead.');
        else showResultAlert('Couldn’t open the print view', 'Use Download instead, or try a different browser.');
      }
    })();
  });

  elements.imageModeButton.addEventListener('click', () => {
    if (state.busy || !state.file) return;
    const imageRadio = document.querySelector<HTMLInputElement>('input[name="pdf-mode"][value="image"]');
    if (imageRadio) imageRadio.checked = true;
    state.lastPdfMode = 'image';
    safeStorageSet(PDF_MODE_KEY, 'image');
    void startConversion('image');
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
  const savedPdfMode = state.lastPdfMode;
  const radio = document.querySelector<HTMLInputElement>(`input[name="pdf-mode"][value="${savedPdfMode}"]`);
  if (radio) radio.checked = true;
  setTabsEnabled(true);
  wireEvents();
  elements.passwordError.textContent = 'That password didn’t work. Try again.';
  if (state.mode === 'pdf-to-docx') void preloadForMode('pdf-to-docx');
}

init();
