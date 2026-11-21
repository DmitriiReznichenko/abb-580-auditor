/**
 * "Parameters" tab: standalone viewer for any backup / PDF with instant
 * search and filters (All | Modified vs Factory | Diff vs Golden).
 */
import { useDeferredValue, useMemo, useState } from 'react';
import type { ParamRecord } from '../lib/types';
import { auditUnit, isModifiedFromDefault } from '../lib/audit';
import { valuesEqual } from '../lib/compare';
import { dictParam, groupName } from '../lib/dictionary';
import { compareIds, normText } from '../lib/format';
import { INVALID_FILE_MESSAGE } from '../lib/loader';
import { useStore } from './store';
import { parseUserFile } from './platform';
import { Banner, Card, Chip, EmptyState, FileButton, Icon, cx, isNumericLike } from './components';
import { exportAuditPdf, exportFullPdf, exportParamsCsv, sharePdf } from './exports';

type Filter = 'all' | 'modified' | 'golden';

const ROW_LIMIT = 400;

export function ParametersTab({ toast }: { toast: (m: string, t?: 'ok' | 'err') => void }) {
  const { viewerUnit, setViewerUnit, session, profiles, sessionProfile, dictVersion } = useStore();
  const unit = viewerUnit ?? session?.unit ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [goldenId, setGoldenId] = useState<string>('');
  const [showAll, setShowAll] = useState(false);
  const q = useDeferredValue(query);

  const golden = profiles.find((p) => p.id === (goldenId || sessionProfile?.id || '')) ?? null;

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const u = await parseUserFile(file);
      setViewerUnit(u);
      setShowAll(false);
      toast(`Loaded ${u.unitName} (${Object.keys(u.params).length} parameters)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (msg === INVALID_FILE_MESSAGE) window.alert(msg);
    } finally {
      setBusy(false);
    }
  }

  const all = useMemo(() => (unit ? Object.values(unit.params).sort((a, b) => compareIds(a.id, b.id)) : []), [unit]);

  const modifiedSet = useMemo(() => new Set(all.filter(isModifiedFromDefault).map((p) => p.id)), [all, dictVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const goldenDiff = useMemo(() => {
    const m = new Map<string, string>();
    if (!unit || !golden) return m;
    for (const p of all) {
      const g = golden.unit.params[p.id];
      if (!g) m.set(p.id, '(not present)');
      else if (!valuesEqual(g, p)) m.set(p.id, g.display);
    }
    return m;
  }, [all, unit, golden]);

  const filtered = useMemo(() => {
    const words = normText(q).split(' ').filter(Boolean);
    return all.filter((p) => {
      if (filter === 'modified' && !modifiedSet.has(p.id)) return false;
      if (filter === 'golden' && !goldenDiff.has(p.id)) return false;
      if (!words.length) return true;
      const hay = normText(`${p.id} ${p.id.replace(/^0/, '')} ${p.name} ${p.display} ${p.unit ?? ''} ${p.groupName ?? groupName(p.group) ?? ''}`);
      return words.every((w) => hay.includes(w));
    });
  }, [all, q, filter, modifiedSet, goldenDiff]);

  const shown = showAll ? filtered : filtered.slice(0, ROW_LIMIT);

  return (
    <div className="space-y-4">
      <Card>
        <FileButton label="Open Backup (.dcparamsbak / .pdf)" onFile={onFile} busy={busy} className="btn btn-primary w-full text-[16px] leading-tight" />
        {unit && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[18px] font-black">{unit.unitName}</div>
              <div className="text-[13px] text-ink-2">
                {viewerUnit ? 'Opened in viewer' : 'From Audit tab'} · {unit.source === 'pdf' ? 'Drive Composer PDF' : 'Backup'} · {all.length} params ·{' '}
                {modifiedSet.size} modified vs factory
              </div>
            </div>
            {viewerUnit && session && (
              <button type="button" className="btn btn-ghost min-h-[48px] px-3 text-[14px] underline" onClick={() => setViewerUnit(null)}>
                Show audit unit
              </button>
            )}
          </div>
        )}
      </Card>

      {error && (
        <Banner tone="danger" title="Could not load file" onClose={() => setError(null)}>
          {error}
        </Banner>
      )}

      {!unit && !error && (
        <EmptyState icon="params" title="No parameters to show">
          Open any .dcparamsbak backup or Drive Composer PDF. No Golden Profile is required.
        </EmptyState>
      )}

      {unit && (
        <>
          <div className="sticky top-[64px] z-20 -mx-4 space-y-2 bg-paper/95 px-4 pb-2 pt-1 backdrop-blur">
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-2" />
              <input
                type="search"
                className="field pl-11 text-[17px]"
                placeholder="Search: 30.17, PID, dry run, BACnet..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search parameters"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {(
                [
                  ['all', `All (${all.length})`],
                  ['modified', `Modified vs Factory (${modifiedSet.size})`],
                  ['golden', `Diff vs Golden${golden ? ` (${goldenDiff.size})` : ''}`],
                ] as Array<[Filter, string]>
              ).map(([k, label]) => (
                <button key={k} type="button" className={cx('pill', filter === k ? 'pill-on' : 'pill-off')} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
            {filter === 'golden' && (
              <select className="field" value={golden?.id ?? ''} onChange={(e) => setGoldenId(e.target.value)} aria-label="Golden Profile">
                <option value="">Select Golden Profile...</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} - {p.category}
                  </option>
                ))}
              </select>
            )}
          </div>

          {filter === 'golden' && !golden && <Banner tone="info">Select a Golden Profile to list differences.</Banner>}

          <div className="text-[13px] font-semibold text-ink-2">
            {filtered.length} of {all.length} parameters
          </div>

          <ul className="space-y-1.5">
            {shown.map((p, i) => {
              const prev = shown[i - 1];
              const newGroup = !prev || prev.group !== p.group;
              return (
                <li key={p.id}>
                  {newGroup && (
                    <div className="mb-1.5 mt-3 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-bold uppercase tracking-wider text-white">
                      {String(p.group).padStart(2, '0')} {p.groupName ?? groupName(p.group) ?? ''}
                    </div>
                  )}
                  <ParamRow p={p} modified={modifiedSet.has(p.id)} goldenValue={goldenDiff.get(p.id)} />
                </li>
              );
            })}
          </ul>
          {filtered.length > shown.length && (
            <button type="button" className="btn btn-secondary w-full" onClick={() => setShowAll(true)}>
              Show all {filtered.length} parameters
            </button>
          )}

          <Card title="Export">
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const prof = golden ?? null;
                  exportAuditPdf(unit, auditUnit(unit, prof));
                }}
              >
                <Icon name="download" /> Export Audit Report PDF
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => exportFullPdf(unit)}>
                <Icon name="file" /> Export Full Parameters PDF
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  const shared = await sharePdf(unit, auditUnit(unit, golden));
                  if (!shared) toast('Share not available - PDF downloaded instead');
                }}
              >
                <Icon name="share" /> Share PDF
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => exportParamsCsv(unit)}>
                <Icon name="download" /> Export Parameters CSV
              </button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function ParamRow({ p, modified, goldenValue }: { p: ParamRecord; modified: boolean; goldenValue?: string }) {
  const def = dictParam(p.id)?.default ?? p.defaultDisplay;
  return (
    <div className={cx('rounded-xl border bg-surface px-3 py-2.5', goldenValue !== undefined ? 'border-fail border-2' : 'border-line')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="mono mr-2 font-black">{p.id}</span>
          <span className="font-semibold">{p.name}</span>
        </div>
        <div className={cx('shrink-0 text-right font-bold', isNumericLike(p.display) && 'mono')}>
          {p.display === '' ? '(empty)' : p.display}
          {p.unit && <span className="ml-1 text-[13px] font-normal text-ink-2">{p.unit}</span>}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">
        {def !== undefined && def !== '' && (
          <span>
            Default: <span className={cx(isNumericLike(def) && 'mono')}>{def}</span>
          </span>
        )}
        {p.min && p.max && (
          <span>
            Range: <span className="mono">{p.min} … {p.max}</span>
          </span>
        )}
        {modified && <Chip tone="info">Modified</Chip>}
        {goldenValue !== undefined && <Chip tone="fail">Golden: {goldenValue}</Chip>}
      </div>
    </div>
  );
}
