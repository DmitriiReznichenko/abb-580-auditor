/**
 * Required test 2 (synthetic, CI): target unit audit against a Golden
 * Profile. A .dcparamsbak golden and a PDF golden must give an identical
 * configuration diff. Identity Card / BACnet decoding is verified too.
 */
import { describe, expect, it } from 'vitest';
import { buildSyntheticBackup } from './fixtures/synthetic';
import { loadBytes } from './helpers/node';
import { buildFullParamsPdf } from '../src/lib/reports';
import { auditUnit, autoMatchProfile, buildIdentityCard, profileMeta } from '../src/lib/audit';
import type { GoldenProfile, ParsedUnit } from '../src/lib/types';

function profile(unit: ParsedUnit, name: string, extra: Partial<GoldenProfile> = {}): GoldenProfile {
  return {
    id: name,
    name,
    category: 'Dry Cooler',
    sourceFormat: unit.source,
    sourceFileName: unit.fileName,
    createdAt: '2000-01-01T00:00:00Z',
    meta: profileMeta(unit),
    ignoredParams: [],
    unit,
    ...extra,
  };
}

const TARGET_OVERRIDES = {
  // Unit-unique identity (must NOT be config mismatches)
  '51.08': 20,
  '51.14': 4020,
  // Genuine configuration differences
  '30.17': 214.6,
  '51.10': 0,
  '51.11': 0,
  '51.12': 0,
  '51.13': 0,
  '51.22': 1,
  '58.01': 2,
  // Telemetry (noise)
  '01.01': 300,
};

describe('target unit audit (synthetic)', () => {
  it('.dcparamsbak golden and PDF golden produce an identical config diff', async () => {
    const goldenBak = await loadBytes(await buildSyntheticBackup({ dialect: 'drivetune', name: 'GOLD-01' }), 'GOLD-01_backup_0000000001.dcparamsbak');
    const goldenPdf = await loadBytes(new Uint8Array(buildFullParamsPdf(goldenBak, { appVersion: 'test' })), 'GOLD-01 parameters.pdf');
    const target = await loadBytes(
      await buildSyntheticBackup({ dialect: 'drive-composer', overrides: TARGET_OVERRIDES, withBin: true, serial: '9900000077', binDriveName: 'SYN AREA UNIT-02' }),
      'UNIT-02 ABB parameters backup file 1.dcparamsbak',
    );

    const a = auditUnit(target, profile(goldenBak, 'Golden (bak)'));
    const b = auditUnit(target, profile(goldenPdf, 'Golden (pdf)'));
    const summarize = (r: typeof a) => r.mismatches.map((m) => `${m.id}|${m.goldenValue}|${m.unitValue}|${m.factoryDefault}`);

    expect(a.verdict).toBe('FAIL');
    expect(summarize(a)).toEqual(summarize(b));
    expect(a.mismatches.map((m) => m.id)).toEqual(['30.17', '51.10', '51.12', '51.13', '51.22', '58.01']);
    const r3017 = a.mismatches[0];
    expect([r3017.goldenValue, r3017.unitValue, r3017.factoryDefault]).toEqual(['291.60', '214.60', '291.60']);
    expect(a.identityDiffs.map((r) => r.id).sort()).toEqual(['51.08', '51.14']);
    expect(a.noise.map((r) => r.id)).toContain('01.01');

    // Identity card
    const card = buildIdentityCard(target);
    expect(card.unitName).toBe('UNIT-02');
    expect(card.serialNumber).toBe('9900000077');
    expect(card.panelDriveName).toBe('SYN AREA UNIT-02');
    expect(card.driveRating).toBe('ACH580-01-240A-4');
    expect(card.firmware).toBe('AHVK4');
    expect(card.firmwareVersion).toBe('2.22.0.0');
    expect(card.bacnet.ipAddress).toBe('192.0.2.20');
    expect(card.bacnet.subnetMask).toBe('255.255.255.0');
    expect(card.bacnet.gateway).toBe('0.0.0.0');
    expect(card.bacnet.combinedDeviceId).toBe(9 * 10000 + 4020);
    expect(card.bacnet.embeddedProtocol).toBe('BACnet MSTP');
    expect(card.events.find((e) => e.id === '04.11')?.event?.name).toMatch(/panel loss/i);
    expect(card.events.find((e) => e.id === '04.16')?.event?.name).toMatch(/interlock/i);
  });

  it('identical units PASS and ignored ranges are honored', async () => {
    const golden = await loadBytes(await buildSyntheticBackup({}), 'GOLD.dcparamsbak');
    const same = await loadBytes(await buildSyntheticBackup({ dialect: 'drivetune', name: 'UNIT-03' }), 'x.dcparamsbak');
    expect(auditUnit(same, profile(golden, 'G')).verdict).toBe('PASS');

    const skip = await loadBytes(await buildSyntheticBackup({ overrides: { '28.52': 31.5, '40.11': 2.5 } }), 'y.dcparamsbak');
    const r = auditUnit(skip, profile(golden, 'G', { ignoredParams: ['28.51-28.57', '40.*'] }));
    expect(r.verdict).toBe('PASS');
    expect(r.ignored.map((x) => x.id)).toEqual(['28.52', '40.11']);
  });

  it('auto-matches the Golden Profile by 07.03 and 99.10', async () => {
    const g180 = await loadBytes(await buildSyntheticBackup({}), 'g180.dcparamsbak');
    const g200 = await loadBytes(await buildSyntheticBackup({ overrides: { '99.10': 200 } }), 'g200.dcparamsbak');
    const target = await loadBytes(await buildSyntheticBackup({ overrides: { '99.10': 200 } }), 't.dcparamsbak');
    const list = [profile(g180, '180 hp'), profile(g200, '200 hp')];
    expect(autoMatchProfile(target, list)?.name).toBe('200 hp');
  });
});
