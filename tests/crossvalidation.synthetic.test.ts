/**
 * Required test 1 (synthetic, CI): backup vs Drive Composer-style PDF
 * cross-validation with zero parser-induced mismatches, including the
 * noise filter for live telemetry, group 70 logs and the group 98 rule.
 */
import { describe, expect, it } from 'vitest';
import { buildSyntheticBackup } from './fixtures/synthetic';
import { loadBytes } from './helpers/node';
import { buildFullParamsPdf } from '../src/lib/reports';
import { diffUnits } from '../src/lib/audit';
import { valuesEqual } from '../src/lib/compare';

async function synth(opts: Parameters<typeof buildSyntheticBackup>[0], name = 'SYN-01 ABB parameters.dcparamsbak') {
  return loadBytes(await buildSyntheticBackup(opts), name);
}

describe('cross-validation: .dcparamsbak vs PDF (synthetic)', () => {
  for (const dialect of ['drive-composer', 'drivetune'] as const) {
    it(`${dialect}: PDF print of the same unit decodes to identical values`, async () => {
      const bak = await synth({ dialect, name: 'SYN-01' });
      const pdfBytes = new Uint8Array(buildFullParamsPdf(bak, { appVersion: 'test' }));
      const pdf = await loadBytes(pdfBytes, 'SYN-01 parameters.pdf');

      expect(Object.keys(pdf.params).sort()).toEqual(Object.keys(bak.params).sort());
      const mismatched = Object.keys(bak.params).filter((id) => !valuesEqual(bak.params[id], pdf.params[id]));
      expect(mismatched).toEqual([]);
      expect(diffUnits(bak, pdf)).toEqual([]);
      // Enum and numeric codes resolve from PDF labels.
      expect(pdf.params['99.16'].display).toBe('U W V');
      expect(pdf.params['30.17'].display).toBe('291.60');
      expect(pdf.params['04.11'].display.toLowerCase()).toBe('0x7081');
    });
  }

  it('both XML dialects decode to identical display values', async () => {
    const a = await synth({ dialect: 'drive-composer' });
    const b = await synth({ dialect: 'drivetune' });
    for (const id of Object.keys(a.params)) expect(b.params[id].display, id).toBe(a.params[id].display);
  });

  it('live telemetry, counters and group 70 logs are filtered as noise', async () => {
    const golden = await synth({ dialect: 'drive-composer' });
    const unit = await synth({ dialect: 'drivetune', overrides: { '01.01': 1777.25, '05.01': 999, '70.01': 3, '51.31': 4 } });
    const rows = diffUnits(golden, unit, { category: 'Dry Cooler' });
    expect(rows.filter((r) => r.cls === 'config')).toEqual([]);
    expect(rows.filter((r) => r.cls === 'noise').map((r) => r.id).sort()).toEqual(['01.01', '05.01', '51.31', '70.01']);
  });

  it('group 98 motor model values are noise only while 98.01 = Not selected', async () => {
    const golden = await synth({});
    const unitAuto = await synth({ overrides: { '98.02': 0.04321 } });
    expect(diffUnits(golden, unitAuto).find((r) => r.id === '98.02')?.cls).toBe('noise');

    const goldenUser = await synth({ overrides: { '98.01': 1 } });
    const unitUser = await synth({ overrides: { '98.01': 1, '98.02': 0.04321 } });
    expect(diffUnits(goldenUser, unitUser).find((r) => r.id === '98.02')?.cls).toBe('config');
  });
});
