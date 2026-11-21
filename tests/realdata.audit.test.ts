/**
 * REQUIRED TEST 2 (local real data): DC4-07 audited against a DC3-18 Golden
 * Profile. Both Golden formats (.dcparamsbak and Drive Composer PDF) must
 * produce an identical configuration diff. Prints the Identity Card, the
 * Combined BACnet ID and the full diff table. Skipped when the real files
 * are absent (CI); no real values are hardcoded in this file.
 */
import { describe, expect, it } from 'vitest';
import { findReal, loadFile } from './helpers/node';
import { auditUnit, profileMeta, type AuditResult } from '../src/lib/audit';
import type { GoldenProfile, ParsedUnit } from '../src/lib/types';

const goldenPdfPath = findReal(/^DC3-18.*\.pdf$/i);
const goldenBakPath = findReal(/^DC3-18.*\.dcparamsbak$/i);
const targetPath = findReal(/^DC4-07.*\.dcparamsbak$/i);
const run = goldenPdfPath && goldenBakPath && targetPath ? describe : describe.skip;

function profile(unit: ParsedUnit, name: string): GoldenProfile {
  return {
    id: name,
    name,
    category: 'Dry Cooler',
    sourceFormat: unit.source,
    sourceFileName: unit.fileName,
    createdAt: new Date().toISOString(),
    meta: profileMeta(unit),
    ignoredParams: [],
    unit,
  };
}

function printReport(r: AuditResult): void {
  const c = r.identity;
  const b = c.bacnet;
  const lines: string[] = [];
  lines.push(`=== Identity Card: ${c.unitName} ===`);
  lines.push(`Serial: ${c.serialNumber ?? '-'} | Panel name: ${c.panelDriveName ?? '-'}`);
  lines.push(`Drive: ${c.driveRating} | Firmware: ${c.firmware} ${c.firmwareVersion}`);
  for (const m of c.motor) lines.push(`  ${m.id} ${m.label}: ${m.value}${m.unit ? ' ' + m.unit : ''}${m.warn ? '  [WARN] ' + m.warn : ''}`);
  lines.push(`BACnet: FBA ${b.fbaType} | IP ${b.ipAddress} ${b.subnetCidr} (${b.subnetMask}) | GW ${b.gateway}`);
  lines.push(`Combined BACnet/IP Device ID = ${b.deviceIdHi} * 10000 + ${b.deviceIdLo} = ${b.combinedDeviceId}`);
  lines.push(`Mapping ver ${b.mappingFileVersion} | Comm ${b.commStatus} | 58.01 ${b.embeddedProtocol} | MS/TP node ${b.mstpNode} | MS/TP ID ${b.mstpDeviceId}`);
  for (const e of c.events) lines.push(`  ${e.id} ${e.label}: ${e.code}${e.event ? ' ' + e.event.name : ''}`);
  lines.push(`Alerts: ${r.alerts.map((a) => a.code).join(', ') || 'none'}`);
  lines.push(`=== Verdict ${r.verdict} vs ${r.profileName}: ${r.mismatches.length} mismatches ===`);
  lines.push('Param # | Parameter Name | Golden Value | Unit Value | Factory Default');
  for (const m of r.mismatches) lines.push(`${m.id} | ${m.name} | ${m.goldenValue} | ${m.unitValue} | ${m.factoryDefault}`);
  lines.push(`Filtered: noise ${r.noise.length}, identity ${r.identityDiffs.length} [${r.identityDiffs.map((x) => x.id).join(' ')}], presence ${r.presence.length}, ignored ${r.ignored.length}`);
  console.log(lines.join('\n'));
}

run('Real data: DC4-07 vs DC3-18 Golden', () => {
  it('bak golden and PDF golden produce an identical config diff', async () => {
    const goldenBak = await loadFile(goldenBakPath!);
    const goldenPdf = await loadFile(goldenPdfPath!);
    const target = await loadFile(targetPath!);

    const a = auditUnit(target, profile(goldenBak, 'DC3-18 (.dcparamsbak)'));
    const b = auditUnit(target, profile(goldenPdf, 'DC3-18 (PDF)'));
    printReport(a);

    const key = (r: AuditResult) => r.mismatches.map((m) => `${m.id}|${m.goldenValue}|${m.unitValue}|${m.factoryDefault}`);
    expect(key(a)).toEqual(key(b));
    expect(a.verdict).toBe('FAIL');
    expect(a.mismatches.map((m) => m.id)).toContain('30.17');

    const card = a.identity;
    expect(card.unitName).toBe('DC4-07');
    expect(card.serialNumber).toMatch(/^\d{8,12}$/);
    const hi = card.bacnet.deviceIdHi!;
    const lo = card.bacnet.deviceIdLo!;
    expect(card.bacnet.combinedDeviceId).toBe(hi * 10000 + lo);
    expect(a.alerts.some((x) => x.code === 'MAX_CURRENT')).toBe(true);
  });
});
