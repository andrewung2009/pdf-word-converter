/// <reference lib="webworker" />

import { Pdf2Docx } from 'pdf2docx-wasm';
import type { EngineToWorker, WorkerToEngine } from './protocol';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let converter: Pdf2Docx | null = null;

function post(message: WorkerToEngine, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

workerScope.onmessage = (event: MessageEvent<EngineToWorker>) => {
  const message = event.data;
  if (message?.type !== 'convert') return;
  const { id, pdf, assetBase } = message;

  void (async () => {
    try {
      const firstUse = converter === null;
      if (!converter) converter = new Pdf2Docx(assetBase);
      post({ type: 'status', id, stage: firstUse ? 'loading' : 'converting' });
      const source = new Blob([pdf], { type: 'application/pdf' });
      const result = await converter.convert(source);
      post({ type: 'status', id, stage: 'packaging' });
      const buffer = await result.arrayBuffer();
      post({ type: 'result', id, docx: buffer }, [buffer]);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'The high-fidelity engine could not read this PDF.';
      post({ type: 'error', id, message: messageText });
    }
  })();
};
