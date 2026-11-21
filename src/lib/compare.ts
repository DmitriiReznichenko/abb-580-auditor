/**
 * Format-independent value comparison between two decoded parameters
 * (backup vs backup, backup vs PDF, PDF vs PDF).
 *
 *  - Numbers are normalized ("30" == "30.000", "216" == "216.0") and compared
 *    at the precision of the less precise side.
 *  - Enum values match by numeric code or by label (truncated PDF labels are
 *    resolved through the enum list of either side).
 *  - Hex / binary values are compared as integers.
 */
import type { ParamRecord } from './types';
import { labelToCode, normText, parseNumberText } from './format';

const ENUM_TYPES = new Set(['TextList', 'BitPointer', 'ParameterPointer', 'ParameterIndexAndDataType']);

function hasEnum(p: ParamRecord): boolean {
  return !!p.enumMap && Object.keys(p.enumMap).length > 0;
}

/** Resolve the enum code of a record using its own or the other side's list. */
function enumCode(p: ParamRecord, other: ParamRecord): number | null {
  const hasRaw = p.raw !== null && p.raw !== undefined && Number.isFinite(p.raw);
  // Backups store the selected code in raw; for PDFs raw was resolved from the label.
  if (hasRaw && ENUM_TYPES.has(String(p.type))) return p.raw as number;
  if (hasRaw && p.enumMap?.[String(p.raw)] !== undefined) return p.raw as number;
  return labelToCode(p.display, p.enumMap) ?? labelToCode(p.display, other.enumMap);
}

function decimalTolerance(a: ParamRecord, b: ParamRecord): number {
  const da = a.decimals ?? 6;
  const db = b.decimals ?? 6;
  const d = Math.min(da, db);
  return 0.5 * Math.pow(10, -d) + 1e-9;
}

function numericValue(p: ParamRecord): number | null {
  const t = parseNumberText(p.display);
  if (t !== null) return p.raw !== null && p.raw !== undefined && Number.isFinite(p.raw) ? p.raw : t;
  return null;
}

export function valuesEqual(a: ParamRecord, b: ParamRecord): boolean {
  if (normText(a.display) === normText(b.display)) return true;

  const enumLike = ENUM_TYPES.has(String(a.type)) || ENUM_TYPES.has(String(b.type)) || hasEnum(a) || hasEnum(b);
  if (enumLike) {
    const ca = enumCode(a, b);
    const cb = enumCode(b, a);
    if (ca !== null && cb !== null) return ca === cb;
  }

  const na = numericValue(a);
  const nb = numericValue(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) <= decimalTolerance(a, b);

  // Label truncated by the PDF column width ("Start command ignor").
  const ta = normText(a.display);
  const tb = normText(b.display);
  if (ta.length >= 12 && tb.length >= 12 && (ta.startsWith(tb) || tb.startsWith(ta))) return true;
  return false;
}

/** Normalized display for numeric comparisons in reports ("216.0" -> "216"). */
export function displayValue(p: ParamRecord | undefined): string {
  if (!p) return '(not present)';
  return p.display === '' ? '(empty)' : p.display;
}
