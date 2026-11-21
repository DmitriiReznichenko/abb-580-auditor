/**
 * Loader, panel backup blob, id list and library file tests (synthetic).
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildSyntheticBackup, buildSyntheticBin } from './fixtures/synthetic';
import { loadBytes } from './helpers/node';
import { detectFileKind, INVALID_FILE_MESSAGE, unitNameFromFileName } from '../src/lib/loader';
import { parseBackupBin } from '../src/lib/bin';
import { matchesIdList, parseIdList } from '../src/lib/format';
import { buildLibraryFile, parseLibraryFile } from '../src/lib/db';
import { profileMeta } from '../src/lib/audit';
import { isNoiseId } from '../src/lib/noise';

describe('file loader', () => {
  it('detects magic bytes', () => {
    expect(detectFileKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe('zip');
    expect(detectFileKind(new TextEncoder().encode('%PDF-1.7\n'))).toBe('pdf');
    expect(detectFileKind(new TextEncoder().encode('hello'))).toBe('unknown');
  });

  it('rejects invalid files with a clear English message', async () => {
    await expect(loadBytes(new TextEncoder().encode('not a backup'), 'notes.txt')).rejects.toThrow(INVALID_FILE_MESSAGE);
  });

  it('rejects ZIP archives without parameters.dcparams', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'x');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(loadBytes(bytes, 'x.dcparamsbak')).rejects.toThrow(/parameters\.dcparams/);
  });

  it('derives unit names from file names', () => {
    expect(unitNameFromFileName('UNIT-07 ABB parameters backup file 1.dcparamsbak')).toBe('UNIT-07');
    expect(unitNameFromFileName('UNIT-18_backup_0000000001.dcparamsbak')).toBe('UNIT-18');
    expect(unitNameFromFileName('UNIT-18 parameters.pdf')).toBe('UNIT-18');
  });

  it('reads name and serial from a Drivetune file and the side-car XML / panel blob', async () => {
    const dt = await loadBytes(await buildSyntheticBackup({ dialect: 'drivetune', name: 'SYN-DT', serial: '9900000123' }), 'whatever.dcparamsbak');
    expect(dt.unitName).toBe('SYN-DT');
    expect(dt.serialNumber).toBe('9900000123');
    const dc = await loadBytes(await buildSyntheticBackup({ withBin: true, withSideXml: true, serial: '9900000456' }), 'SYN-DC ABB parameters.dcparamsbak');
    expect(dc.unitName).toBe('SYN-DC');
    expect(dc.serialNumber).toBe('9900000456');
    expect(dc.binMeta?.firmwareName).toBe('AHVK4');
  });
});

describe('panel backup blob (.bin) extractor', () => {
  it('parses the TOC, serial, drive name and favorites', () => {
    const meta = parseBackupBin(buildSyntheticBin('9900000789', 'SYN PANEL 9'), '00010000_ACH580_AHVK4.bin');
    expect(meta?.entries.map((e) => e.name)).toContain('BUINFO.DAT');
    expect(meta?.serialNumber).toBe('9900000789');
    expect(meta?.driveName).toBe('SYN PANEL 9');
    expect(meta?.favorites).toEqual(['30.17 Maximum current', '99.06 Motor nominal current']);
  });

  it('returns null for unknown layouts', () => {
    expect(parseBackupBin(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull();
  });
});

describe('ignored parameter lists', () => {
  it('parses ids, ranges and whole groups', () => {
    const r = parseIdList('28.51 - 28.57, 40.21; 41.*\n7.3 bogus');
    expect(r.tokens).toEqual(['28.51-28.57', '40.21', '41.*', '07.03']);
    expect(r.invalid).toEqual(['bogus']);
    expect(matchesIdList('28.54', r.tokens)).toBe(true);
    expect(matchesIdList('28.58', r.tokens)).toBe(false);
    expect(matchesIdList('41.30', r.tokens)).toBe(true);
    expect(matchesIdList('40.22', r.tokens)).toBe(false);
  });
});

describe('noise list', () => {
  it('keeps 45.11 and BACnet config while filtering telemetry', () => {
    expect(isNoiseId('45.11')).toBe(false);
    expect(isNoiseId('45.01')).toBe(true);
    expect(isNoiseId('51.09')).toBe(false);
    expect(isNoiseId('51.10')).toBe(false);
    expect(isNoiseId('51.30')).toBe(false);
    expect(isNoiseId('51.31')).toBe(true);
    expect(isNoiseId('10.101')).toBe(true);
    expect(isNoiseId('70.50')).toBe(true);
    expect(isNoiseId('30.17')).toBe(false);
  });
});

describe('Golden library export / import', () => {
  it('round-trips profiles and rejects foreign JSON', async () => {
    const u = await loadBytes(await buildSyntheticBackup({}), 'G.dcparamsbak');
    const lib = buildLibraryFile([
      { id: 'a', name: 'Synthetic', category: 'Pump', sourceFormat: 'dcparamsbak', sourceFileName: 'G', createdAt: '', meta: profileMeta(u), ignoredParams: ['28.51-28.57'], unit: u },
    ]);
    const back = parseLibraryFile(JSON.stringify(lib));
    expect(back[0].name).toBe('Synthetic');
    expect(back[0].unit.params['30.17'].display).toBe('291.60');
    expect(() => parseLibraryFile('{"hello":1}')).toThrow();
  });
});
