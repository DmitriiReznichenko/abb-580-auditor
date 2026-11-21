/**
 * Client-side extractor for the control panel backup blob stored inside a
 * .dcparamsbak archive (e.g. "00010000_ACH580_AHVK4.bin").
 *
 * Reverse-engineered layout (little endian):
 *   u32 version, u32 entryCount, then entryCount x 74-byte TOC records:
 *     u32 offset, u32 size, u8 id, u8 kind, char[64] name (NUL padded)
 *   Entries include BUINFO.DAT (contains the drive serial number as ASCII),
 *   MOTORPARS/FBPARS/STDPARS/... (binary parameter value images),
 *   ShortParam.cfg (panel favorites list, text) and drivedata.txt
 *   ("<nnnnn>:<nnn>:<drive name>").
 *
 * The blob holds raw parameter VALUES only. Parameter definitions and enum
 * labels are NOT stored in it; they live in the self-describing
 * parameters.dcparams XML, which is why backups from other firmware versions
 * or other 580 series (ACQ580, ACS580) decode automatically from the XML.
 */
import type { BinMetadata, BinTocEntry } from './types';

const ENTRY_SIZE = 74;

function ascii(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

export function parseBackupBin(data: Uint8Array, fileName = 'backup.bin'): BinMetadata | null {
  if (data.length < 8) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint32(0, true);
  const count = view.getUint32(4, true);
  if (count === 0 || count > 512 || 8 + count * ENTRY_SIZE > data.length) return null;

  const entries: BinTocEntry[] = [];
  for (let i = 0; i < count; i++) {
    const o = 8 + i * ENTRY_SIZE;
    const offset = view.getUint32(o, true);
    const size = view.getUint32(o + 4, true);
    const id = data[o + 8];
    const kind = data[o + 9];
    const raw = data.subarray(o + 10, o + ENTRY_SIZE);
    const end = raw.indexOf(0);
    const name = ascii(end >= 0 ? raw.subarray(0, end) : raw);
    if (!name || offset + size > data.length) return null;
    entries.push({ name, offset, size, id, kind });
  }

  const meta: BinMetadata = { fileName, version, entries };
  const get = (name: string) => {
    const e = entries.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return e ? data.subarray(e.offset, e.offset + e.size) : undefined;
  };

  const info = get('BUINFO.DAT');
  if (info) {
    const m = ascii(info).match(/(\d{8,12})/);
    if (m) meta.serialNumber = m[1];
  }

  const dd = get('drivedata.txt');
  if (dd) {
    const line = ascii(dd).split(/\r?\n/)[0] ?? '';
    const parts = line.split(':');
    const name = parts.length >= 3 ? parts.slice(2).join(':').trim() : '';
    if (name) meta.driveName = name;
  }

  const fav = get('ShortParam.cfg');
  if (fav) {
    const lines = ascii(fav).split(/\r?\n/);
    const favorites: string[] = [];
    let group: string | null = null;
    for (const l of lines) {
      const t = l.replace(/[^\x20-\x7e]/g, '').trim();
      if (/^\d{1,3}$/.test(t)) {
        group = t;
      } else if (group && /^\d{1,3}\s*;/.test(t)) {
        const [idx, ...rest] = t.split(';');
        favorites.push(`${group.padStart(2, '0')}.${idx.trim().padStart(2, '0')} ${rest.join(';').trim()}`);
        group = null;
      }
    }
    if (favorites.length) meta.favorites = favorites;
  }

  const fw = fileName.match(/_([A-Z0-9]{5})\.bin$/i);
  if (fw) meta.firmwareName = fw[1].toUpperCase();
  return meta;
}
