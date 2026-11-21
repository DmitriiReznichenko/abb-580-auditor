/**
 * Parameter dictionary: bundled base dictionary (schema + factory defaults,
 * no site values) plus a runtime overlay merged from user-uploaded Drive
 * Composer PDFs / backups (persisted in IndexedDB by the UI layer).
 */
import baseDictJson from '../data/abb580_base_dict.json';
import eventsJson from '../data/abb580_events_dict.json';
import type { ParsedUnit } from './types';
import { compareIds } from './format';

export interface DictParam {
  name: string;
  unit?: string;
  min?: string;
  max?: string;
  default?: string;
  decimals?: number;
  type?: string;
  signal?: boolean;
  bitNames?: string[];
  enumMap?: Record<string, string>;
  enumSource?: string;
}

export interface DictionaryData {
  meta: Record<string, unknown>;
  groups: Record<string, string>;
  driveRatings: Record<string, string>;
  params: Record<string, DictParam>;
}

export interface EventInfo {
  code: string;
  kind: 'fault' | 'warning' | 'pure_event' | string;
  name: string;
  description?: string;
}

const base = baseDictJson as unknown as DictionaryData;
const events = (eventsJson as unknown as { events: Record<string, Omit<EventInfo, 'code'>> }).events;

let overlay: DictionaryData = { meta: {}, groups: {}, driveRatings: {}, params: {} };

export function getBaseDictionary(): DictionaryData {
  return base;
}

export function setDictionaryOverlay(data: DictionaryData | null | undefined): void {
  overlay = data ?? { meta: {}, groups: {}, driveRatings: {}, params: {} };
}

export function getDictionaryOverlay(): DictionaryData {
  return overlay;
}

export function dictParam(id: string): DictParam | undefined {
  const b = base.params[id];
  const o = overlay.params[id];
  if (!o) return b;
  if (!b) return o;
  // Base data wins for units/defaults; overlay may add enum labels or names.
  return {
    ...o,
    ...b,
    enumMap: { ...(o.enumMap ?? {}), ...(b.enumMap ?? {}) },
  };
}

export function groupName(group: number): string | undefined {
  const k = String(group).padStart(2, '0');
  return base.groups[k] ?? overlay.groups[k];
}

export function allDictIds(): string[] {
  return Array.from(new Set([...Object.keys(base.params), ...Object.keys(overlay.params)])).sort(compareIds);
}

export function driveRatingLabel(raw: number | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const k = String(raw);
  return base.driveRatings[k] ?? overlay.driveRatings[k] ?? base.params['07.03']?.enumMap?.[k];
}

/** Normalize an event code (number or "0xA2B1" / "a2b1") to "0xa2b1". */
export function eventKey(code: number | string): string {
  const n = typeof code === 'number' ? code : parseInt(String(code).replace(/^0x/i, ''), 16);
  return '0x' + (n >>> 0).toString(16).padStart(4, '0');
}

export function lookupEvent(code: number | string | null | undefined): EventInfo | undefined {
  if (code === null || code === undefined) return undefined;
  const key = eventKey(code);
  if (key === '0x0000') return undefined;
  const e = events[key];
  return e ? { code: key, ...e } : undefined;
}

export function eventCount(): number {
  return Object.keys(events).length;
}

/**
 * Merge schema metadata from a decoded unit into a dictionary overlay.
 * SECURITY: only schema and factory defaults are copied, never live values.
 * Returns the number of newly added parameters.
 */
export function mergeUnitIntoOverlay(unit: ParsedUnit, target: DictionaryData = overlay): number {
  let added = 0;
  for (const p of Object.values(unit.params)) {
    const existing = base.params[p.id] ?? target.params[p.id];
    const entry: DictParam = {
      name: p.name,
      unit: p.unit || undefined,
      min: p.min,
      max: p.max,
      default: p.defaultDisplay,
      decimals: p.decimals,
      type: p.type,
      signal: p.signal || undefined,
      enumMap: p.enumMap && Object.keys(p.enumMap).length ? { ...p.enumMap } : undefined,
    };
    if (!existing) {
      target.params[p.id] = entry;
      added++;
    } else if (!base.params[p.id]) {
      target.params[p.id] = { ...entry, ...existing, enumMap: { ...(entry.enumMap ?? {}), ...(existing.enumMap ?? {}) } };
    } else if (entry.enumMap) {
      // Add enum labels unknown to the base dictionary.
      const prev = target.params[p.id]?.enumMap ?? {};
      const extra: Record<string, string> = { ...prev };
      for (const [k, v] of Object.entries(entry.enumMap)) {
        if (!base.params[p.id].enumMap?.[k]) extra[k] = v;
      }
      if (Object.keys(extra).length) target.params[p.id] = { name: p.name, enumMap: extra };
    }
    if (p.groupName && !base.groups[String(p.group).padStart(2, '0')]) {
      target.groups[String(p.group).padStart(2, '0')] = p.groupName;
    }
  }
  const rating = unit.params['07.03'];
  if (rating && typeof rating.raw === 'number' && rating.display && !/^\d+$/.test(rating.display)) {
    const k = String(rating.raw);
    if (!base.driveRatings[k]) target.driveRatings[k] = rating.display;
  }
  target.meta = { ...target.meta, updated: new Date().toISOString() };
  return added;
}
