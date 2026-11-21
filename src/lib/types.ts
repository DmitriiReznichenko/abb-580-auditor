/**
 * Core data model shared by the parsers, the audit engine and the UI.
 */

/** Data type names used by Drive Composer / Drivetune parameter files. */
export type AbbParamType =
  | 'Decimal'
  | 'TextList'
  | 'BitPointer'
  | 'ParameterPointer'
  | 'ParameterIndexAndDataType'
  | 'Binary'
  | 'Hex'
  | 'Hex8Mask'
  | 'Date'
  | 'ShortDate'
  | 'TimeOfDay'
  | 'Duration'
  | 'Version'
  | 'StringAscii5'
  | 'PasscodeMask'
  | string;

export type SourceFormat = 'dcparamsbak' | 'pdf';

/** One decoded drive parameter. */
export interface ParamRecord {
  /** Canonical id, e.g. "07.03", "30.17", "10.101". */
  id: string;
  group: number;
  index: number;
  name: string;
  groupName?: string;
  /** Data type when known (always known for backups, inferred for PDFs). */
  type?: AbbParamType;
  /** Human readable value exactly as Drive Composer would display it. */
  display: string;
  /** Raw numeric code / value when known (enum code, integer, float). */
  raw?: number | null;
  unit?: string;
  min?: string;
  max?: string;
  /** Factory default as display text. */
  defaultDisplay?: string;
  defaultRaw?: number | null;
  decimals?: number;
  /** Enum list (code -> label) when the parameter is a selection list. */
  enumMap?: Record<string, string>;
  /** True for read-only signals / actual values. */
  signal?: boolean;
}

export interface BinTocEntry {
  name: string;
  offset: number;
  size: number;
  id: number;
  kind: number;
}

/** Metadata extracted from the panel backup blob (*.bin) inside a .dcparamsbak. */
export interface BinMetadata {
  fileName: string;
  version: number;
  entries: BinTocEntry[];
  serialNumber?: string;
  /** Drive name text stored by the control panel (e.g. "AREA-1 UNIT-07"). */
  driveName?: string;
  firmwareName?: string;
  favorites?: string[];
}

/** A fully decoded unit backup (from .dcparamsbak or Drive Composer PDF). */
export interface ParsedUnit {
  source: SourceFormat;
  fileName: string;
  /** Best effort unit name (file metadata, panel drive name, or file name). */
  unitName: string;
  serialNumber?: string;
  driveModel?: string;
  firmware?: string;
  creationTime?: string;
  application?: string;
  params: Record<string, ParamRecord>;
  binMeta?: BinMetadata;
  /** Free-form notes produced while decoding (English). */
  warnings: string[];
}

export type EquipmentCategory = 'Dry Cooler' | 'Pump' | 'Fan / AHU' | 'Other';

export const EQUIPMENT_CATEGORIES: EquipmentCategory[] = ['Dry Cooler', 'Pump', 'Fan / AHU', 'Other'];

export interface GoldenProfile {
  id: string;
  name: string;
  category: EquipmentCategory;
  sourceFormat: SourceFormat;
  sourceFileName: string;
  createdAt: string;
  /** Auto-metadata for matching. */
  meta: {
    driveRating?: string;
    driveRatingRaw?: number | null;
    firmware?: string;
    motorPower?: string;
    motorCurrent?: string;
    controlMode?: string;
  };
  /** Parameter ids ignored for this profile (e.g. "28.52", "40.21"). */
  ignoredParams: string[];
  unit: ParsedUnit;
}

export interface FleetEntry {
  id: string;
  unitName: string;
  timestamp: string;
  profileName: string;
  category?: EquipmentCategory;
  verdict: 'PASS' | 'FAIL' | 'NO PROFILE';
  mismatchCount: number;
  ipAddress: string;
  bacnetId: number | null;
  phaseOrder: string;
  maxCurrent: string;
  motorCurrent: string;
}
