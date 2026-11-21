/**
 * Audit engine: Identity Card, safety guards, configuration diff (PASS/FAIL)
 * and noise separation for a target unit against a Golden Profile.
 */
import type { EquipmentCategory, GoldenProfile, ParamRecord, ParsedUnit } from './types';
import { compareIds, matchesIdList, parseIdList, parseNumberText, splitId } from './format';
import { valuesEqual, displayValue } from './compare';
import { dictParam, lookupEvent, type EventInfo } from './dictionary';
import {
  CARD_ONLY,
  criticalGroups,
  isIdentityId,
  isMotorModelId,
  isNoiseId,
  motorModelNotSelected,
} from './noise';

// ---------------------------------------------------------------------------
// Identity Card
// ---------------------------------------------------------------------------

export interface QuickCheckItem {
  id: string;
  label: string;
  value: string;
  unit?: string;
  warn?: string;
}

export interface DecodedEvent {
  id: string;
  label: string;
  code: string;
  event?: EventInfo;
}

export interface IdentityCard {
  unitName: string;
  serialNumber?: string;
  panelDriveName?: string;
  driveRating?: string;
  driveRatingRaw?: number | null;
  firmware?: string;
  firmwareVersion?: string;
  motor: QuickCheckItem[];
  bacnet: {
    ipAddress: string;
    subnetCidr: string;
    subnetMask?: string;
    gateway: string;
    deviceIdHi: number | null;
    deviceIdLo: number | null;
    combinedDeviceId: number | null;
    mappingFileVersion: string;
    commStatus: string;
    embeddedProtocol: string;
    mstpNode: string;
    mstpDeviceId: string;
    fbaType: string;
  };
  events: DecodedEvent[];
}

function p(unit: ParsedUnit, id: string): ParamRecord | undefined {
  return unit.params[id];
}

function rawNum(rec: ParamRecord | undefined): number | null {
  if (!rec) return null;
  if (rec.raw !== null && rec.raw !== undefined && Number.isFinite(rec.raw)) return rec.raw;
  return parseNumberText(rec.display);
}

function disp(rec: ParamRecord | undefined): string {
  return rec ? rec.display : '-';
}

export function ipFrom(unit: ParsedUnit, first: string): string {
  const [g, i] = splitId(first);
  const parts: string[] = [];
  for (let k = 0; k < 4; k++) {
    const id = `${String(g).padStart(2, '0')}.${String(i + k).padStart(2, '0')}`;
    const v = rawNum(p(unit, id));
    if (v === null) return '-';
    parts.push(String(Math.round(v)));
  }
  return parts.join('.');
}

export function cidrToMask(cidr: number): string {
  if (!(cidr >= 0 && cidr <= 32)) return '-';
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return [24, 16, 8, 0].map((s) => (mask >>> s) & 0xff).join('.');
}

/** Combined BACnet/IP Device Instance ID = 51.15 * 10000 + 51.14. */
export function combinedBacnetId(unit: ParsedUnit): number | null {
  const hi = rawNum(p(unit, '51.15'));
  const lo = rawNum(p(unit, '51.14'));
  if (hi === null || lo === null) return null;
  return Math.round(hi) * 10000 + Math.round(lo);
}

export function buildIdentityCard(unit: ParsedUnit): IdentityCard {
  const motorIds: Array<[string, string]> = [
    ['99.04', 'Motor control mode'],
    ['99.06', 'Motor nominal current'],
    ['99.07', 'Motor nominal voltage'],
    ['99.08', 'Motor nominal frequency'],
    ['99.09', 'Motor nominal speed'],
    ['99.10', 'Motor nominal power'],
    ['30.13', 'Minimum frequency'],
    ['30.14', 'Maximum frequency'],
    ['30.17', 'Maximum current'],
    ['28.51', 'Critical frequency function'],
    ['99.16', 'Motor phase order'],
  ];
  const motor: QuickCheckItem[] = motorIds.map(([id, label]) => {
    const rec = p(unit, id);
    return { id, label: rec?.name || label, value: disp(rec), unit: rec?.unit };
  });
  const maxCur = rawNum(p(unit, '30.17'));
  const nomCur = rawNum(p(unit, '99.06'));
  if (maxCur !== null && nomCur !== null && maxCur <= nomCur) {
    const item = motor.find((m) => m.id === '30.17')!;
    item.warn = `30.17 Maximum current (${maxCur} A) is less than or equal to 99.06 Motor nominal current (${nomCur} A).`;
  }
  const skip = p(unit, '28.51');
  if (skip && rawNum(skip) !== 0 && !/disabled|not selected/i.test(skip.display)) {
    motor.find((m) => m.id === '28.51')!.warn = 'Critical (skip) frequencies are enabled - verify 28.52-28.57 bands.';
  }

  const cidr = rawNum(p(unit, '51.09'));
  const eventIds: Array<[string, string]> = [
    ['04.01', 'Tripping fault'],
    ['04.11', 'Latest fault'],
    ['04.12', '2nd latest fault'],
    ['04.13', '3rd latest fault'],
    ['04.16', 'Latest warning'],
    ['04.17', '2nd latest warning'],
    ['04.18', '3rd latest warning'],
  ];
  const events: DecodedEvent[] = eventIds.map(([id, label]) => {
    const rec = p(unit, id);
    const code = rawNum(rec);
    const hex = code === null ? '-' : '0x' + (code >>> 0).toString(16).padStart(4, '0').toUpperCase();
    return { id, label: rec?.name || label, code: hex, event: code ? lookupEvent(code) : undefined };
  });

  const ratingRec = p(unit, '07.03');
  const fwVer = p(unit, '07.05');
  return {
    unitName: unit.unitName,
    serialNumber: unit.serialNumber,
    panelDriveName: unit.binMeta?.driveName,
    driveRating: ratingRec?.display ?? unit.driveModel,
    driveRatingRaw: rawNum(ratingRec),
    firmware: p(unit, '07.04')?.display,
    firmwareVersion: fwVer?.display,
    motor,
    bacnet: {
      ipAddress: ipFrom(unit, '51.05'),
      subnetCidr: cidr === null ? '-' : `/${cidr}`,
      subnetMask: cidr === null ? undefined : cidrToMask(cidr),
      gateway: ipFrom(unit, '51.10'),
      deviceIdHi: rawNum(p(unit, '51.15')),
      deviceIdLo: rawNum(p(unit, '51.14')),
      combinedDeviceId: combinedBacnetId(unit),
      mappingFileVersion: disp(p(unit, '51.30')),
      commStatus: disp(p(unit, '51.31')),
      embeddedProtocol: disp(p(unit, '58.01')),
      mstpNode: disp(p(unit, '58.03')),
      mstpDeviceId: disp(p(unit, '58.40')),
      fbaType: disp(p(unit, '51.01')),
    },
    events,
  };
}

// ---------------------------------------------------------------------------
// Safety guards
// ---------------------------------------------------------------------------

export type AlertLevel = 'danger' | 'warning' | 'info';

export interface SafetyAlert {
  code: 'DRIVE_MISMATCH' | 'PHASE_ORDER' | 'MAX_CURRENT' | 'FIRMWARE' | 'NETWORK_CONFLICT';
  level: AlertLevel;
  title: string;
  message: string;
}

function sameNumber(a: ParamRecord | undefined, b: ParamRecord | undefined): boolean {
  if (!a || !b) return a === b;
  return valuesEqual(a, b);
}

export function driveSignature(unit: ParsedUnit): string {
  return `${unit.params['07.03']?.display ?? '?'} / ${unit.params['99.10']?.display ?? '?'} ${unit.params['99.10']?.unit ?? ''}`.trim();
}

export function safetyChecks(unit: ParsedUnit, golden?: ParsedUnit): SafetyAlert[] {
  const alerts: SafetyAlert[] = [];
  if (golden) {
    const ratingSame = sameNumber(golden.params['07.03'], unit.params['07.03']);
    const powerSame = sameNumber(golden.params['99.10'], unit.params['99.10']);
    if (!ratingSame || !powerSame) {
      alerts.push({
        code: 'DRIVE_MISMATCH',
        level: 'danger',
        title: 'DRIVE / EQUIPMENT MISMATCH',
        message: `DRIVE / EQUIPMENT MISMATCH: Golden Profile is ${driveSignature(golden)}, Target Unit is ${driveSignature(unit)}`,
      });
    }
    const gp = golden.params['99.16'];
    const up = unit.params['99.16'];
    if (gp && up && !valuesEqual(gp, up)) {
      alerts.push({
        code: 'PHASE_ORDER',
        level: 'danger',
        title: 'PHASE ORDER MISMATCH',
        message: `PHASE ORDER MISMATCH — Verify physical rotation! Golden: ${gp.display}, Unit: ${up.display} (99.16).`,
      });
    }
    const gf = golden.params['07.05'];
    const uf = unit.params['07.05'];
    if (gf && uf && gf.display !== uf.display) {
      alerts.push({
        code: 'FIRMWARE',
        level: 'info',
        title: 'Firmware differs',
        message: `Firmware version differs: Golden ${golden.params['07.04']?.display ?? ''} ${gf.display}, Unit ${unit.params['07.04']?.display ?? ''} ${uf.display}.`,
      });
    }
  }
  const maxCur = rawNum(unit.params['30.17']);
  const nomCur = rawNum(unit.params['99.06']);
  if (maxCur !== null && nomCur !== null && maxCur <= nomCur) {
    alerts.push({
      code: 'MAX_CURRENT',
      level: 'warning',
      title: 'MAXIMUM CURRENT LIMIT',
      message: `30.17 Maximum current (${maxCur} A) <= 99.06 Motor nominal current (${nomCur} A). The drive may current-limit below motor nameplate.`,
    });
  }
  return alerts;
}

// ---------------------------------------------------------------------------
// Configuration diff
// ---------------------------------------------------------------------------

export type DiffClass = 'config' | 'noise' | 'identity' | 'ignored' | 'presence';

export interface DiffRow {
  id: string;
  name: string;
  group: number;
  goldenValue: string;
  unitValue: string;
  factoryDefault: string;
  unit: string;
  critical: boolean;
  cls: DiffClass;
  reason?: string;
}

export interface AuditResult {
  unitName: string;
  profileName?: string;
  category?: EquipmentCategory;
  verdict: 'PASS' | 'FAIL' | 'NO PROFILE';
  identity: IdentityCard;
  alerts: SafetyAlert[];
  mismatches: DiffRow[];
  noise: DiffRow[];
  identityDiffs: DiffRow[];
  ignored: DiffRow[];
  presence: DiffRow[];
  comparedCount: number;
}

export interface AuditOptions {
  category?: EquipmentCategory;
  ignoredParams?: string[];
  profileName?: string;
}

function factoryDefault(id: string, g?: ParamRecord, u?: ParamRecord): string {
  const d = dictParam(id)?.default;
  return d ?? g?.defaultDisplay ?? u?.defaultDisplay ?? '';
}

export function classify(
  id: string,
  golden: ParsedUnit,
  unit: ParsedUnit,
  ignored: string[],
): { cls: DiffClass; reason?: string } {
  if (matchesIdList(id, ignored)) return { cls: 'ignored', reason: 'Ignored by profile' };
  if (isIdentityId(id)) return { cls: 'identity', reason: 'Unit-unique identity' };
  if (CARD_ONLY.has(id)) return { cls: 'identity', reason: 'Drive identity (see Identity Card)' };
  if (isNoiseId(id)) return { cls: 'noise', reason: 'Live telemetry / counter / log' };
  if (isMotorModelId(id) && motorModelNotSelected(golden.params['98.01']) && motorModelNotSelected(unit.params['98.01'])) {
    return { cls: 'noise', reason: 'Auto-calculated motor model (98.01 = Not selected)' };
  }
  return { cls: 'config' };
}

export function diffUnits(golden: ParsedUnit, unit: ParsedUnit, opts: AuditOptions = {}): DiffRow[] {
  const ignored = parseIdList((opts.ignoredParams ?? []).join(',')).tokens;
  const crit = criticalGroups(opts.category);
  const ids = Array.from(new Set([...Object.keys(golden.params), ...Object.keys(unit.params)]));
  const rows: DiffRow[] = [];
  for (const id of ids) {
    const g = golden.params[id];
    const u = unit.params[id];
    if (g && u && valuesEqual(g, u)) continue;
    const [group] = splitId(id);
    let { cls, reason } = classify(id, golden, unit, ignored);
    if ((!g || !u) && cls === 'config') {
      cls = 'presence';
      reason = g ? 'Not present in unit file (hidden by unit configuration)' : 'Not present in golden file';
    }
    rows.push({
      id,
      name: (g ?? u)!.name,
      group,
      goldenValue: displayValue(g),
      unitValue: displayValue(u),
      factoryDefault: factoryDefault(id, g, u),
      unit: (g ?? u)!.unit ?? '',
      critical: crit.includes(group),
      cls,
      reason,
    });
  }
  return sortRows(rows, crit);
}

export function sortRows(rows: DiffRow[], crit: number[]): DiffRow[] {
  return rows.sort((a, b) => {
    const ca = crit.indexOf(a.group);
    const cb = crit.indexOf(b.group);
    const pa = ca < 0 ? 1000 : ca;
    const pb = cb < 0 ? 1000 : cb;
    return pa - pb || compareIds(a.id, b.id);
  });
}

export function auditUnit(unit: ParsedUnit, profile?: GoldenProfile | null, extra: AuditOptions = {}): AuditResult {
  const identity = buildIdentityCard(unit);
  if (!profile) {
    return {
      unitName: unit.unitName,
      verdict: 'NO PROFILE',
      identity,
      alerts: safetyChecks(unit),
      mismatches: [],
      noise: [],
      identityDiffs: [],
      ignored: [],
      presence: [],
      comparedCount: 0,
    };
  }
  const opts: AuditOptions = {
    category: profile.category,
    ignoredParams: profile.ignoredParams,
    profileName: profile.name,
    ...extra,
  };
  const rows = diffUnits(profile.unit, unit, opts);
  const mismatches = rows.filter((r) => r.cls === 'config');
  return {
    unitName: unit.unitName,
    profileName: profile.name,
    category: profile.category,
    verdict: mismatches.length === 0 ? 'PASS' : 'FAIL',
    identity,
    alerts: safetyChecks(unit, profile.unit),
    mismatches,
    noise: rows.filter((r) => r.cls === 'noise'),
    identityDiffs: rows.filter((r) => r.cls === 'identity'),
    ignored: rows.filter((r) => r.cls === 'ignored'),
    presence: rows.filter((r) => r.cls === 'presence'),
    comparedCount: Object.keys(unit.params).length,
  };
}

/** Pick the best Golden Profile for a unit by 07.03 drive rating and 99.10 motor power. */
export function autoMatchProfile(unit: ParsedUnit, profiles: GoldenProfile[]): GoldenProfile | undefined {
  return profiles.find(
    (pr) => sameNumber(pr.unit.params['07.03'], unit.params['07.03']) && sameNumber(pr.unit.params['99.10'], unit.params['99.10']),
  );
}

/** Profile auto-metadata from a decoded unit. */
export function profileMeta(unit: ParsedUnit): GoldenProfile['meta'] {
  const u = unit.params;
  return {
    driveRating: u['07.03']?.display,
    driveRatingRaw: rawNum(u['07.03']),
    firmware: [u['07.04']?.display, u['07.05']?.display].filter(Boolean).join(' ') || unit.firmware,
    motorPower: u['99.10'] ? `${u['99.10'].display} ${u['99.10'].unit ?? ''}`.trim() : undefined,
    motorCurrent: u['99.06'] ? `${u['99.06'].display} ${u['99.06'].unit ?? ''}`.trim() : undefined,
    controlMode: u['99.04']?.display,
  };
}

/** Parameters whose value differs from the factory default. */
export function isModifiedFromDefault(rec: ParamRecord): boolean {
  const def = dictParam(rec.id)?.default ?? rec.defaultDisplay;
  if (def === undefined || def === '') return false;
  const fake: ParamRecord = { ...rec, display: def, raw: null };
  return !valuesEqual(rec, fake);
}
