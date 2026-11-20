/// <reference lib="webworker" />

import { Pdf2Docx } from 'pdf2docx-wasm';
import type { EngineToWorker, WorkerToEngine } from './protocol';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let converter: Pdf2Docx | null = null;
let patched = false;

const WHITE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

const PYTHON_PATCH = `
from pdf2docx.image.ImagesExtractor import ImagesExtractor
from pdf2docx.common.share import BlockType
import base64
import pymupdf as fitz

_white_png = base64.b64decode(${JSON.stringify(WHITE_PNG_BASE64)})

def _normalize_pixmap(image):
    if image is None:
        return None
    try:
        base = fitz.Pixmap(image, 0) if getattr(image, 'alpha', False) else image
        return fitz.Pixmap(fitz.csRGB, base)
    except Exception:
        try:
            return fitz.Pixmap(fitz.csRGB, image)
        except Exception:
            return None

def _fallback_image_dict(image, bbox):
    return {
        'type': BlockType.IMAGE.value,
        'bbox': tuple(bbox),
        'width': getattr(image, 'width', 1),
        'height': getattr(image, 'height', 1),
        'image': _white_png,
    }

_original_to_raw_dict = ImagesExtractor._to_raw_dict

def _safe_to_raw_dict(image, bbox):
    try:
        return _original_to_raw_dict(image, bbox)
    except Exception:
        converted = _normalize_pixmap(image)
        if converted is not None:
            try:
                return _original_to_raw_dict(converted, bbox)
            except Exception:
                pass
        return _fallback_image_dict(image, bbox)

ImagesExtractor._to_raw_dict = staticmethod(_safe_to_raw_dict)

_original_rotate_image = ImagesExtractor._rotate_image

def _safe_rotate_image(pixmap, rotation):
    try:
        return _original_rotate_image(pixmap, rotation)
    except Exception:
        converted = _normalize_pixmap(pixmap)
        if converted is not None:
            try:
                return _original_rotate_image(converted, rotation)
            except Exception:
                pass
        raise

ImagesExtractor._rotate_image = staticmethod(_safe_rotate_image)

_original_pixmap_to_cv = ImagesExtractor._pixmap_to_cv_image

def _safe_pixmap_to_cv(pixmap):
    try:
        return _original_pixmap_to_cv(pixmap)
    except Exception:
        converted = _normalize_pixmap(pixmap)
        if converted is not None:
            return _original_pixmap_to_cv(converted)
        raise

ImagesExtractor._pixmap_to_cv_image = staticmethod(_safe_pixmap_to_cv)
`;

function post(message: WorkerToEngine, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

interface LoadedPyodide {
  runPython(code: string): unknown;
}

interface PatchableConverter {
  load(): Promise<LoadedPyodide>;
}

function friendlyError(error: unknown): string {
  const text =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/memory|out of memory|MemoryError/i.test(text)) {
    return 'The PDF is too large for the high-fidelity engine. Use fast mode or exact layout instead.';
  }
  return 'The high-fidelity engine could not process this PDF. Use fast mode or exact layout instead.';
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

      if (!patched) {
        const internal = converter as unknown as PatchableConverter;
        const pyodide = await internal.load();
        pyodide.runPython(PYTHON_PATCH);
        patched = true;
      }

      const source = new Blob([pdf], { type: 'application/pdf' });
      const result = await converter.convert(source, message.pageIndexes);
      post({ type: 'status', id, stage: 'packaging' });
      const buffer = await result.arrayBuffer();
      post({ type: 'result', id, docx: buffer }, [buffer]);
    } catch (error) {
      console.error(error);
      post({ type: 'error', id, message: friendlyError(error) });
    }
  })();
};
