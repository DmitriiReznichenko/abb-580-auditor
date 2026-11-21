/**
 * 100% synthetic test fixtures. Generates .dcparamsbak ZIP archives in both
 * XML dialects (Drive Composer and Drivetune) plus a synthetic panel backup
 * blob. Uses RFC 5737 documentation IPs (192.0.2.x) and fake serial numbers.
 * No data from real drives is contained here.
 */
import JSZip from 'jszip';
import { dictParam } from '../../src/lib/dictionary';
import { labelToCode } from '../../src/lib/format';

export type Dialect = 'drive-composer' | 'drivetune';

/** Encode five characters as StringAscii5 (6-bit, offset 47, top bit unused). */
export function encodeAscii5(s: string): number {
  const t = s.padStart(5, '_').slice(0, 5);
  let v = 0;
  for (let i = 0; i < 5; i++) v += ((t.charCodeAt(i) - 47) & 0x3f) * 2 ** (25 - 6 * i);
  return v;
}

export function encodeVersion(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/**
 * Baseline synthetic unit. Decimal parameters hold engineering values; all
 * other types hold raw codes.
 */
export const BASE_VALUES: Record<string, number> = {
  // Live telemetry / counters (noise)
  '01.01': 1200.5,
  '05.01': 120,
  '70.01': 0,
  // Faults / warnings
  '04.01': 0,
  '04.11': 0x7081,
  '04.12': 0x7081,
  '04.13': 0,
  '04.16': 0xafee,
  '04.17': 0xafee,
  '04.18': 0,
  // System info
  '07.03': 2854,
  '07.04': encodeAscii5('AHVK4'),
  '07.05': encodeVersion(2, 22, 0, 0),
  // Start / stop
  '20.01': 1,
  '21.01': 2,
  '10.24': 2,
  // Critical frequencies / limits
  '28.51': 0,
  '28.52': 0,
  '30.13': 20,
  '30.14': 60,
  '30.17': 291.6,
  // PID
  '40.11': 1.5,
  // Fieldbus adapter (BACnet/IP), RFC 5737 addresses
  '51.01': 47808,
  '51.05': 192,
  '51.06': 0,
  '51.07': 2,
  '51.08': 10,
  '51.09': 24,
  '51.10': 192,
  '51.11': 0,
  '51.12': 2,
  '51.13': 1,
  '51.14': 4010,
  '51.15': 9,
  '51.22': 0,
  '51.30': 3,
  '51.31': 5,
  // Embedded fieldbus
  '58.01': 0,
  '58.03': 0,
  '58.40': 0,
  // Units / motor model / motor data
  '96.16': 5,
  '98.01': 0,
  '98.02': 0.01234,
  '99.04': 1,
  '99.06': 216,
  '99.07': 460,
  '99.08': 60,
  '99.09': 1785,
  '99.10': 180,
  '99.16': 1,
};

export interface SynthOptions {
  dialect?: Dialect;
  /** Drive name stored in the file (Drivetune only). */
  name?: string;
  serial?: string;
  overrides?: Record<string, number>;
  omit?: string[];
  withBin?: boolean;
  binDriveName?: string;
  withSideXml?: boolean;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function defaultRaw(id: string, fallback: number): number {
  const d = dictParam(id);
  if (!d || d.default === undefined || d.default === '') return fallback;
  const t = d.type ?? 'Decimal';
  const s = d.default;
  if (t === 'Hex') return parseInt(s.replace(/^0x/i, '').replace(/\s+/g, ''), 16);
  if (t === 'Binary') return parseInt(s.replace(/^0b/i, '').replace(/\s+/g, ''), 2);
  if (t === 'Version' || t === 'StringAscii5') return fallback;
  if (d.enumMap && Object.keys(d.enumMap).length && t !== 'Decimal') return labelToCode(s, d.enumMap) ?? fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function paramXml(id: string, value: number, dialect: Dialect): string {
  const d = dictParam(id);
  if (!d) throw new Error(`Synthetic fixture uses unknown parameter ${id}`);
  const [g, i] = id.split('.').map(Number);
  const type = d.type ?? 'Decimal';
  const dec = d.decimals ?? 0;
  const isDec = type === 'Decimal';
  const def = defaultRaw(id, value);
  const items = d.enumMap && !isDec ? Object.entries(d.enumMap) : [];
  const unit = d.unit ? esc(d.unit) : 'NoUnit';

  if (dialect === 'drive-composer') {
    // Decimal RawValue is a scaled integer in Drive Composer files; Value is engineering.
    const scaled = isDec ? Math.round(value * 10 ** dec) : value;
    const scaledDef = isDec ? Math.round(def * 10 ** dec) : def;
    const list = items.length
      ? `<ValueNames>${items.map(([k, v]) => `<ValueListItem><Name>${esc(v)}</Name><Value>${k}</Value></ValueListItem>`).join('')}</ValueNames>`
      : '<ValueNames />';
    return [
      '<DriveParameter>',
      `<DefaultValue>${def}</DefaultValue>`,
      `<DisplayDecimals>${dec}</DisplayDecimals>`,
      `<Group>${g}</Group>`,
      `<Index>${i}</Index>`,
      `<IsSignal>${d.signal ? 'true' : 'false'}</IsSignal>`,
      `<Name>${esc(d.name)}</Name>`,
      `<RawDefaultValue>${scaledDef}</RawDefaultValue>`,
      `<RawValue>${scaled}</RawValue>`,
      `<Type>${type}</Type>`,
      `<Unit>${unit}</Unit>`,
      `<Value>${isDec ? value : 0}</Value>`,
      list,
      '</DriveParameter>',
    ].join('\n      ');
  }
  // Drivetune: Value-then-Name list order; RawDefaultValue mirrors RawValue.
  const list = items.length
    ? `<ParameterList><Values>${items.map(([k, v]) => `<ValueListItem><Value>${k}</Value><Name>${esc(v)}</Name></ValueListItem>`).join('')}</Values></ParameterList>`
    : '<ParameterList><Values /></ParameterList>';
  return [
    '<DriveParameter>',
    `<Type>${type}</Type>`,
    `<Group>${g}</Group>`,
    `<Index>${i}</Index>`,
    `<Name>${esc(d.name)}</Name>`,
    `<Value>${value}</Value>`,
    `<RawValue>${value}</RawValue>`,
    `<RawDefaultValue>${value}</RawDefaultValue>`,
    `<Unit>${unit}</Unit>`,
    `<DisplayDecimals>${dec}</DisplayDecimals>`,
    list,
    `<IsSignal>${d.signal ? 'true' : 'false'}</IsSignal>`,
    '</DriveParameter>',
  ].join('\n\t\t\t');
}

export function buildDcparamsXml(opts: SynthOptions = {}): string {
  const dialect = opts.dialect ?? 'drive-composer';
  const values = { ...BASE_VALUES, ...(opts.overrides ?? {}) };
  for (const id of opts.omit ?? []) delete values[id];
  const ids = Object.keys(values).sort((a, b) => (a < b ? -1 : 1));
  const params = ids.map((id) => paramXml(id, values[id], dialect)).join('\n');
  if (dialect === 'drive-composer') {
    return `<?xml version="1.0"?>
<ParameterFileContent xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <DriveProperties>
    <DriveModel>ACH580-01-240A-4</DriveModel>
    <Name />
    <SourceType>Drive</SourceType>
  </DriveProperties>
  <DriveType>ACSX80</DriveType>
  <GroupList>
    <GroupData><Index>99</Index><Name>Motor data</Name></GroupData>
  </GroupList>
  <ParameterList>
${params}
  </ParameterList>
</ParameterFileContent>`;
  }
  return `<?xml version="1.0"?>
<ParameterFileContent xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
\t<Application>v0.0.0.0000</Application>
\t<CreationTime>2000-01-01T00:00:00 +0000</CreationTime>
\t<DriveType>ACSX80</DriveType>
\t<DriveProperties>
\t\t<Name>${esc(opts.name ?? 'SYN-UNIT')}</Name>
\t\t<Kind>ACH580</Kind>
\t\t<SerialNumber>${esc(opts.serial ?? '9900000001')}</SerialNumber>
\t</DriveProperties>
\t<ParameterList>
${params}
\t</ParameterList>
</ParameterFileContent>`;
}

/** Synthetic panel backup blob with the reverse-engineered TOC layout. */
export function buildSyntheticBin(serial: string, driveName: string): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s);
  const blobs: Array<[string, Uint8Array]> = [
    ['BUTOC.DAT', new Uint8Array(16)],
    ['BUINFO.DAT', enc(`SYNTH\0${serial}\0`)],
    ['STDPARS.DAT', new Uint8Array(32)],
    ['ShortParam.cfg', enc('30\r\n17;Maximum current\r\n99\r\n6;Motor nominal current\r\n')],
    ['drivedata.txt', enc(`00001:001:${driveName}\r\n`)],
  ];
  const ENTRY = 74;
  let offset = 8 + blobs.length * ENTRY;
  const total = offset + blobs.reduce((s, [, b]) => s + b.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, blobs.length, true);
  blobs.forEach(([name, data], i) => {
    const o = 8 + i * ENTRY;
    view.setUint32(o, offset, true);
    view.setUint32(o + 4, data.length, true);
    out[o + 8] = i + 1;
    out[o + 9] = 1;
    out.set(enc(name).subarray(0, 63), o + 10);
    out.set(data, offset);
    offset += data.length;
  });
  return out;
}

export async function buildSyntheticBackup(opts: SynthOptions = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('parameters.dcparams', buildDcparamsXml(opts));
  if (opts.withSideXml) zip.file('DriveInfo.xml', '<?xml version="1.0"?><DriveInfo><Family>ACH580</Family><Variant /></DriveInfo>');
  if (opts.withBin) zip.file('00010000_ACH580_AHVK4.bin', buildSyntheticBin(opts.serial ?? '9900000002', opts.binDriveName ?? 'SYN PANEL 01'));
  return zip.generateAsync({ type: 'uint8array' });
}
