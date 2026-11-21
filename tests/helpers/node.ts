/**
 * Node-side helpers for tests: pdfjs legacy build for PDF text extraction and
 * discovery of optional local real-data fixtures (never committed).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfItems } from '../../src/lib/pdfItems';
import { loadUnitFile } from '../../src/lib/loader';
import type { ParsedUnit } from '../../src/lib/types';

export async function extractNodePdfItems(bytes: Uint8Array) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return extractPdfItems(pdfjs as any, bytes);
}

export async function loadFile(path: string, name?: string): Promise<ParsedUnit> {
  const bytes = new Uint8Array(readFileSync(path));
  return loadUnitFile(bytes, name ?? path.split('/').pop()!, { extractPdfItems: extractNodePdfItems });
}

export async function loadBytes(bytes: Uint8Array, name: string): Promise<ParsedUnit> {
  return loadUnitFile(bytes, name, { extractPdfItems: extractNodePdfItems });
}

/** Directory with optional real backups for local-only validation (gitignored). */
export const REAL_DIR = process.env.ABB_REAL_DATA_DIR ?? join(process.cwd(), '.local-fixtures');

export function findReal(pattern: RegExp): string | undefined {
  if (!existsSync(REAL_DIR)) return undefined;
  const f = readdirSync(REAL_DIR).find((n) => pattern.test(n));
  return f ? join(REAL_DIR, f) : undefined;
}
