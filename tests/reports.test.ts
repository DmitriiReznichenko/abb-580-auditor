/**
 * Required test 4: PDF / CSV generation and the English-only language gate.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildSyntheticBackup } from './fixtures/synthetic';
import { extractNodePdfItems, loadBytes } from './helpers/node';
import { auditUnit, profileMeta } from '../src/lib/audit';
import { buildAuditReportPdf, buildFleetCsv, buildFleetPdf, buildFullParamsPdf, buildParamsCsv } from '../src/lib/reports';
import { makeFleetEntry } from '../src/lib/fleet';
import type { GoldenProfile } from '../src/lib/types';

const ascii = (buf: ArrayBuffer, n = 8) => String.fromCharCode(...new Uint8Array(buf).subarray(0, n));

describe('PDF report generation', async () => {
  const golden = await loadBytes(await buildSyntheticBackup({ name: 'GOLD' }), 'GOLD.dcparamsbak');
  const unit = await loadBytes(
    await buildSyntheticBackup({ dialect: 'drivetune', name: 'SYN-07', overrides: { '30.17': 214, '99.16': 0 }, withBin: true }),
    'SYN-07.dcparamsbak',
  );
  const profile: GoldenProfile = {
    id: 'p',
    name: 'Synthetic Dry Coolers',
    category: 'Dry Cooler',
    sourceFormat: 'dcparamsbak',
    sourceFileName: golden.fileName,
    createdAt: '',
    meta: profileMeta(golden),
    ignoredParams: [],
    unit: golden,
  };
  const result = auditUnit(unit, profile);

  it('Audit Report PDF is a valid, non-empty PDF with the verdict', async () => {
    const pdf = buildAuditReportPdf(unit, result, { appVersion: 'test' });
    expect(ascii(pdf, 5)).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(2000);
    const text = (await extractNodePdfItems(new Uint8Array(pdf))).map((i) => i.str).join(' ');
    expect(text).toContain('VERDICT: FAIL');
    expect(text).toContain('Synthetic Dry Coolers');
    expect(text).toContain('30.17');
    expect(text).toMatch(/PHASE ORDER MISMATCH/);
  });

  it('Full Parameters PDF is a valid, non-empty PDF with page numbers', async () => {
    const pdf = buildFullParamsPdf(unit, { appVersion: 'test' });
    expect(ascii(pdf, 5)).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(2000);
    const text = (await extractNodePdfItems(new Uint8Array(pdf))).map((i) => i.str).join(' ');
    expect(text).toMatch(/Page 1 of \d+/);
    expect(text).toContain('Maximum current');
  });

  it('Fleet summary PDF and CSV', () => {
    const e = makeFleetEntry(unit, result);
    const pdf = buildFleetPdf([e], { appVersion: 'test' });
    expect(ascii(pdf, 5)).toBe('%PDF-');
    const csv = buildFleetCsv([e]);
    expect(csv.split(/\r?\n/)[0]).toMatch(/Unit Name/);
    expect(csv).toContain('SYN-07');
    expect(buildParamsCsv(unit)).toContain('30.17');
  });
});

describe('language gate', () => {
  // Built from escapes so this file itself contains no Cyrillic characters.
  const CYRILLIC = new RegExp('[\\u0410-\\u044F\\u0401\\u0451]');

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  }

  it('src/ contains zero Cyrillic characters', () => {
    const offenders = walk(join(process.cwd(), 'src')).filter((f) => CYRILLIC.test(readFileSync(f, 'utf-8')));
    expect(offenders).toEqual([]);
  });

  it('tests/, scripts/ and root config files contain zero Cyrillic characters', () => {
    const files = [
      ...walk(join(process.cwd(), 'tests')),
      ...walk(join(process.cwd(), 'scripts')),
      ...['index.html', 'vite.config.ts', 'package.json', 'README.md'].map((f) => join(process.cwd(), f)),
    ].filter((f) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    });
    expect(files.filter((f) => CYRILLIC.test(readFileSync(f, 'utf-8')))).toEqual([]);
  });
});
