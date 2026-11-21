/**
 * Application state: Golden Profiles, Fleet Log, current audit session and
 * the standalone parameter viewer unit. Persisted data lives in IndexedDB.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FleetEntry, GoldenProfile, ParsedUnit } from '../lib/types';
import { auditUnit, autoMatchProfile, type AuditResult } from '../lib/audit';
import { findNetworkConflicts, makeFleetEntry, type NetworkConflict } from '../lib/fleet';
import * as db from '../lib/db';
import { setDictionaryOverlay } from '../lib/dictionary';

export interface AuditSession {
  unit: ParsedUnit;
  profileId: string | null;
  autoMatched: boolean;
  entryId: string;
  entryTimestamp: string;
  conflicts: NetworkConflict[];
}

interface Store {
  ready: boolean;
  profiles: GoldenProfile[];
  fleet: FleetEntry[];
  session: AuditSession | null;
  sessionProfile: GoldenProfile | null;
  sessionResult: AuditResult | null;
  viewerUnit: ParsedUnit | null;
  setViewerUnit: (u: ParsedUnit | null) => void;
  startAudit: (unit: ParsedUnit) => Promise<void>;
  switchProfile: (profileId: string | null) => Promise<void>;
  clearSession: () => void;
  upsertProfile: (p: GoldenProfile) => Promise<void>;
  removeProfile: (id: string) => Promise<void>;
  importProfiles: (list: GoldenProfile[]) => Promise<number>;
  removeFleetEntry: (id: string) => Promise<void>;
  clearFleetLog: () => Promise<void>;
  dictVersion: number;
  bumpDict: () => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('Store not available');
  return s;
}

const LAST_PROFILE_KEY = 'lastProfileId';

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profiles, setProfiles] = useState<GoldenProfile[]>([]);
  const [fleet, setFleet] = useState<FleetEntry[]>([]);
  const [session, setSession] = useState<AuditSession | null>(null);
  const [viewerUnit, setViewerUnit] = useState<ParsedUnit | null>(null);
  const [dictVersion, setDictVersion] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [p, f, overlay] = await Promise.all([db.listProfiles(), db.listFleet(), db.loadDictionaryOverlay()]);
        setProfiles(p);
        setFleet(f);
        if (overlay) {
          setDictionaryOverlay(overlay);
          setDictVersion((v) => v + 1);
        }
      } catch (e) {
        console.error('IndexedDB unavailable', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const sessionProfile = useMemo(
    () => (session?.profileId ? profiles.find((p) => p.id === session.profileId) ?? null : null),
    [session, profiles],
  );

  const sessionResult = useMemo(
    () => (session ? auditUnit(session.unit, sessionProfile) : null),
    // dictVersion: re-run when the dictionary overlay changes labels/defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, sessionProfile, dictVersion],
  );

  /** Write (or update) the fleet log entry of a session and detect network conflicts. */
  const logSession = useCallback(
    async (s: AuditSession, profile: GoldenProfile | null, currentFleet: FleetEntry[]): Promise<AuditSession> => {
      const result = auditUnit(s.unit, profile);
      const entry: FleetEntry = { ...makeFleetEntry(s.unit, result), id: s.entryId, timestamp: s.entryTimestamp };
      const others = currentFleet.filter((e) => e.id !== s.entryId);
      const conflicts = findNetworkConflicts(entry, others);
      await db.addFleetEntry(entry).catch((e) => console.error(e));
      setFleet([entry, ...others].sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
      return { ...s, conflicts };
    },
    [],
  );

  const startAudit = useCallback(
    async (unit: ParsedUnit) => {
      const matched = autoMatchProfile(unit, profiles);
      let profile: GoldenProfile | null = matched ?? null;
      if (!profile && profiles.length) {
        const last = await db.getSetting<string>(LAST_PROFILE_KEY).catch(() => undefined);
        profile = profiles.find((p) => p.id === last) ?? profiles[0];
      }
      const now = new Date();
      const base: AuditSession = {
        unit,
        profileId: profile?.id ?? null,
        autoMatched: !!matched,
        entryId: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        entryTimestamp: now.toISOString(),
        conflicts: [],
      };
      setSession(await logSession(base, profile, fleet));
    },
    [profiles, fleet, logSession],
  );

  const switchProfile = useCallback(
    async (profileId: string | null) => {
      if (!session) return;
      const profile = profileId ? profiles.find((p) => p.id === profileId) ?? null : null;
      if (profileId) await db.setSetting(LAST_PROFILE_KEY, profileId).catch(() => undefined);
      const next = { ...session, profileId, autoMatched: false };
      setSession(await logSession(next, profile, fleet));
    },
    [session, profiles, fleet, logSession],
  );

  const upsertProfile = useCallback(async (p: GoldenProfile) => {
    await db.saveProfile(p);
    setProfiles(await db.listProfiles());
  }, []);

  const removeProfile = useCallback(async (id: string) => {
    await db.deleteProfile(id);
    setProfiles(await db.listProfiles());
    setSession((s) => (s && s.profileId === id ? { ...s, profileId: null } : s));
  }, []);

  const importProfiles = useCallback(async (list: GoldenProfile[]) => {
    for (const p of list) await db.saveProfile(p);
    setProfiles(await db.listProfiles());
    return list.length;
  }, []);

  const removeFleetEntry = useCallback(async (id: string) => {
    await db.deleteFleetEntry(id);
    setFleet(await db.listFleet());
  }, []);

  const clearFleetLog = useCallback(async () => {
    await db.clearFleet();
    setFleet([]);
  }, []);

  const value: Store = {
    ready,
    profiles,
    fleet,
    session,
    sessionProfile,
    sessionResult,
    viewerUnit,
    setViewerUnit,
    startAudit,
    switchProfile,
    clearSession: () => setSession(null),
    upsertProfile,
    removeProfile,
    importProfiles,
    removeFleetEntry,
    clearFleetLog,
    dictVersion,
    bumpDict: () => setDictVersion((v) => v + 1),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
