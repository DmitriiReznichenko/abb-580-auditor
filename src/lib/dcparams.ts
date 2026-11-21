/**
 * Decoder for ABB parameter files (*.dcparams XML) found inside .dcparamsbak
 * ZIP backups. Two dialects exist and both are supported:
 *
 *  - Drive Composer (PC): tags sorted alphabetically, includes OpcAddress,
 *    EDSDataType, reliable DefaultValue / RawDefaultValue.
 *  - Drivetune (mobile, Bluetooth): tab-indented, includes <Application>,
 *    <CreationTime>, drive Name and SerialNumber in DriveProperties.
 *    NOTE: Drivetune writes RawDefaultValue == RawValue for every parameter,
 *    so factory defaults must come from the dictionary instead.
 *
 * Value rules (verified against a Drive Composer print of the same unit):
 *  - Decimal: engineering value is <Value> (already scaled; RawValue may be a
 *    scaled integer in Drive Composer files), shown with DisplayDecimals.
 *  - Lists / pointers: the selected code is <RawValue>; labels come from
 *    <ValueNames> (fallback <ParameterList><Values>). <Value> is unreliable.
 *  - Hex, Binary, dates, times, versions, packed strings: decoded from RawValue.
 */
import { XMLParser } from 'fast-xml-parser';
import type { ParamRecord } from './types';
import { dictParam, groupName as dictGroupName, driveRatingLabel } from './dictionary';
import { formatByType, labelToCode, pid } from './format';

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['DriveParameter', 'ValueListItem', 'string', 'GroupData'].includes(name),
});

function text(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') {
    const t = (v as XmlNode)['#text'];
    return t === undefined ? '' : String(t);
  }
  return String(v);
}

function num(v: unknown): number {
  const t = text(v);
  if (t === '') return NaN;
  return Number(t);
}

function listItems(node: unknown): Array<[string, number]> {
  if (!node || typeof node !== 'object') return [];
  const out: Array<[string, number]> = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const obj = n as XmlNode;
    const items = obj['ValueListItem'];
    if (Array.isArray(items)) {
      for (const it of items as XmlNode[]) out.push([text(it['Name']), Number(text(it['Value']))]);
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k !== 'ValueListItem' && v && typeof v === 'object') walk(v);
    }
  };
  walk(node);
  return out;
}

function findDriveParameters(node: unknown): XmlNode[] {
  if (!node || typeof node !== 'object') return [];
  const obj = node as XmlNode;
  if (Array.isArray(obj['DriveParameter'])) return obj['DriveParameter'] as XmlNode[];
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const r = findDriveParameters(v);
      if (r.length) return r;
    }
  }
  return [];
}

export interface DcparamsDocument {
  dialect: 'drive-composer' | 'drivetune';
  properties: Record<string, string>;
  application?: string;
  creationTime?: string;
  groups: Record<string, string>;
  params: Record<string, ParamRecord>;
}

/** Decode the XML text of a parameters.dcparams file. */
export function parseDcparamsXml(xml: string): DcparamsDocument {
  const doc = parser.parse(xml.replace(/^\uFEFF/, '')) as XmlNode;
  const root = (doc['ParameterFileContent'] ?? doc) as XmlNode;
  const propsNode = (root['DriveProperties'] ?? {}) as XmlNode;
  const properties: Record<string, string> = {};
  for (const [k, v] of Object.entries(propsNode)) properties[k] = text(v);

  const application = text(root['Application']) || undefined;
  const creationTime = text(root['CreationTime']) || undefined;
  const dialect: DcparamsDocument['dialect'] = application ? 'drivetune' : 'drive-composer';

  const groups: Record<string, string> = {};
  const gl = (root['GroupList'] as XmlNode | undefined)?.['GroupData'];
  if (Array.isArray(gl)) {
    for (const g of gl as XmlNode[]) groups[String(Number(text(g['Index']))).padStart(2, '0')] = text(g['Name']);
  }

  const params: Record<string, ParamRecord> = {};
  for (const dp of findDriveParameters(root)) {
    const group = Number(text(dp['Group']));
    const index = Number(text(dp['Index']));
    if (!Number.isFinite(group) || !Number.isFinite(index)) continue;
    const id = pid(group, index);
    const type = text(dp['Type']) || 'Decimal';
    const decimals = Number(text(dp['DisplayDecimals']) || 0);
    const items = listItems(dp['ValueNames']);
    const plItems = items.length ? items : listItems(dp['ParameterList']);
    const dict = dictParam(id);

    let enumMap: Record<string, string> | undefined;
    if (plItems.length) {
      enumMap = {};
      for (const [label, code] of plItems) if (label && label !== '.') enumMap[String(code)] = label;
    } else if (dict?.enumMap && dict.enumSource === 'backup-schema') {
      // Some dialects omit option lists for fieldbus adapter parameters.
      enumMap = dict.enumMap;
    }

    const valueNum = num(dp['Value']);
    const rawNum = num(dp['RawValue']);
    const isDecimal = type === 'Decimal';
    const engValue = isDecimal ? (Number.isFinite(valueNum) ? valueNum : rawNum) : rawNum;
    const display = formatByType(type, engValue, rawNum, decimals, enumMap);

    const unitText = text(dp['Unit']);
    const unit = unitText === 'NoUnit' ? '' : unitText || dict?.unit || '';

    // Factory default: Drive Composer files carry real defaults; Drivetune does not.
    let defaultDisplay: string | undefined;
    let defaultRaw: number | null = null;
    if (dialect === 'drive-composer') {
      const dv = num(dp['DefaultValue']);
      const drv = num(dp['RawDefaultValue']);
      const dEng = isDecimal ? (Number.isFinite(dv) ? dv : drv) : drv;
      if (Number.isFinite(dEng)) {
        defaultRaw = isDecimal ? dEng : drv;
        defaultDisplay = formatByType(type, dEng, drv, decimals, enumMap);
      }
    } else if (dict?.default !== undefined) {
      defaultDisplay = dict.default;
      const code = labelToCode(dict.default, enumMap);
      defaultRaw = code ?? (Number.isFinite(Number(dict.default)) ? Number(dict.default) : null);
    }

    const minText = text(dp['Min']);
    const maxText = text(dp['Max']);
    params[id] = {
      id,
      group,
      index,
      name: text(dp['Name']) || dict?.name || '',
      groupName: groups[String(group).padStart(2, '0')] ?? dictGroupName(group),
      type,
      display,
      raw: isDecimal ? engValue : rawNum,
      unit,
      min: dict?.min ?? (minText && isDecimal ? formatByType(type, Number(minText), Number(minText), decimals) : undefined),
      max: dict?.max ?? (maxText && isDecimal ? formatByType(type, Number(maxText), Number(maxText), decimals) : undefined),
      defaultDisplay,
      defaultRaw,
      decimals,
      enumMap,
      signal: text(dp['IsSignal']) === 'true' || undefined,
    };
  }

  // Drive rating id is a plain number in the file; show the model text.
  const rating = params['07.03'];
  if (rating && rating.raw !== null && rating.raw !== undefined) {
    const label = driveRatingLabel(rating.raw);
    if (label) rating.display = label;
  }

  return { dialect, properties, application, creationTime, groups, params };
}
