/**
 * "Profiles" tab: Golden Profiles library (IndexedDB), library export/import,
 * runtime dictionary extension and app maintenance.
 */
import { useState } from 'react';
import { EQUIPMENT_CATEGORIES, type EquipmentCategory, type GoldenProfile, type ParsedUnit } from '../lib/types';
import { profileMeta } from '../lib/audit';
import { parseIdList } from '../lib/format';
import { INVALID_FILE_MESSAGE } from '../lib/loader';
import { buildLibraryFile, parseLibraryFile, saveDictionaryOverlay } from '../lib/db';
import { eventCount, getBaseDictionary, getDictionaryOverlay, mergeUnitIntoOverlay, setDictionaryOverlay, type DictionaryData } from '../lib/dictionary';
import { useStore } from './store';
import { APP_VERSION, BUILD_TIME, downloadBlob, hardRefreshApp, parseUserFile } from './platform';
import { Banner, Card, Chip, EmptyState, FileButton, Icon, cx } from './components';

const IGNORE_HINT = 'e.g. 28.51-28.57, 40.21, 41.*';

function newId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function guessCategory(unit: ParsedUnit): EquipmentCategory {
  const n = `${unit.unitName} ${unit.fileName} ${unit.binMeta?.driveName ?? ''}`.toLowerCase();
  if (/\bdc|dry ?cool/.test(n)) return 'Dry Cooler';
  if (/pump|chw|hw[ps]|\bp-?\d/.test(n)) return 'Pump';
  if (/ahu|fan|ef-?\d|sf-?\d|rf-?\d/.test(n)) return 'Fan / AHU';
  return 'Other';
}

export function ProfilesTab({ toast }: { toast: (m: string, t?: 'ok' | 'err') => void }) {
  const { profiles, upsertProfile, removeProfile, importProfiles, bumpDict, dictVersion } = useStore();
  const [draftUnit, setDraftUnit] = useState<ParsedUnit | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<EquipmentCategory>('Dry Cooler');
  const [ignored, setIgnored] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  async function onGoldenFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const u = await parseUserFile(file);
      setDraftUnit(u);
      if (!name) setName(u.unitName);
      setCategory(guessCategory(u));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (msg === INVALID_FILE_MESSAGE) window.alert(msg);
    } finally {
      setBusy(false);
    }
  }

  const ignoredParsed = parseIdList(ignored);

  async function save() {
    if (!draftUnit) return;
    const p: GoldenProfile = {
      id: newId(),
      name: name.trim() || draftUnit.unitName,
      category,
      sourceFormat: draftUnit.source,
      sourceFileName: draftUnit.fileName,
      createdAt: new Date().toISOString(),
      meta: profileMeta(draftUnit),
      ignoredParams: ignoredParsed.tokens,
      unit: draftUnit,
    };
    await upsertProfile(p);
    toast(`Golden Profile "${p.name}" saved`);
    setDraftUnit(null);
    setName('');
    setIgnored('');
  }

  async function onImport(file: File) {
    try {
      const list = parseLibraryFile(await file.text());
      const n = await importProfiles(list);
      toast(`Imported ${n} profile${n === 1 ? '' : 's'}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    }
  }

  async function onDictFile(file: File) {
    try {
      const u = await parseUserFile(file);
      const overlay: DictionaryData = JSON.parse(JSON.stringify(getDictionaryOverlay()));
      const added = mergeUnitIntoOverlay(u, overlay);
      setDictionaryOverlay(overlay);
      await saveDictionaryOverlay(overlay);
      bumpDict();
      toast(`Dictionary updated: ${added} new parameter${added === 1 ? '' : 's'} from ${u.fileName}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    }
  }

  const base = getBaseDictionary();
  const overlay = getDictionaryOverlay();
  void dictVersion;

  return (
    <div className="space-y-4">
      <Card title="New Golden Profile">
        <FileButton label="Select Golden Source (.dcparamsbak / .pdf)" onFile={onGoldenFile} busy={busy} className="btn btn-primary w-full" />
        {error && (
          <div className="mt-3">
            <Banner tone="danger" title="Could not load file" onClose={() => setError(null)}>
              {error}
            </Banner>
          </div>
        )}
        {draftUnit && (
          <div className="fade-in mt-4 space-y-3">
            <MetaGrid meta={profileMeta(draftUnit)} source={`${draftUnit.fileName} (${draftUnit.source === 'pdf' ? 'PDF' : 'backup'})`} />
            <label className="block">
              <span className="section-title">Profile name</span>
              <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CB4 Dry Coolers 180HP" />
            </label>
            <label className="block">
              <span className="section-title">Equipment category</span>
              <select className="field mt-1" value={category} onChange={(e) => setCategory(e.target.value as EquipmentCategory)}>
                {EQUIPMENT_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="section-title">Ignored parameters (unit-specific)</span>
              <textarea className="field mt-1 min-h-[88px] py-2" value={ignored} onChange={(e) => setIgnored(e.target.value)} placeholder={IGNORE_HINT} />
              {ignoredParsed.invalid.length > 0 && <span className="text-[13px] font-semibold text-fail">Not understood: {ignoredParsed.invalid.join(', ')}</span>}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setDraftUnit(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-brand" onClick={() => void save()}>
                <Icon name="check" /> Save Profile
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card title={`Golden Profiles Library (${profiles.length})`}>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn btn-secondary text-[15px]"
            disabled={!profiles.length}
            onClick={() =>
              downloadBlob(JSON.stringify(buildLibraryFile(profiles), null, 1), `ABB580_Golden_Library_${new Date().toISOString().slice(0, 10)}.json`, 'application/json')
            }
          >
            <Icon name="download" className="h-5 w-5" /> Export Library (.json)
          </button>
          <FileButton label="Import Library (.json)" onFile={onImport} className="btn btn-secondary w-full text-[15px]" />
        </div>
        <div className="mt-3 space-y-2">
          {!profiles.length && (
            <EmptyState icon="profiles" title="No Golden Profiles yet">
              Create one per equipment type, e.g. "CB4 Dry Coolers 180HP", "CHW Primary Pumps", "AHU Supply Fans".
            </EmptyState>
          )}
          {profiles.map((p) =>
            editing === p.id ? (
              <ProfileEditor
                key={p.id}
                profile={p}
                onCancel={() => setEditing(null)}
                onSave={async (np) => {
                  await upsertProfile(np);
                  setEditing(null);
                  toast('Profile updated');
                }}
              />
            ) : (
              <div key={p.id} className="rounded-xl border-2 border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[18px] font-black leading-tight">{p.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Chip tone="info">{p.category}</Chip>
                      <Chip>{p.sourceFormat === 'pdf' ? 'PDF' : '.dcparamsbak'}</Chip>
                      <Chip>{Object.keys(p.unit.params).length} params</Chip>
                    </div>
                  </div>
                </div>
                <div className="mt-2">
                  <MetaGrid meta={p.meta} source={p.sourceFileName} />
                </div>
                <div className="mt-2 text-[13px] text-ink-2">
                  Ignored: {p.ignoredParams.length ? <span className="mono text-ink">{p.ignoredParams.join(', ')}</span> : 'none'}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" className="btn btn-secondary min-h-[48px] text-[15px]" onClick={() => setEditing(p.id)}>
                    <Icon name="edit" className="h-5 w-5" /> Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger min-h-[48px] text-[15px]"
                    onClick={async () => {
                      if (window.confirm(`Delete Golden Profile "${p.name}"?`)) {
                        await removeProfile(p.id);
                        toast('Profile deleted');
                      }
                    }}
                  >
                    <Icon name="trash" className="h-5 w-5" /> Delete
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      </Card>

      <Card title="Parameter Dictionary">
        <dl>
          <div className="kv">
            <dt>Bundled parameters (schema + defaults)</dt>
            <dd className="mono">{Object.keys(base.params).length}</dd>
          </div>
          <div className="kv">
            <dt>Added from your files</dt>
            <dd className="mono">{Object.keys(overlay.params).length}</dd>
          </div>
          <div className="kv">
            <dt>Fault / warning codes</dt>
            <dd className="mono">{eventCount()}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[13px] text-ink-2">
          Merge parameter metadata (names, units, ranges, defaults, option lists) from any Drive Composer PDF or backup, e.g. ACQ580 pumps or newer firmware. Only schema data is stored, never site values.
        </p>
        <div className="mt-3 grid gap-2">
          <FileButton label="Merge PDF / Backup into Dictionary" onFile={onDictFile} className="btn btn-secondary w-full" icon="book" />
          {Object.keys(overlay.params).length > 0 && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                if (!window.confirm('Remove all dictionary additions?')) return;
                const empty: DictionaryData = { meta: {}, groups: {}, driveRatings: {}, params: {} };
                setDictionaryOverlay(empty);
                await saveDictionaryOverlay(empty);
                bumpDict();
                toast('Dictionary additions removed');
              }}
            >
              Reset dictionary additions
            </button>
          )}
        </div>
      </Card>

      <Card title="About">
        <dl>
          <div className="kv">
            <dt>Version</dt>
            <dd className="mono">{APP_VERSION}</dd>
          </div>
          <div className="kv">
            <dt>Build time</dt>
            <dd className="mono text-[13px]">{BUILD_TIME}</dd>
          </div>
          <div className="kv">
            <dt>Status</dt>
            <dd>{navigator.onLine ? 'Online' : 'Offline (cached)'}</dd>
          </div>
        </dl>
        <button type="button" className="btn btn-secondary mt-3 w-full" onClick={() => void hardRefreshApp()}>
          <Icon name="refresh" /> Refresh App Cache
        </button>
      </Card>
    </div>
  );
}

function MetaGrid({ meta, source }: { meta: GoldenProfile['meta']; source: string }) {
  const rows: Array<[string, string | undefined]> = [
    ['Drive (07.03)', meta.driveRating],
    ['Firmware (07.04/05)', meta.firmware],
    ['Motor power (99.10)', meta.motorPower],
    ['Motor current (99.06)', meta.motorCurrent],
    ['Control mode (99.04)', meta.controlMode],
    ['Source', source],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-paper p-2 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-ink-2">{k}</dt>
          <dd className="truncate font-semibold">{v || '-'}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProfileEditor({ profile, onSave, onCancel }: { profile: GoldenProfile; onSave: (p: GoldenProfile) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(profile.name);
  const [category, setCategory] = useState<EquipmentCategory>(profile.category);
  const [ignored, setIgnored] = useState(profile.ignoredParams.join(', '));
  const parsed = parseIdList(ignored);
  return (
    <div className={cx('fade-in space-y-3 rounded-xl border-2 border-ink p-3')}>
      <label className="block">
        <span className="section-title">Profile name</span>
        <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block">
        <span className="section-title">Equipment category</span>
        <select className="field mt-1" value={category} onChange={(e) => setCategory(e.target.value as EquipmentCategory)}>
          {EQUIPMENT_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="section-title">Ignored parameters</span>
        <textarea className="field mt-1 min-h-[88px] py-2" value={ignored} onChange={(e) => setIgnored(e.target.value)} placeholder={IGNORE_HINT} />
        {parsed.invalid.length > 0 && <span className="text-[13px] font-semibold text-fail">Not understood: {parsed.invalid.join(', ')}</span>}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-brand"
          onClick={() => void onSave({ ...profile, name: name.trim() || profile.name, category, ignoredParams: parsed.tokens })}
        >
          Save
        </button>
      </div>
    </div>
  );
}
