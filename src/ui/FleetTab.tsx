/**
 * "Fleet Log" tab: every audit is logged automatically. Duplicate IP / BACnet
 * Device IDs across different units are flagged. CSV / PDF export.
 */
import { useMemo } from 'react';
import { fleetConflictMap } from '../lib/fleet';
import { buildFleetCsv, buildFleetPdf } from '../lib/reports';
import { useStore } from './store';
import { APP_VERSION, downloadBlob } from './platform';
import { Banner, Card, EmptyState, Icon, VerdictBadge } from './components';

export function FleetTab({ toast }: { toast: (m: string, t?: 'ok' | 'err') => void }) {
  const { fleet, removeFleetEntry, clearFleetLog } = useStore();
  const conflicts = useMemo(() => fleetConflictMap(fleet), [fleet]);
  const conflictIds = useMemo(() => new Set(conflicts.keys()), [conflicts]);
  const pass = fleet.filter((f) => f.verdict === 'PASS').length;
  const fail = fleet.filter((f) => f.verdict === 'FAIL').length;
  const day = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Logged" value={fleet.length} />
        <Stat label="PASS" value={pass} tone="pass" />
        <Stat label="FAIL" value={fail} tone="fail" />
      </div>

      {conflicts.size > 0 && (
        <Banner tone="danger" title="NETWORK CONFLICTS IN FLEET LOG">
          {conflicts.size} logged entr{conflicts.size === 1 ? 'y shares' : 'ies share'} an IP address or BACnet Device ID with a different unit.
        </Banner>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!fleet.length}
          onClick={() => downloadBlob(buildFleetCsv(fleet, conflictIds), `Fleet_Summary_${day}.csv`, 'text/csv')}
        >
          <Icon name="download" /> Fleet Summary CSV
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!fleet.length}
          onClick={() => downloadBlob(buildFleetPdf(fleet, { appVersion: APP_VERSION }, conflictIds), `Fleet_Summary_${day}.pdf`, 'application/pdf')}
        >
          <Icon name="file" /> Fleet Summary PDF
        </button>
      </div>

      {!fleet.length && (
        <EmptyState icon="fleet" title="Fleet log is empty">
          Every unit audited in the Audit tab is logged here automatically.
        </EmptyState>
      )}

      <ul className="space-y-2">
        {fleet.map((e) => {
          const c = conflicts.get(e.id);
          return (
            <li key={e.id} className="card card-pad fade-in">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[19px] font-black">{e.unitName}</div>
                  <div className="text-[13px] text-ink-2">{new Date(e.timestamp).toLocaleString()}</div>
                  <div className="text-[14px] font-semibold">
                    {e.profileName}
                    {e.category ? ` · ${e.category}` : ''}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <VerdictBadge verdict={e.verdict} />
                  {e.verdict !== 'NO PROFILE' && <span className="text-[13px] font-semibold text-ink-2">{e.mismatchCount} mismatch{e.mismatchCount === 1 ? '' : 'es'}</span>}
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[14px]">
                <Field label="IP address" value={e.ipAddress} />
                <Field label="BACnet ID" value={e.bacnetId === null ? '-' : String(e.bacnetId)} />
                <Field label="Phase order (99.16)" value={e.phaseOrder} />
                <Field label="Max current (30.17)" value={e.maxCurrent} />
                <Field label="Motor current (99.06)" value={e.motorCurrent} />
              </dl>
              {c && (
                <div className="mt-2 rounded-lg bg-fail-bg p-2 text-[14px] font-semibold text-fail">
                  {c.map((x, i) => (
                    <div key={i}>
                      Duplicate {x.kind === 'ip' ? 'IP' : 'BACnet ID'} {x.value} with unit {x.otherUnit}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="btn btn-danger min-h-[48px] px-3 text-[15px]"
                  onClick={async () => {
                    if (window.confirm(`Delete log entry for ${e.unitName}?`)) {
                      await removeFleetEntry(e.id);
                      toast('Entry deleted');
                    }
                  }}
                >
                  <Icon name="trash" className="h-5 w-5" /> Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {fleet.length > 0 && (
        <Card title="Danger zone">
          <button
            type="button"
            className="btn btn-danger w-full"
            onClick={async () => {
              if (window.confirm('Delete ALL fleet log entries? This cannot be undone.')) {
                await clearFleetLog();
                toast('Fleet log cleared');
              }
            }}
          >
            <Icon name="trash" /> Clear entire fleet log
          </button>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'pass' | 'fail' }) {
  return (
    <div className="card px-3 py-3 text-center">
      <div className={`text-[28px] font-black leading-none ${tone === 'pass' ? 'text-pass' : tone === 'fail' ? 'text-fail' : ''}`}>{value}</div>
      <div className="mt-1 text-[12px] font-bold uppercase tracking-wider text-ink-2">{label}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-2">{label}</dt>
      <dd className="mono truncate font-semibold">{value || '-'}</dd>
    </div>
  );
}

