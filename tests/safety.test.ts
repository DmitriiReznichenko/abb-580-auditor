/**
 * Required test 3: safety guards and duplicate IP / BACnet ID detection.
 */
import { describe, expect, it } from 'vitest';
import { buildSyntheticBackup } from './fixtures/synthetic';
import { loadBytes } from './helpers/node';
import { auditUnit, buildIdentityCard, profileMeta, safetyChecks } from '../src/lib/audit';
import { conflictBannerText, findNetworkConflicts, fleetConflictMap, makeFleetEntry } from '../src/lib/fleet';
import type { GoldenProfile, ParsedUnit } from '../src/lib/types';

const unit = async (overrides: Record<string, number> = {}, name = 'SYN-01') =>
  loadBytes(await buildSyntheticBackup({ dialect: 'drivetune', name, overrides }), `${name}.dcparamsbak`);

function prof(u: ParsedUnit): GoldenProfile {
  return { id: 'g', name: 'Golden', category: 'Dry Cooler', sourceFormat: u.source, sourceFileName: u.fileName, createdAt: '', meta: profileMeta(u), ignoredParams: [], unit: u };
}

describe('safety guards', () => {
  it('flags 30.17 = 214 A at or below 99.06 = 217.5 A', async () => {
    const u = await unit({ '30.17': 214, '99.06': 217.5 });
    const alert = safetyChecks(u).find((a) => a.code === 'MAX_CURRENT');
    expect(alert?.level).toBe('warning');
    expect(alert?.message).toContain('214');
    expect(alert?.message).toContain('217.5');
    expect(buildIdentityCard(u).motor.find((m) => m.id === '30.17')?.warn).toBeTruthy();
  });

  it('does not flag 30.17 above 99.06', async () => {
    const u = await unit({ '30.17': 291.6, '99.06': 217.5 });
    expect(safetyChecks(u).find((a) => a.code === 'MAX_CURRENT')).toBeUndefined();
  });

  it('flags a 99.16 phase order mismatch against the Golden Profile', async () => {
    const golden = await unit({ '99.16': 0 });
    const target = await unit({ '99.16': 1 });
    const alert = safetyChecks(target, golden).find((a) => a.code === 'PHASE_ORDER');
    expect(alert?.level).toBe('danger');
    expect(alert?.message).toContain('PHASE ORDER MISMATCH — Verify physical rotation!');
    expect(alert?.message).toContain('U V W');
    expect(alert?.message).toContain('U W V');
  });

  it('shows the DRIVE / EQUIPMENT MISMATCH banner when 07.03 differs', async () => {
    const golden = await unit();
    const target = await unit({ '07.03': 2104 });
    const alert = auditUnit(target, prof(golden)).alerts.find((a) => a.code === 'DRIVE_MISMATCH');
    expect(alert?.level).toBe('danger');
    expect(alert?.message).toBe(
      'DRIVE / EQUIPMENT MISMATCH: Golden Profile is ACH580-01-240A-4 / 180.00 hp, Target Unit is ACH580-01-145A-4 / 180.00 hp',
    );
  });

  it('shows the mismatch banner when 99.10 differs', async () => {
    const alert = safetyChecks(await unit({ '99.10': 150 }), await unit()).find((a) => a.code === 'DRIVE_MISMATCH');
    expect(alert?.message).toContain('Target Unit is ACH580-01-240A-4 / 150.00 hp');
  });

  it('no mismatch banner for an identical drive', async () => {
    expect(safetyChecks(await unit(), await unit()).filter((a) => a.level === 'danger')).toEqual([]);
  });
});

describe('network conflict detector', () => {
  it('detects a duplicate BACnet Device ID across two logged units', async () => {
    const a = await unit({ '51.08': 11, '51.14': 4010, '51.15': 9 }, 'SYN-A');
    const b = await unit({ '51.08': 12, '51.14': 4010, '51.15': 9 }, 'SYN-B');
    const ea = makeFleetEntry(a, auditUnit(a));
    const eb = makeFleetEntry(b, auditUnit(b));
    expect(ea.bacnetId).toBe(94010);
    expect(ea.ipAddress).not.toBe(eb.ipAddress);

    const conflicts = findNetworkConflicts(eb, [ea]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'bacnet', value: '94010', otherUnit: 'SYN-A' });
    expect(conflictBannerText(conflicts)).toBe('NETWORK CONFLICT: Duplicate IP or BACnet Device ID already logged on unit SYN-A!');
    expect(fleetConflictMap([ea, eb]).size).toBe(2);
  });

  it('detects a duplicate IP address', async () => {
    const a = await unit({ '51.14': 1 }, 'SYN-A');
    const b = await unit({ '51.14': 2 }, 'SYN-B');
    const c = findNetworkConflicts(makeFleetEntry(b, auditUnit(b)), [makeFleetEntry(a, auditUnit(a))]);
    expect(c.map((x) => x.kind)).toEqual(['ip']);
    expect(c[0].value).toBe('192.0.2.10');
  });

  it('re-auditing the same unit name is not a conflict; empty IP / ID 0 are ignored', async () => {
    const a = await unit({}, 'SYN-A');
    const e1 = makeFleetEntry(a, auditUnit(a));
    const e2 = makeFleetEntry(a, auditUnit(a));
    expect(findNetworkConflicts(e2, [e1])).toEqual([]);

    const z1 = await unit({ '51.05': 0, '51.06': 0, '51.07': 0, '51.08': 0, '51.14': 0, '51.15': 0 }, 'Z1');
    const z2 = await unit({ '51.05': 0, '51.06': 0, '51.07': 0, '51.08': 0, '51.14': 0, '51.15': 0 }, 'Z2');
    expect(findNetworkConflicts(makeFleetEntry(z2, auditUnit(z2)), [makeFleetEntry(z1, auditUnit(z1))])).toEqual([]);
  });
});
