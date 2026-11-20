import { AppError, UserCancelledError } from './errors';
import type { EngineToParent, EngineToWorker } from '../engine/protocol';

export type EngineStage = 'loading' | 'converting' | 'packaging';

interface PendingConversion {
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
  onStatus: (stage: EngineStage) => void;
  cleanup: () => void;
}

let engineFrame: HTMLIFrameElement | null = null;
let engineReady = false;
let readyPromise: Promise<void> | null = null;
let resolveReady: (() => void) | null = null;
let rejectReady: ((error: unknown) => void) | null = null;
let readyTimeout: number | null = null;
const pending = new Map<number, PendingConversion>();
let nextId = 1;

function assetBase(): string {
  return new URL('engine/pdf2docx/', document.baseURI).href;
}

function clearReadyTimeout(): void {
  if (readyTimeout !== null) {
    window.clearTimeout(readyTimeout);
    readyTimeout = null;
  }
}

function resetReadyState(): void {
  clearReadyTimeout();
  readyPromise = null;
  resolveReady = null;
  rejectReady = null;
}

function handleMessage(event: MessageEvent<EngineToParent>): void {
  if (event.origin !== window.location.origin) return;
  if (!engineFrame || event.source !== engineFrame.contentWindow) return;
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  switch (message.type) {
    case 'ready':
      clearReadyTimeout();
      engineReady = true;
      resolveReady?.();
      resetReadyState();
      break;
    case 'status': {
      pending.get(message.id)?.onStatus(message.stage);
      break;
    }
    case 'result': {
      const conversion = pending.get(message.id);
      if (!conversion) return;
      pending.delete(message.id);
      conversion.cleanup();
      conversion.resolve(
        new Blob([message.docx], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      );
      break;
    }
    case 'error': {
      const conversion = pending.get(message.id);
      if (!conversion) {
        if (message.id === 0) destroyHighFidelityEngine(new AppError('High-fidelity engine failed', message.message));
        return;
      }
      pending.delete(message.id);
      conversion.cleanup();
      conversion.reject(new AppError('High-fidelity conversion failed', message.message));
      break;
    }
    case 'fatal': {
      destroyHighFidelityEngine(new AppError('High-fidelity engine failed', message.message));
      break;
    }
  }
}

function waitForReady(signal: AbortSignal): Promise<void> {
  if (engineReady && engineFrame) return Promise.resolve();
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  readyTimeout = window.setTimeout(() => {
    rejectReady?.(new AppError('High-fidelity engine did not start', 'Try again, or use fast mode.'));
    destroyHighFidelityEngine();
  }, 20000);

  const iframe = document.createElement('iframe');
  iframe.src = new URL('engine.html', document.baseURI).href;
  iframe.title = 'PDF ⇄ Word high-fidelity engine';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.addEventListener('error', () => {
    destroyHighFidelityEngine(new AppError('High-fidelity engine could not load', 'Check your connection, or use fast mode.'));
  });

  window.addEventListener('message', handleMessage);
  engineFrame = iframe;
  document.body.append(iframe);

  const onAbort = () => {
    destroyHighFidelityEngine(new UserCancelledError());
  };
  signal.addEventListener('abort', onAbort, { once: true });

  return readyPromise.finally(() => {
    signal.removeEventListener('abort', onAbort);
  });
}

export interface HighFidelityConvertOptions {
  signal: AbortSignal;
  onStatus: (stage: EngineStage) => void;
}

export async function convertPdfWithHighFidelity(
  pdf: ArrayBuffer,
  options: HighFidelityConvertOptions,
): Promise<Blob> {
  if (options.signal.aborted) throw new UserCancelledError();
  await waitForReady(options.signal);
  if (options.signal.aborted) throw new UserCancelledError();

  const frame = engineFrame;
  if (!frame?.contentWindow) {
    throw new AppError('High-fidelity engine is not available', 'Reload the page, or use fast mode.');
  }

  const id = nextId;
  nextId += 1;

  return new Promise<Blob>((resolve, reject) => {
    const cleanup = () => {
      options.signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      pending.delete(id);
      cleanup();
      reject(new UserCancelledError());
      destroyHighFidelityEngine();
    };

    pending.set(id, { resolve, reject, onStatus: options.onStatus, cleanup });
    options.signal.addEventListener('abort', onAbort, { once: true });

    const message: EngineToWorker = {
      type: 'convert',
      id,
      pdf,
      assetBase: assetBase(),
    };
    frame.contentWindow?.postMessage(message, window.location.origin, [pdf]);
  });
}

export function destroyHighFidelityEngine(error?: unknown): void {
  clearReadyTimeout();
  engineReady = false;
  rejectReady?.(error ?? new UserCancelledError());
  resolveReady = null;
  rejectReady = null;
  readyPromise = null;

  for (const conversion of pending.values()) {
    conversion.cleanup();
    conversion.reject(error ?? new UserCancelledError());
  }
  pending.clear();

  window.removeEventListener('message', handleMessage);
  if (engineFrame) {
    engineFrame.remove();
    engineFrame = null;
  }
}
