/**
 * IndexedDB persistence (profiles, fleet log, dictionary overlay) using `idb`.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FleetEntry, GoldenProfile } from './types';
import type { DictionaryData } from './dictionary';

interface AuditorDB extends DBSchema {
  profiles: { key: string; value: GoldenProfile };
  fleet: { key: string; value: FleetEntry };
  settings: { key: string; value: unknown };
}

const DB_NAME = 'abb580-field-auditor';
let dbPromise: Promise<IDBPDatabase<AuditorDB>> | null = null;

function db(): Promise<IDBPDatabase<AuditorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AuditorDB>(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('profiles')) d.createObjectStore('profiles', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('fleet')) d.createObjectStore('fleet', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings');
      },
    });
  }
  return dbPromise;
}

export async function listProfiles(): Promise<GoldenProfile[]> {
  const all = await (await db()).getAll('profiles');
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveProfile(p: GoldenProfile): Promise<void> {
  await (await db()).put('profiles', p);
}

export async function deleteProfile(id: string): Promise<void> {
  await (await db()).delete('profiles', id);
}

export async function listFleet(): Promise<FleetEntry[]> {
  const all = await (await db()).getAll('fleet');
  return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function addFleetEntry(e: FleetEntry): Promise<void> {
  await (await db()).put('fleet', e);
}

export async function deleteFleetEntry(id: string): Promise<void> {
  await (await db()).delete('fleet', id);
}

export async function clearFleet(): Promise<void> {
  await (await db()).clear('fleet');
}

export async function loadDictionaryOverlay(): Promise<DictionaryData | undefined> {
  return (await (await db()).get('settings', 'dictOverlay')) as DictionaryData | undefined;
}

export async function saveDictionaryOverlay(d: DictionaryData): Promise<void> {
  await (await db()).put('settings', d, 'dictOverlay');
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('settings', key)) as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put('settings', value, key);
}

// ---------------------------------------------------------------------------
// Library export / import (.json)
// ---------------------------------------------------------------------------

export interface LibraryFile {
  format: 'abb580-golden-library';
  version: 1;
  exportedAt: string;
  profiles: GoldenProfile[];
}

export function buildLibraryFile(profiles: GoldenProfile[]): LibraryFile {
  return { format: 'abb580-golden-library', version: 1, exportedAt: new Date().toISOString(), profiles };
}

export function parseLibraryFile(text: string): GoldenProfile[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  const lib = data as Partial<LibraryFile>;
  if (lib.format !== 'abb580-golden-library' || !Array.isArray(lib.profiles)) {
    throw new Error('The selected file is not an ABB 580 Field Auditor library export.');
  }
  for (const p of lib.profiles) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.unit || typeof p.unit.params !== 'object') {
      throw new Error('The library file contains an invalid profile entry.');
    }
    p.ignoredParams = Array.isArray(p.ignoredParams) ? p.ignoredParams : [];
  }
  return lib.profiles as GoldenProfile[];
}
