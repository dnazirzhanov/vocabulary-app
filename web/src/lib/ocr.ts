import { tidyPhotoText } from './photos.ts';

/**
 * Reading text from photos in the browser (ADR 0029), with Tesseract: free, and the photos never
 * leave the device. The engine and its English model (about 5 MB) load on first use and are
 * cached by the browser. Tests swap in `window.__ocrForTests`, so they need neither.
 */

declare global {
  interface Window {
    /** Tests only: the text "read" from a photo, by its file name. */
    __ocrForTests?: (name: string) => string;
  }
}

/** Long sides beyond this are scaled down first: faster, and a phone photo fits in memory. */
const MAX_SIDE = 2000;
/** Loading the engine (first time) and reading a few pages takes seconds; this is a failure. */
const GIVE_UP_MS = 120_000;

async function scaled(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/**
 * The text of each photo, in order. `onProgress(done)` reports how far reading has got, from 0
 * to `files.length` (fractions while a photo is being read).
 */
export async function readPhotos(files: File[], onProgress: (done: number) => void): Promise<string[]> {
  const fake = window.__ocrForTests;
  if (fake) {
    return files.map((file, index) => (onProgress(index + 1), tidyPhotoText(fake(file.name))));
  }
  const { createWorker } = await import('tesseract.js');
  let current = 0;
  // A failed download inside the engine never settles its promise: fail on its error, or in time.
  let fail: (error: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => (fail = reject));
  failed.catch(() => {}); // a late error, once reading is done, is nobody's concern
  const timer = setTimeout(() => fail(new Error('Reading photos took too long')), GIVE_UP_MS);
  const worker = await Promise.race([
    createWorker('eng', 1, {
      logger: (message) => {
        if (message.status === 'recognizing text') onProgress(current + message.progress);
      },
      errorHandler: (error: unknown) => fail(error),
    }),
    failed,
  ]);
  try {
    const texts: string[] = [];
    for (const [index, file] of files.entries()) {
      current = index;
      const { data } = await Promise.race([worker.recognize(await scaled(file)), failed]);
      texts.push(tidyPhotoText(data.text));
      onProgress(index + 1);
    }
    return texts;
  } finally {
    clearTimeout(timer);
    void worker.terminate();
  }
}
