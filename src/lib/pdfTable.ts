/**
 * Parser for Drive Composer Pro "Drive parameters" PDF prints.
 *
 * The print is a 7-column table (Index | Name | Value | Unit | Min | Max |
 * Default). Column x positions change from page to page (the table is auto
 * sized per page), so columns are located from each page's header row.
 * Group rows look like "99." + group name. Long enum labels may be truncated
 * by the column width (mostly in the Default column) and are repaired with
 * the dictionary enum lists.
 */
import type { ParamRecord, ParsedUnit } from './types';
import { dictParam, groupName as dictGroupName } from './dictionary';
import { decimalsOf, inferTypeFromText, labelToCode, parseNumberText, pid } from './format';

export interface PdfTextItem {
  page: number;
  /** Left x in PDF points. */
  x: number;
  /** Baseline / top y in points, increasing DOWN the page. */
  y: number;
  str: string;
}

export interface PdfRow {
  group: number;
  groupName: string;
  index: number;
  name: string;
  value: string;
  unit: string;
  min: string;
  max: string;
  default: string;
  page: number;
}

const HEADER = ['Index', 'Name', 'Value', 'Unit', 'Min', 'Max', 'Default'];
const COLS = ['index', 'name', 'value', 'unit', 'min', 'max', 'default'] as const;
type Col = (typeof COLS)[number];

export interface PdfTableResult {
  rows: PdfRow[];
  driveModel?: string;
  serialNumber?: string;
  printDate?: string;
  isDriveComposerPrint: boolean;
}

export function parseDriveComposerItems(items: PdfTextItem[]): PdfTableResult {
  const byPage = new Map<number, PdfTextItem[]>();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const arr = byPage.get(it.page) ?? [];
    arr.push({ ...it, str: it.str.trim() });
    byPage.set(it.page, arr);
  }
  const rows: PdfRow[] = [];
  let group: number | null = null;
  let gName = '';
  let driveModel: string | undefined;
  let serialNumber: string | undefined;
  let printDate: string | undefined;
  let headerSeen = false;

  for (const page of Array.from(byPage.keys()).sort((a, b) => a - b)) {
    const pageItems = byPage.get(page)!.sort((a, b) => a.y - b.y || a.x - b.x);
    // Group items into visual lines.
    const lines: Array<{ y: number; items: PdfTextItem[] }> = [];
    for (const it of pageItems) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) < 3) last.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    }
    for (const l of lines) l.items.sort((a, b) => a.x - b.x);

    const header = lines.find((l) => l.items.map((i) => i.str).join('|') === HEADER.join('|'));
    if (!header) continue;
    headerSeen = true;
    const cols = header.items.map((it, i) => ({ col: COLS[i], x: it.x }));
    const colOf = (x: number): Col | null => {
      let found: Col | null = null;
      for (const c of cols) if (x >= c.x - 1.5) found = c.col;
      return found;
    };

    for (const l of lines) {
      if (l.y <= header.y) {
        for (const it of l.items) {
          if (/^AC[HQS]580-/.test(it.str)) driveModel = it.str;
          if (!printDate && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(it.str)) printDate = it.str;
        }
        if (page === 1) {
          const t = l.items.map((i) => i.str);
          const si = t.indexOf('Serial');
          if (si >= 0 && t[si + 1] && /\d{6,}/.test(t[si + 1])) serialNumber = t[si + 1];
        }
        continue;
      }
      if (l.items[0].str.startsWith('Drive Composer')) continue;
      const row: Partial<Record<Col, string>> = {};
      for (const it of l.items) {
        const c = colOf(it.x);
        if (!c) continue;
        row[c] = row[c] ? `${row[c]} ${it.str}` : it.str;
      }
      const idx = row.index ?? '';
      const gm = idx.match(/^(\d+)\.$/);
      if (gm && Object.keys(row).every((k) => k === 'index' || k === 'name')) {
        group = Number(gm[1]);
        gName = row.name ?? '';
        continue;
      }
      if (!/^\d+$/.test(idx) || group === null) continue;
      rows.push({
        group,
        groupName: gName,
        index: Number(idx),
        name: row.name ?? '',
        value: row.value ?? '',
        unit: row.unit ?? '',
        min: row.min ?? '',
        max: row.max ?? '',
        default: row.default ?? '',
        page,
      });
    }
  }
  return { rows, driveModel, serialNumber, printDate, isDriveComposerPrint: headerSeen };
}


/** Convert parsed PDF rows into ParamRecords using dictionary metadata. */
export function pdfRowsToParams(rows: PdfRow[]): Record<string, ParamRecord> {
  const out: Record<string, ParamRecord> = {};
  for (const r of rows) {
    const id = pid(r.group, r.index);
    const dict = dictParam(id);
    const value = r.value;
    const inferred = inferTypeFromText(value);
    let type = dict?.type ?? inferred;
    // A Decimal parameter printed with a label is a fieldbus option list.
    if (type === 'Decimal' && inferred !== 'Decimal' && !dict?.enumMap) type = inferred;
    const enumMap = dict?.enumMap;
    const decimals = decimalsOf(value) ?? decimalsOf(r.default) ?? dict?.decimals ?? 0;

    let raw: number | null = null;
    const numeric = parseNumberText(value);
    if (numeric !== null && (inferred === 'Decimal' || inferred === 'Hex' || inferred === 'Binary')) {
      raw = numeric;
    } else if (enumMap) {
      raw = labelToCode(value, enumMap);
    }

    let def = r.default;
    let defaultRaw: number | null = null;
    const dNum = parseNumberText(def);
    if (dNum !== null) defaultRaw = dNum;
    else if (enumMap && def) {
      defaultRaw = labelToCode(def, enumMap);
      if (defaultRaw !== null && enumMap[String(defaultRaw)]) def = enumMap[String(defaultRaw)];
    }

    out[id] = {
      id,
      group: r.group,
      index: r.index,
      name: r.name || dict?.name || '',
      groupName: r.groupName || dictGroupName(r.group),
      type,
      display: value,
      raw,
      unit: r.unit === 'NoUnit' ? '' : r.unit,
      min: r.min || undefined,
      max: r.max || undefined,
      defaultDisplay: def || undefined,
      defaultRaw,
      decimals,
      enumMap,
      signal: dict?.signal,
    };
  }
  return out;
}

export function pdfItemsToUnit(items: PdfTextItem[], fileName: string, unitName: string): ParsedUnit {
  const table = parseDriveComposerItems(items);
  if (!table.isDriveComposerPrint || table.rows.length === 0) {
    throw new Error(
      'This PDF is not a Drive Composer parameter print (no "Index | Name | Value | Unit | Min | Max | Default" table found).',
    );
  }
  const params = pdfRowsToParams(table.rows);
  const fw = params['07.04']?.display;
  const fwv = params['07.05']?.display;
  return {
    source: 'pdf',
    fileName,
    unitName,
    serialNumber: table.serialNumber,
    driveModel: table.driveModel ?? params['07.03']?.display,
    firmware: fw ? `${fw}${fwv ? ' ' + fwv : ''}` : undefined,
    creationTime: table.printDate,
    params,
    warnings: [],
  };
}
