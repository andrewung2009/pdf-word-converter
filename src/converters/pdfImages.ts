import type * as PdfjsModule from 'pdfjs-dist';
import { assertNotAborted } from '../lib/errors';

type Pdfjs = typeof PdfjsModule;
type Matrix = [number, number, number, number, number, number];

export interface ExtractedPdfImage {
  data: Uint8Array;
  type: 'jpg' | 'png';
  width: number;
  height: number;
  top: number;
  left: number;
  page: number;
  sourceWidth: number;
  sourceHeight: number;
}

interface Placement {
  ctm: Matrix;
  objId?: string;
  inline?: unknown;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const MAX_IMAGES_PER_PAGE = 30;
const MAX_IMAGE_DIMENSION = 1600;
const MIN_IMAGE_POINTS = 5;

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function canvasFromBitmap(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.drawImage(bitmap, 0, 0);
  return canvas;
}

function canvasFromPixels(image: Record<string, unknown>): HTMLCanvasElement | null {
  const width = Number(image.width);
  const height = Number(image.height);
  const kind = Number(image.kind);
  const raw = image.data;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  let data: Uint8ClampedArray | null = null;
  let hasAlpha = false;

  if (raw instanceof Uint8ClampedArray && raw.length >= width * height * 4) {
    data = new Uint8ClampedArray(raw);
    hasAlpha = true;
  } else if (raw instanceof Uint8Array || raw instanceof Uint8ClampedArray) {
    const source = raw as Uint8Array;
    if (kind === 3 && source.length >= width * height * 4) {
      data = new Uint8ClampedArray(width * height * 4);
      data.set(source.subarray(0, data.length));
      hasAlpha = true;
    } else if (kind === 2 && source.length >= width * height * 3) {
      data = new Uint8ClampedArray(width * height * 4);
      for (let index = 0, dest = 0; index < width * height * 3; index += 3, dest += 4) {
        data[dest] = source[index];
        data[dest + 1] = source[index + 1];
        data[dest + 2] = source[index + 2];
        data[dest + 3] = 255;
      }
    } else if (kind === 1) {
      const rowBytes = (width + 7) >> 3;
      data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const byte = source[y * rowBytes + (x >> 3)] ?? 0;
          const value = (byte >> (7 - (x & 7))) & 1 ? 255 : 0;
          const dest = (y * width + x) * 4;
          data[dest] = value;
          data[dest + 1] = value;
          data[dest + 2] = value;
          data[dest + 3] = 255;
        }
      }
    }
  }

  if (!data) return null;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) return null;
  const imageData = context.createImageData(width, height);
  imageData.data.set(data);
  context.putImageData(imageData, 0, 0);
  if (hasAlpha) canvas.dataset.hasAlpha = 'true';
  return canvas;
}

function imageToCanvas(image: unknown): HTMLCanvasElement | null {
  if (!image || typeof image !== 'object') return null;
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) return canvasFromBitmap(image);
  const record = image as Record<string, unknown>;
  if (record.bitmap && typeof ImageBitmap !== 'undefined' && record.bitmap instanceof ImageBitmap) {
    return canvasFromBitmap(record.bitmap);
  }
  return canvasFromPixels(record);
}

function downscale(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const largest = Math.max(canvas.width, canvas.height);
  if (largest <= MAX_IMAGE_DIMENSION) return canvas;
  const ratio = MAX_IMAGE_DIMENSION / largest;
  const scaled = createCanvas(canvas.width * ratio, canvas.height * ratio);
  const context = scaled.getContext('2d');
  if (!context) return canvas;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  canvas.width = 1;
  canvas.height = 1;
  return scaled;
}

function encodeCanvas(canvas: HTMLCanvasElement, preserveAlpha: boolean): Promise<{ blob: Blob; type: 'jpg' | 'png' }> {
  return new Promise((resolve, reject) => {
    const type = preserveAlpha ? 'image/png' : 'image/jpeg';
    let target = canvas;
    if (!preserveAlpha) {
      const flattened = createCanvas(canvas.width, canvas.height);
      const context = flattened.getContext('2d', { alpha: false });
      if (context) {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, flattened.width, flattened.height);
        context.drawImage(canvas, 0, 0);
        target = flattened;
      }
    }
    target.toBlob(
      (blob) => {
        if (blob) resolve({ blob, type: preserveAlpha ? 'png' : 'jpg' });
        else reject(new Error('Could not encode image'));
      },
      type,
      type === 'image/jpeg' ? 0.9 : undefined,
    );
  });
}

function getStoredObject(store: any, id: string): Promise<unknown | null> {
  return new Promise((resolve) => {
    try {
      if (store?.has?.(id)) {
        resolve(store.get(id));
        return;
      }
    } catch {
      /* fall through to callback */
    }

    let settled = false;
    const finish = (value: unknown | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(null), 700);

    try {
      store.get(id, (value: unknown) => finish(value), () => finish(null));
    } catch {
      finish(null);
    }
  });
}

async function resolveImageObject(page: any, id: string): Promise<unknown | null> {
  const local = await getStoredObject(page.objs, id);
  if (local) return local;
  return getStoredObject(page.commonObjs, id);
}

function collectPlacements(pdfjs: Pdfjs, operatorList: any): Placement[] {
  const placements: Placement[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [...IDENTITY];

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operation = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] ?? [];

    if (operation === pdfjs.OPS.save) {
      stack.push([...ctm] as Matrix);
    } else if (operation === pdfjs.OPS.restore) {
      ctm = (stack.pop() ?? [...IDENTITY]) as Matrix;
    } else if (operation === pdfjs.OPS.transform) {
      ctm = multiply(ctm, args as Matrix);
    } else if (operation === pdfjs.OPS.paintImageXObject) {
      placements.push({ ctm: [...ctm] as Matrix, objId: String(args[0]) });
    } else if (operation === pdfjs.OPS.paintInlineImageXObject) {
      placements.push({ ctm: [...ctm] as Matrix, inline: args[0] });
    } else if (operation === pdfjs.OPS.paintImageXObjectRepeat) {
      const [objId, scaleX, scaleY, positions] = args as [string, number, number, number[]];
      for (let position = 0; position + 1 < (positions?.length ?? 0); position += 2) {
        placements.push({
          ctm: multiply(ctm, [scaleX, 0, 0, scaleY, positions[position], positions[position + 1]]),
          objId: String(objId),
        });
      }
    } else if (operation === pdfjs.OPS.paintInlineImageXObjectGroup) {
      const [, map] = args as [unknown, Array<{ transform: Matrix }>];
      for (const entry of map ?? []) {
        if (entry?.transform) placements.push({ ctm: multiply(ctm, entry.transform), inline: args[0] });
      }
    }

    if (placements.length >= MAX_IMAGES_PER_PAGE * 4) break;
  }

  return placements;
}

export async function extractPageImages(
  pdfjs: Pdfjs,
  page: any,
  viewport: any,
  pageNumber: number,
  signal: AbortSignal,
): Promise<ExtractedPdfImage[]> {
  assertNotAborted(signal);
  let operatorList: any;
  try {
    operatorList = await page.getOperatorList();
  } catch {
    return [];
  }
  assertNotAborted(signal);

  const placements = collectPlacements(pdfjs, operatorList);
  if (!placements.length) return [];

  const viewportTransform = viewport.transform as Matrix;
  const contentWidthPt = Math.max(72, viewport.width - 144);
  const contentHeightPt = Math.max(72, viewport.height - 144);
  const images: ExtractedPdfImage[] = [];
  const seen = new Set<string>();

  for (const placement of placements) {
    assertNotAborted(signal);
    if (images.length >= MAX_IMAGES_PER_PAGE) break;

    let image: unknown | null = placement.inline ?? null;
    if (!image && placement.objId) {
      image = await resolveImageObject(page, placement.objId);
    }
    if (!image) continue;

    const matrix = multiply(viewportTransform, placement.ctm);
    const corners = [
      apply(matrix, 0, 0),
      apply(matrix, 1, 0),
      apply(matrix, 0, 1),
      apply(matrix, 1, 1),
    ];
    const minX = Math.min(...corners.map((point) => point.x));
    const maxX = Math.max(...corners.map((point) => point.x));
    const minY = Math.min(...corners.map((point) => point.y));
    const maxY = Math.max(...corners.map((point) => point.y));

    const left = Math.max(0, minX);
    const right = Math.min(viewport.width, maxX);
    const top = Math.max(0, minY);
    const bottom = Math.min(viewport.height, maxY);
    const widthPt = right - left;
    const heightPt = bottom - top;
    if (widthPt < MIN_IMAGE_POINTS || heightPt < MIN_IMAGE_POINTS) continue;

    const dedupeKey = `${placement.objId ?? 'inline'}:${Math.round(left)}:${Math.round(top)}:${Math.round(widthPt)}:${Math.round(heightPt)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const source = imageToCanvas(image);
    if (!source) continue;

    const sourceWidth = source.width;
    const sourceHeight = source.height;
    const preserveAlpha = source.dataset.hasAlpha === 'true';
    const scaled = downscale(source);
    let encoded: { blob: Blob; type: 'jpg' | 'png' };
    try {
      encoded = await encodeCanvas(scaled, preserveAlpha);
    } catch {
      scaled.width = 1;
      scaled.height = 1;
      continue;
    }
    scaled.width = 1;
    scaled.height = 1;
    assertNotAborted(signal);

    const fit = Math.min(1, contentWidthPt / widthPt, contentHeightPt / heightPt);
    const displayWidthPt = widthPt * fit;
    const displayHeightPt = heightPt * fit;

    images.push({
      data: new Uint8Array(await encoded.blob.arrayBuffer()),
      type: encoded.type,
      width: Math.max(1, Math.round(displayWidthPt * (96 / 72))),
      height: Math.max(1, Math.round(displayHeightPt * (96 / 72))),
      top,
      left,
      page: pageNumber,
      sourceWidth,
      sourceHeight,
    });
  }

  return images;
}
