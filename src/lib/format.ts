/**
 * Parameter id helpers and value formatting rules that reproduce the
 * Drive Composer Pro display format (verified against a real parameter print).
 */
import type { AbbParamType } from './types';

/** Canonical id: group and index zero padded to two digits ("7.3" -> "07.03"). */
export function pid(group: number | string, index: number | string): string {
  const g = String(Number(group)).padStart(2, '0');
  const i = String(Number(index)).padStart(2, '0');
  return `${g}.${i}`;
}

/** Parse any user/file id spelling ("7.3", "07.03", "30,17") into canonical form. */
export function normalizeId(input: string): string | null {
  const m = String(input).trim().match(/^(\d{1,3})[.,](\d{1,3})$/);
  if (!m) return null;
  return pid(m[1], m[2]);
}

export function splitId(id: string): [number, number] {
  const [g, i] = id.split('.');
  return [Number(g), Number(i)];
}

/** Numeric sort comparator for canonical ids. */
export function compareIds(a: string, b: string): number {
  const [ag, ai] = splitId(a);
  const [bg, bi] = splitId(b);
  return ag - bg || ai - bi;
}

/** Expand an inclusive id range "10.99"-"10.103" to a predicate. */
export function inRange(id: string, from: string, to: string): boolean {
  const [g, i] = splitId(id);
  const [fg, fi] = splitId(from);
  const [tg, ti] = splitId(to);
  if (g < fg || g > tg) return false;
  if (g === fg && i < fi) return false;
  if (g === tg && i > ti) return false;
  return true;
}

/**
 * Parse a user-entered list of parameter ids. Accepted tokens (separated by
 * commas, semicolons, spaces or new lines): "28.52", "28.51-28.57",
 * "28.51..28.57", "40.*" (whole group). Returns canonical tokens
 * ("28.52", "28.51-28.57", "40.*") and the tokens that could not be parsed.
 */
export function parseIdList(text: string): { tokens: string[]; invalid: string[] } {
  const tokens: string[] = [];
  const invalid: string[] = [];
  const raw = String(text)
    .replace(/\s*(-|\.\.)\s*/g, '$1')
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  for (const t of raw) {
    const grp = t.match(/^(\d{1,3})\.\*$/);
    if (grp) {
      tokens.push(`${String(Number(grp[1])).padStart(2, '0')}.*`);
      continue;
    }
    const rng = t.match(/^(\d{1,3}[.,]\d{1,3})(?:-|\.\.|to)(\d{1,3}[.,]\d{1,3})$/i);
    if (rng) {
      const a = normalizeId(rng[1]);
      const b = normalizeId(rng[2]);
      if (a && b) {
        const [lo, hi] = compareIds(a, b) <= 0 ? [a, b] : [b, a];
        tokens.push(`${lo}-${hi}`);
        continue;
      }
    }
    const one = normalizeId(t);
    if (one) tokens.push(one);
    else invalid.push(t);
  }
  return { tokens: Array.from(new Set(tokens)), invalid };
}

/** True when the canonical id matches any token produced by parseIdList. */
export function matchesIdList(id: string, tokens: string[]): boolean {
  for (const t of tokens) {
    if (t.endsWith('.*')) {
      if (splitId(id)[0] === Number(t.slice(0, -2))) return true;
    } else if (t.includes('-')) {
      const [a, b] = t.split('-');
      if (inRange(id, a, b)) return true;
    } else if (t === id) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Raw value -> display text
// ---------------------------------------------------------------------------

function group4(bits: string): string {
  const out: string[] = [];
  for (let i = 0; i < bits.length; i += 4) out.push(bits.slice(i, i + 4));
  return out.join(' ');
}

export function formatHex(raw: number): string {
  const v = raw >>> 0;
  const s = v <= 0xffff ? v.toString(16).padStart(4, '0') : v.toString(16).padStart(8, '0');
  return '0x' + group4(s);
}

export function formatBinary(raw: number): string {
  const s = (raw >>> 0).toString(2);
  const padded = s.padStart(Math.ceil(s.length / 4) * 4, '0');
  return '0b' + group4(padded);
}

export function formatTimeOfDay(raw: number): string {
  const h = Math.floor(raw / 3600);
  const m = Math.floor(raw / 60) % 60;
  const s = raw % 60;
  return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
}

/** Duration is stored in minutes and shown as "DD HH:MM". */
export function formatDuration(raw: number): string {
  const d = Math.floor(raw / 1440);
  const h = Math.floor(raw / 60) % 24;
  const m = raw % 60;
  return `${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Date is a day counter; Drive Composer shows day 0 as 1/1/1980. */
export function formatDate(raw: number): string {
  if (!raw) return '1/1/1980';
  const d = new Date(Date.UTC(1979, 11, 31) + raw * 86400000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

/** ShortDate packs day (high byte) and month (low byte): 257 -> "1.1". */
export function formatShortDate(raw: number): string {
  return `${(raw >> 8) & 0xff}.${raw & 0xff}`;
}

export function formatHex8Mask(raw: number): string {
  const v = raw >>> 0;
  return [24, 16, 8, 0].map((s) => ((v >>> s) & 0xff).toString(16).toUpperCase()).join('.');
}

export function formatVersion(raw: number): string {
  const v = raw >>> 0;
  return `${v >>> 24}.${String((v >>> 16) & 0xff).padStart(2, '0')}.${(v >>> 8) & 0xff}.${v & 0xff}`;
}

/** Five 6-bit characters (offset 47) packed below the top bit, e.g. "AHVK4". */
export function formatAscii5(raw: number): string {
  const v = raw >>> 0;
  let s = '';
  for (let i = 0; i < 5; i++) s += String.fromCharCode(((v >>> (25 - 6 * i)) & 0x3f) + 47);
  return s.replace(/^_+/, '');
}

export function formatDecimal(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return String(value);
  return value.toFixed(Math.max(0, Math.min(decimals, 10)));
}

/**
 * Format a raw value of a given type the way Drive Composer displays it.
 * `value` is the engineering value (scaled), `raw` the integer code.
 */
export function formatByType(
  type: AbbParamType | undefined,
  value: number,
  raw: number,
  decimals: number,
  enumMap?: Record<string, string>,
): string {
  switch (type) {
    case 'TextList':
    case 'BitPointer':
    case 'ParameterPointer':
    case 'ParameterIndexAndDataType': {
      const label = enumMap?.[String(raw)];
      if (label !== undefined) return label;
      if (type === 'ParameterIndexAndDataType' && raw === 0) return 'None';
      return `Other (${raw})`;
    }
    case 'Hex':
      return formatHex(raw);
    case 'Binary':
      return formatBinary(raw);
    case 'TimeOfDay':
      return formatTimeOfDay(raw);
    case 'Duration':
      return formatDuration(raw);
    case 'Date':
      return formatDate(raw);
    case 'ShortDate':
      return formatShortDate(raw);
    case 'Hex8Mask':
      return formatHex8Mask(raw);
    case 'Version':
      return formatVersion(raw);
    case 'StringAscii5':
      return formatAscii5(raw);
    case 'PasscodeMask':
      return '';
    default: {
      if (enumMap && Number.isInteger(value) && enumMap[String(value)] !== undefined) {
        return enumMap[String(value)];
      }
      return formatDecimal(value, decimals);
    }
  }
}

// ---------------------------------------------------------------------------
// Display text -> raw value (used for Drive Composer PDF prints)
// ---------------------------------------------------------------------------

export function parseNumberText(s: string): number | null {
  const t = s.trim();
  if (/^0x[0-9a-f ]+$/i.test(t)) return parseInt(t.slice(2).replace(/\s+/g, ''), 16);
  if (/^0b[01 ]+$/i.test(t)) return parseInt(t.slice(2).replace(/\s+/g, ''), 2);
  if (/^[-+]?\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

export function decimalsOf(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.trim().match(/^[-+]?\d+(?:\.(\d+))?$/);
  if (!m) return undefined;
  return (m[1] ?? '').length;
}

/** Infer a data type from Drive Composer display text. */
export function inferTypeFromText(s: string): AbbParamType {
  const t = s.trim();
  if (/^0x[0-9a-f ]+$/i.test(t)) return 'Hex';
  if (/^0b[01 ]+$/i.test(t)) return 'Binary';
  if (/^[-+]?\d+(\.\d+)?$/.test(t)) return 'Decimal';
  if (/^\d{2}:\d{2}:\d{2}$/.test(t)) return 'TimeOfDay';
  if (/^\d{2} \d{2}:\d{2}$/.test(t)) return 'Duration';
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) return 'Date';
  if (/^[0-9A-F]{1,2}\.[0-9A-F]{1,2}\.[0-9A-F]{1,2}\.[0-9A-F]{1,2}$/.test(t)) return 'Hex8Mask';
  return 'TextList';
}

/** Normalize text for loose comparisons ("U  W V " == "u w v"). */
export function normText(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Resolve an enum label (possibly truncated by the PDF column width) to its code.
 */
export function labelToCode(label: string, enumMap?: Record<string, string>): number | null {
  if (!enumMap) return null;
  const n = normText(label);
  if (!n) return null;
  let prefixHit: number | null = null;
  let prefixCount = 0;
  for (const [code, lbl] of Object.entries(enumMap)) {
    const l = normText(lbl);
    if (l === n) return Number(code);
    if (n.length >= 8 && l.startsWith(n)) {
      prefixHit = Number(code);
      prefixCount++;
    }
  }
  return prefixCount === 1 ? prefixHit : null;
}
