/**
 * Smart noise filtering rules: telemetry, counters, logs, auto-calculated
 * motor model values and reset triggers are excluded from the configuration
 * verdict. Unit-unique identity parameters are routed to the Identity Card.
 */
import type { ParamRecord, EquipmentCategory } from './types';
import { inRange, splitId } from './format';

/** Groups that are entirely read-only telemetry / logs. */
export const NOISE_GROUPS = new Set([1, 3, 4, 5, 6, 36, 45, 47]);
/** Exceptions inside noise groups that ARE configuration. */
export const NOISE_GROUP_EXCEPTIONS = new Set(['45.11']);

/** Individual ids or inclusive ranges [from, to]. */
export const NOISE_RANGES: Array<[string, string]> = [
  ['07.05', '07.05'],
  ['07.11', '07.11'],
  ['07.13', '07.13'],
  ['07.30', '07.31'],
  ['10.01', '10.02'],
  ['10.21', '10.21'],
  ['10.99', '10.103'],
  ['11.38', '11.39'],
  ['12.11', '12.12'],
  ['12.21', '12.22'],
  ['12.101', '12.102'],
  ['13.11', '13.11'],
  ['13.21', '13.21'],
  ['13.91', '13.92'],
  ['15.02', '15.02'],
  ['19.01', '19.01'],
  ['22.01', '22.01'],
  ['22.80', '22.80'],
  ['22.86', '22.87'],
  ['23.01', '23.02'],
  ['24.01', '24.04'],
  ['25.01', '25.01'],
  ['25.53', '25.56'],
  ['28.01', '28.02'],
  ['28.92', '28.92'],
  ['28.96', '28.97'],
  ['30.01', '30.02'],
  ['32.01', '32.01'],
  ['34.01', '34.04'],
  ['35.01', '35.05'],
  ['37.01', '37.01'],
  ['40.01', '40.06'],
  ['40.61', '40.62'],
  ['40.70', '40.70'],
  ['40.91', '40.99'],
  ['49.06', '49.06'],
  ['50.13', '50.18'],
  ['51.27', '51.29'],
  ['51.31', '51.33'],
  ['58.02', '58.02'],
  ['58.07', '58.13'],
  ['58.18', '58.19'],
  ['70.01', '70.01'],
  ['70.40', '70.69'],
  ['71.01', '71.06'],
  ['71.62', '71.62'],
  ['72.01', '72.06'],
  ['72.62', '72.62'],
  ['73.01', '73.06'],
  ['73.62', '73.62'],
  ['74.01', '74.06'],
  ['74.62', '74.62'],
  ['77.10', '77.18'],
  ['80.01', '80.05'],
  ['81.01', '81.02'],
  ['81.30', '81.30'],
  ['82.56', '82.57'],
  ['84.02', '84.02'],
  ['84.99', '84.99'],
  ['95.03', '95.03'],
  ['96.03', '96.04'],
  ['96.06', '96.08'],
  ['96.10', '96.11'],
  ['96.24', '96.26'],
  ['96.51', '96.51'],
  ['96.68', '96.69'],
  ['97.135', '97.135'],
];

/** Auto-calculated motor model values, noise while 98.01 = Not selected. */
export const MOTOR_MODEL_RANGE: [string, string] = ['98.02', '98.14'];

/** Unit-unique identity parameters (shown in the Identity Card, never a config failure). */
export const IDENTITY_RANGES: Array<[string, string]> = [
  ['49.01', '49.01'],
  ['51.05', '51.08'],
  ['51.14', '51.15'],
  ['58.03', '58.03'],
  ['58.40', '58.40'],
  ['99.16', '99.16'],
];

/**
 * Drive identity values reported in the card / safety banners instead of the
 * table: drive rating, firmware name and the read-only loading /
 * customization package name+version mirrors of the firmware (07.06, 07.07,
 * 07.25, 07.26). A firmware difference is reported as a separate notice.
 */
export const CARD_ONLY = new Set(['07.03', '07.04', '07.06', '07.07', '07.25', '07.26']);

export function isNoiseId(id: string): boolean {
  const [g] = splitId(id);
  if (NOISE_GROUPS.has(g) && !NOISE_GROUP_EXCEPTIONS.has(id)) return true;
  return NOISE_RANGES.some(([a, b]) => inRange(id, a, b));
}

export function isIdentityId(id: string): boolean {
  return IDENTITY_RANGES.some(([a, b]) => inRange(id, a, b));
}

/** 98.01 "User motor model mode" is Not selected (code 0). */
export function motorModelNotSelected(p: ParamRecord | undefined): boolean {
  if (!p) return true;
  if (p.raw === 0) return true;
  return /not selected/i.test(p.display);
}

export function isMotorModelId(id: string): boolean {
  return inRange(id, MOTOR_MODEL_RANGE[0], MOTOR_MODEL_RANGE[1]);
}

/** Critical groups (audited first) per equipment category. */
export function criticalGroups(category: EquipmentCategory | undefined): number[] {
  const base = [20, 21, 28, 30, 31, 35, 51, 84, 97, 99];
  if (category === 'Pump') return [20, 21, 28, 30, 31, 35, 40, 41, 51, 76, 80, 81, 82, 84, 97, 99];
  return base;
}
