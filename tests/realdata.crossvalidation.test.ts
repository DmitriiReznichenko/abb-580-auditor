/**
 * REQUIRED TEST 1 (local real data): DC3-18 .dcparamsbak vs DC3-18 Drive
 * Composer PDF cross-validation. Real files are NOT in the repository; this
 * suite runs only when they exist in ABB_REAL_DATA_DIR (default
 * ./.local-fixtures, gitignored) and is skipped in CI, where the synthetic
 * suite (crossvalidation.synthetic.test.ts) covers the same code paths.
 */
import { describe, expect, it } from 'vitest';
import { findReal, loadFile } from './helpers/node';
import { diffUnits } from '../src/lib/audit';
import { valuesEqual } from '../src/lib/compare';

const pdfPath = findReal(/^DC3-18.*\.pdf$/i);
const bakPath = findReal(/^DC3-18.*\.dcparamsbak$/i);
const run = pdfPath && bakPath ? describe : describe.skip;

run('Real data: DC3-18 backup vs DC3-18 PDF', () => {
  it('decodes the same parameter set and 0 parser-induced config mismatches', async () => {
    const bak = await loadFile(bakPath!);
    const pdf = await loadFile(pdfPath!);
    const bakIds = Object.keys(bak.params).sort();
    const pdfIds = Object.keys(pdf.params).sort();
    expect(pdfIds.length).toBeGreaterThan(1200);
    expect(bakIds).toEqual(pdfIds);

    const rows = diffUnits(pdf, bak, { category: 'Dry Cooler' });
    const config = rows.filter((r) => r.cls === 'config' || r.cls === 'presence');
    const noise = rows.filter((r) => r.cls === 'noise');

    // Print a compact report (visible with --reporter=verbose).
    console.log(`[DC3-18] params=${bakIds.length} noiseDiffs=${noise.length} configDiffs=${config.length}`);
    for (const r of config) console.log(`  CONFIG ${r.id} ${r.name}: pdf=${r.goldenValue} bak=${r.unitValue}`);

    // Every value that is not live telemetry must decode identically.
    expect(config).toEqual([]);

    // Group 98 motor model values and group 70 override logs are filtered, never config.
    expect(rows.filter((r) => r.id.startsWith('98.') && r.cls === 'config')).toEqual([]);
    expect(rows.filter((r) => r.id.startsWith('70.') && r.cls === 'config')).toEqual([]);

    // Sanity: a few known decodings agree across formats.
    for (const id of ['99.16', '30.17', '51.04', '96.16', '07.03', '07.04', '20.51', '95.01']) {
      expect(valuesEqual(pdf.params[id], bak.params[id]), id).toBe(true);
    }
  });
});
