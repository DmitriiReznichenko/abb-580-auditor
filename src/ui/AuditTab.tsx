/**
 * "Audit" tab: load a target unit, auto-match a Golden Profile, show safety
 * banners, the Identity Card, the PASS/FAIL mismatch table and filtered noise.
 */
import { useState } from 'react';
import { conflictBannerText } from '../lib/fleet';
import { INVALID_FILE_MESSAGE } from '../lib/loader';
import { driveSignature } from '../lib/audit';
import { useStore } from './store';
import { parseUserFile } from './platform';
import { Banner, Card, Chip, EmptyState, FileButton, Icon, Toggle, VerdictBadge, cx } from './components';
import { DiffTable, IdentityCardView } from './AuditViews';
import { exportAuditPdf, exportFullPdf, sharePdf } from './exports';

export function AuditTab({ toast, goProfiles }: { toast: (m: string, t?: 'ok' | 'err') => void; goProfiles: () => void }) {
  const { session, sessionProfile, sessionResult, profiles, startAudit, switchProfile } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNoise, setShowNoise] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const unit = await parseUserFile(file);
      await startAudit(unit);
      toast(`Loaded ${unit.unitName} (${Object.keys(unit.params).length} parameters)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (msg === INVALID_FILE_MESSAGE) window.alert(msg);
    } finally {
      setBusy(false);
    }
  }

  const unit = session?.unit;
  const result = sessionResult;
  const driveAlert = result?.alerts.find((a) => a.code === 'DRIVE_MISMATCH');
  const otherAlerts = result?.alerts.filter((a) => a.code !== 'DRIVE_MISMATCH') ?? [];
  const conflictText = session ? conflictBannerText(session.conflicts) : null;
  const matchingProfiles = unit
    ? profiles.filter((p) => p.id !== sessionProfile?.id && driveSignature(p.unit) === driveSignature(unit))
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <FileButton label="Load Unit Backup (.dcparamsbak / .pdf)" onFile={onFile} busy={busy} />
        <p className="mt-2 text-center text-[13px] text-ink-2">Files are decoded on this device only. Nothing is uploaded.</p>
      </Card>

      {error && (
        <Banner tone="danger" title="Could not load file" onClose={() => setError(null)}>
          {error}
        </Banner>
      )}

      {!unit && !error && (
        <EmptyState icon="audit" title="No unit loaded">
          Load a Drive Composer / Drivetune backup or a Drive Composer parameter PDF to audit it against a Golden Profile.
          {profiles.length === 0 && (
            <button type="button" className="btn btn-secondary mt-4 w-full" onClick={goProfiles}>
              <Icon name="profiles" /> Create a Golden Profile first
            </button>
          )}
        </EmptyState>
      )}

      {unit && result && (
        <>
          {/* Verdict hero */}
          <section className="card card-pad fade-in">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="section-title">Target unit</div>
                <div className="truncate text-[24px] font-black leading-tight">{unit.unitName}</div>
                <div className="text-[14px] text-ink-2">
                  {unit.source === 'pdf' ? 'Drive Composer PDF' : 'Backup (.dcparamsbak)'} · {Object.keys(unit.params).length} params
                </div>
              </div>
              <VerdictBadge verdict={result.verdict} large />
            </div>
            {result.verdict !== 'NO PROFILE' && (
              <div className={cx('mt-3 rounded-xl px-3 py-2 text-[15px] font-bold', result.verdict === 'PASS' ? 'bg-pass-bg text-pass' : 'bg-fail-bg text-fail')}>
                {result.mismatches.length === 0
                  ? 'All audited configuration parameters match the Golden Profile.'
                  : `${result.mismatches.length} configuration mismatch${result.mismatches.length === 1 ? '' : 'es'} vs Golden Profile.`}
              </div>
            )}
            <label className="mt-4 block">
              <span className="section-title">Golden Profile</span>
              <select
                className="field mt-1"
                value={session.profileId ?? ''}
                onChange={(e) => void switchProfile(e.target.value || null)}
              >
                <option value="">No profile (identity check only)</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} - {p.category}
                  </option>
                ))}
              </select>
            </label>
            {session.autoMatched && sessionProfile && (
              <div className="mt-2 flex items-center gap-2 text-[14px] font-semibold text-pass">
                <Icon name="check" className="h-5 w-5" /> Auto-matched by 07.03 drive rating and 99.10 motor power
              </div>
            )}
          </section>

          {conflictText && <Banner tone="danger" title="NETWORK CONFLICT">{conflictText}
            <ul className="mt-1 list-disc pl-5 text-[14px]">
              {session.conflicts.map((c, i) => (
                <li key={i}>
                  {c.kind === 'ip' ? 'IP address' : 'BACnet Device ID'} {c.value} - unit {c.otherUnit} ({new Date(c.otherTimestamp).toLocaleString()})
                </li>
              ))}
            </ul>
          </Banner>}

          {driveAlert && (
            <Banner
              tone="danger"
              title="DRIVE / EQUIPMENT MISMATCH"
              action={
                profiles.length > 1 || matchingProfiles.length ? (
                  <div className="flex flex-wrap gap-2">
                    {(matchingProfiles.length ? matchingProfiles : profiles.filter((p) => p.id !== sessionProfile?.id)).slice(0, 6).map((p) => (
                      <button key={p.id} type="button" className="btn min-h-[48px] bg-white px-3 text-[15px] text-fail" onClick={() => void switchProfile(p.id)}>
                        Switch to {p.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button type="button" className="btn min-h-[48px] bg-white px-3 text-[15px] text-fail" onClick={goProfiles}>
                    Create a matching profile
                  </button>
                )
              }
            >
              {driveAlert.message}
            </Banner>
          )}

          {otherAlerts.map((a) => (
            <Banner key={a.code} tone={a.level === 'danger' ? 'danger' : a.level === 'warning' ? 'warning' : 'info'} title={a.title}>
              {a.message}
            </Banner>
          ))}

          {result.verdict === 'NO PROFILE' && (
            <Banner tone="info" title="No Golden Profile selected">
              Only the Identity Card and safety checks are shown. Select or create a Golden Profile to run the configuration audit.
            </Banner>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <button type="button" className="btn btn-primary" onClick={() => exportAuditPdf(unit, result)}>
              <Icon name="download" /> Export Audit Report PDF
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => exportFullPdf(unit)}>
              <Icon name="file" /> Export Full Parameters PDF
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                const shared = await sharePdf(unit, result);
                if (!shared) toast('Share not available - PDF downloaded instead');
              }}
            >
              <Icon name="share" /> Share PDF
            </button>
          </div>

          <IdentityCardView card={result.identity} phaseMismatch={result.alerts.some((a) => a.code === 'PHASE_ORDER')} />

          {result.verdict !== 'NO PROFILE' && (
            <Card
              title="Configuration Mismatches"
              right={<Chip tone={result.mismatches.length ? 'fail' : 'pass'}>{result.mismatches.length ? `${result.mismatches.length} FAIL` : 'PASS'}</Chip>}
            >
              {result.mismatches.length ? (
                <DiffTable rows={result.mismatches} />
              ) : (
                <p className="py-2 text-[15px] font-semibold text-pass">No configuration differences found.</p>
              )}
              <p className="mt-3 text-[13px] text-ink-2">
                Compared {result.comparedCount} parameters. Critical groups for {result.category} are listed first. Hidden by noise filter: {result.noise.length} telemetry/counter,{' '}
                {result.identityDiffs.length} unit identity, {result.presence.length} presence-only, {result.ignored.length} ignored by profile.
              </p>
            </Card>
          )}

          {result.verdict !== 'NO PROFILE' && (
            <>
              <Toggle
                checked={showNoise}
                onChange={setShowNoise}
                label="Show Live Telemetry & Counters"
                hint="Filtered rows: live values, counters, logs, unit identity, presence-only and ignored parameters"
              />
              {showNoise && (
                <div className="space-y-3">
                  <Card title={`Unit identity differences (${result.identityDiffs.length})`}>
                    <DiffTable rows={result.identityDiffs} tone="neutral" showReason />
                  </Card>
                  <Card title={`Presence-only differences (${result.presence.length})`}>
                    <DiffTable rows={result.presence} tone="neutral" showReason />
                  </Card>
                  <Card title={`Ignored by profile (${result.ignored.length})`}>
                    <DiffTable rows={result.ignored} tone="neutral" showReason />
                  </Card>
                  <Card title={`Live telemetry, counters & logs (${result.noise.length})`}>
                    <DiffTable rows={result.noise} tone="neutral" showReason />
                  </Card>
                </div>
              )}
            </>
          )}

          {unit.warnings.length > 0 && (
            <Card title="Decoder notes">
              <ul className="list-disc space-y-1 pl-5 text-[14px] text-ink-2">
                {unit.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
