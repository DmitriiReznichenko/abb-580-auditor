/**
 * Text item extraction from PDF bytes using a pdfjs-dist module instance.
 * The pdfjs module is injected so the same code runs in the browser
 * (bundled worker, fully offline) and in Node tests (legacy build).
 */
import type { PdfTextItem } from './pdfTable';

// Minimal structural typing of the pdfjs API we use.
interface PdfJsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean; disableFontFace?: boolean }): {
    promise: Promise<PdfDocLike>;
  };
}
interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
  destroy?: () => Promise<void> | void;
}
interface PdfPageLike {
  getViewport(o: { scale: number }): { height: number };
  getTextContent(): Promise<{ items: Array<{ str?: string; transform?: number[] }> }>;
}

export async function extractPdfItems(pdfjs: PdfJsLike, data: Uint8Array): Promise<PdfTextItem[]> {
  // pdfjs may transfer/detach the buffer: always hand it a copy.
  const doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, disableFontFace: true }).promise;
  const items: PdfTextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!it.str || !it.transform) continue;
      items.push({ page: p, x: it.transform[4], y: vp.height - it.transform[5], str: it.str });
    }
  }
  if (doc.destroy) await doc.destroy();
  return items;
}
