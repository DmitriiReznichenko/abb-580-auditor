/**
 * Browser platform helpers: offline pdfjs (bundled worker), file reading,
 * downloads, Android share sheet and service worker cache refresh.
 */
import type { PdfTextItem } from '../lib/pdfTable';
import { extractPdfItems } from '../lib/pdfItems';
import { loadUnitFile } from '../lib/loader';
import type { ParsedUnit } from '../lib/types';

let pdfjsPromise: Promise<unknown> | null = null;

/** Load pdfjs lazily with the locally bundled worker (no CDN, works offline). */
async function getPdfjs(): Promise<unknown> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function browserPdfItems(bytes: Uint8Array): Promise<PdfTextItem[]> {
  const pdfjs = await getPdfjs();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return extractPdfItems(pdfjs as any, bytes);
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export async function parseUserFile(file: File): Promise<ParsedUnit> {
  const bytes = await readFileBytes(file);
  return loadUnitFile(bytes, file.name, { extractPdfItems: browserPdfItems });
}

export function downloadBlob(data: BlobPart, fileName: string, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function canShareFiles(): boolean {
  try {
    const f = new File([new Uint8Array([37])], 'test.pdf', { type: 'application/pdf' });
    return typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [f] });
  } catch {
    return false;
  }
}

/** Share via the Android share sheet; falls back to a download. Returns true when shared. */
export async function shareOrDownload(data: ArrayBuffer, fileName: string, title: string): Promise<boolean> {
  const file = new File([data], fileName, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: title });
      return true;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return false;
    }
  }
  downloadBlob(data, fileName, 'application/pdf');
  return false;
}

export function safeFileName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'report';
}

/** Clear all caches and service workers, then reload the newest build. */
export async function hardRefreshApp(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } finally {
    window.location.reload();
  }
}

export const APP_VERSION: string = __APP_VERSION__;
export const BUILD_TIME: string = __BUILD_TIME__;
