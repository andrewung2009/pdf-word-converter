import type { EngineToParent, EngineToWorker, WorkerToEngine } from './protocol';

const parentOrigin = window.location.origin;
let currentId: number | null = null;

function postToParent(message: EngineToParent, transfer: Transferable[] = []): void {
  window.parent.postMessage(message, parentOrigin, transfer);
}

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

worker.onmessage = (event: MessageEvent<WorkerToEngine>) => {
  const message = event.data;
  if (message.type === 'status' && message.id === currentId) {
    postToParent(message);
    return;
  }
  if (message.type === 'result' && message.id === currentId) {
    currentId = null;
    postToParent(message, [message.docx]);
    return;
  }
  if (message.type === 'error' && message.id === currentId) {
    currentId = null;
    postToParent(message);
  }
};

worker.onerror = (event) => {
  postToParent({
    type: 'error',
    id: currentId ?? 0,
    message: event.message || 'The high-fidelity engine failed to start.',
  });
  currentId = null;
};

window.addEventListener('message', (event: MessageEvent<EngineToWorker>) => {
  if (event.origin !== parentOrigin) return;
  if (window.parent !== event.source) return;
  const message = event.data;
  if (message?.type !== 'convert') return;
  if (currentId !== null) {
    postToParent({
      type: 'error',
      id: message.id,
      message: 'The engine is already converting another file.',
    });
    return;
  }
  currentId = message.id;
  worker.postMessage(message, [message.pdf]);
});

window.addEventListener('pagehide', () => {
  worker.terminate();
});

postToParent({ type: 'ready' });
