/**
 * Unified loader: validates magic bytes and decodes either a .dcparamsbak
 * ZIP backup or a Drive Composer PDF print into a ParsedUnit.
 */
import JSZip from 'jszip';
import type { ParsedUnit } from './types';
import { parseDcparamsXml } from './dcparams';
import { parseBackupBin } from './bin';
import { pdfItemsToUnit, type PdfTextItem } from './pdfTable';

export type FileKind = 'zip' | 'pdf' | 'unknown';

export function detectFileKind(bytes: Uint8Array): FileKind {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip';
  // "%PDF-" may be preceded by a few junk bytes in some generators; check the first 1 KB.
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(1024, bytes.length)));
  if (head.startsWith('%PDF-') || head.indexOf('%PDF-') >= 0) return 'pdf';
  return 'unknown';
}

export const INVALID_FILE_MESSAGE =
  'Invalid file. Please select an ABB Drive Composer / Drivetune backup (.dcparamsbak) or a Drive Composer parameter print (.pdf).';

/** Derive a readable unit name from a file name ("DC4-07 ABB parameters backup file 1.dcparamsbak" -> "DC4-07"). */
export function unitNameFromFileName(fileName: string): string {
  const stem = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const cut = stem.split(/(?:[ _-]+ABB\b|[ _-]+parameters?\b|[ _-]+params?\b|[ _]+backup\b|_backup)/i)[0];
  const name = (cut || stem).trim();
  return name || stem || 'Unnamed unit';
}

export interface LoadOptions {
  /** Extract positioned text items from PDF bytes (pdfjs based). */
  extractPdfItems?: (bytes: Uint8Array) => Promise<PdfTextItem[]>;
}

function parseSideXml(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<([A-Za-z][\w.-]*)>([^<]+)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out[m[1]] = m[2].trim();
  return out;
}

export async function loadDcparamsbak(bytes: Uint8Array, fileName: string): Promise<ParsedUnit> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('The ZIP archive could not be opened. The .dcparamsbak file may be damaged.');
  }
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const paramName = names.find((n) => /\.dcparams$/i.test(n));
  if (!paramName) throw new Error('No parameters.dcparams file found inside the backup archive.');
  const xml = await zip.file(paramName)!.async('string');
  const doc = parseDcparamsXml(xml);
  const warnings: string[] = [];

  // Optional side-car XML with drive info (any *.xml entry in the archive).
  const side: Record<string, string> = {};
  for (const n of names.filter((x) => /\.xml$/i.test(x))) {
    Object.assign(side, parseSideXml(await zip.file(n)!.async('string')));
  }

  const binName = names.find((n) => /\.bin$/i.test(n));
  const binMeta = binName ? parseBackupBin(await zip.file(binName)!.async('uint8array'), binName) ?? undefined : undefined;
  if (binName && !binMeta) warnings.push(`Panel backup blob ${binName} has an unknown layout and was skipped.`);

  const props = doc.properties;
  const serial = props['SerialNumber'] || side['SerialNumber'] || side['Serial'] || binMeta?.serialNumber || undefined;
  const fileUnit = unitNameFromFileName(fileName);
  const unitName = props['Name'] || fileUnit;

  const fwName = doc.params['07.04']?.display;
  const fwVer = doc.params['07.05']?.display;
  const model = doc.params['07.03']?.display || props['DriveModel'];
  if (Object.keys(doc.params).length === 0) throw new Error('The backup archive contains no drive parameters.');

  return {
    source: 'dcparamsbak',
    fileName,
    unitName,
    serialNumber: serial,
    driveModel: model,
    firmware: fwName ? `${fwName}${fwVer ? ' ' + fwVer : ''}` : props['SystemSoftwareVersion'] || undefined,
    creationTime: doc.creationTime,
    application: doc.application ? `Drivetune ${doc.application}` : 'Drive Composer',
    params: doc.params,
    binMeta,
    warnings,
  };
}

/** Decode any supported file. Throws an Error with an English message on failure. */
export async function loadUnitFile(bytes: Uint8Array, fileName: string, opts: LoadOptions = {}): Promise<ParsedUnit> {
  const kind = detectFileKind(bytes);
  if (kind === 'zip') return loadDcparamsbak(bytes, fileName);
  if (kind === 'pdf') {
    if (!opts.extractPdfItems) throw new Error('PDF support is not available in this context.');
    const items = await opts.extractPdfItems(bytes);
    return pdfItemsToUnit(items, fileName, unitNameFromFileName(fileName));
  }
  throw new Error(INVALID_FILE_MESSAGE);
}
