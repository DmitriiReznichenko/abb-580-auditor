/**
 * Fleet log helpers: entry creation and duplicate IP / BACnet Device ID detection.
 */
import type { FleetEntry, ParsedUnit } from './types';
import type { AuditResult } from './audit';
import { normText } from './format';

export function makeFleetEntry(unit: ParsedUnit, result: AuditResult, now = new Date()): FleetEntry {
  const motor = (id: string) => result.identity.motor.find((m) => m.id === id);
  const fmt = (id: string) => {
    const m = motor(id);
    return m ? `${m.value}${m.unit ? ' ' + m.unit : ''}` : '-';
  };
  return {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    unitName: unit.unitName,
    timestamp: now.toISOString(),
    profileName: result.profileName ?? '(none)',
    category: result.category,
    verdict: result.verdict,
    mismatchCount: result.mismatches.length,
    ipAddress: result.identity.bacnet.ipAddress,
    bacnetId: result.identity.bacnet.combinedDeviceId,
    phaseOrder: motor('99.16')?.value ?? '-',
    maxCurrent: fmt('30.17'),
    motorCurrent: fmt('99.06'),
  };
}

export interface NetworkConflict {
  kind: 'ip' | 'bacnet';
  value: string;
  otherUnit: string;
  otherTimestamp: string;
}

function usableIp(ip: string): boolean {
  return !!ip && ip !== '-' && ip !== '0.0.0.0';
}

/**
 * Find fleet entries for OTHER units (different unit name) that share the
 * same IP address or Combined BACnet Device ID.
 */
export function findNetworkConflicts(
  candidate: Pick<FleetEntry, 'unitName' | 'ipAddress' | 'bacnetId'>,
  fleet: FleetEntry[],
): NetworkConflict[] {
  const out: NetworkConflict[] = [];
  const seen = new Set<string>();
  const me = normText(candidate.unitName);
  for (const e of fleet) {
    if (normText(e.unitName) === me) continue;
    if (usableIp(candidate.ipAddress) && e.ipAddress === candidate.ipAddress) {
      const k = `ip|${e.unitName}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ kind: 'ip', value: candidate.ipAddress, otherUnit: e.unitName, otherTimestamp: e.timestamp });
      }
    }
    if (candidate.bacnetId !== null && candidate.bacnetId !== undefined && candidate.bacnetId > 0 && e.bacnetId === candidate.bacnetId) {
      const k = `bacnet|${e.unitName}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ kind: 'bacnet', value: String(candidate.bacnetId), otherUnit: e.unitName, otherTimestamp: e.timestamp });
      }
    }
  }
  return out;
}

export function conflictBannerText(conflicts: NetworkConflict[]): string | null {
  if (!conflicts.length) return null;
  const names = Array.from(new Set(conflicts.map((c) => c.otherUnit))).join(', ');
  return `NETWORK CONFLICT: Duplicate IP or BACnet Device ID already logged on unit ${names}!`;
}

/** Conflicts inside the fleet log itself (for the Fleet Log tab badges). */
export function fleetConflictMap(fleet: FleetEntry[]): Map<string, NetworkConflict[]> {
  const map = new Map<string, NetworkConflict[]>();
  for (const e of fleet) {
    const c = findNetworkConflicts(e, fleet);
    if (c.length) map.set(e.id, c);
  }
  return map;
}
