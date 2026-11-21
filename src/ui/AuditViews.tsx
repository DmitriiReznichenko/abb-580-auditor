/**
 * Audit result building blocks: Identity Card and diff tables.
 */
import type { DiffRow, IdentityCard as IdentityCardData } from '../lib/audit';
import { Card, Chip, KV, cx } from './components';

function withUnit(v: string, unit?: string): string {
  if (!v || v === '-') return '-';
  return unit ? `${v} ${unit}` : v;
}

export function IdentityCardView({ card, phaseMismatch }: { card: IdentityCardData; phaseMismatch?: boolean }) {
  const b = card.bacnet;
  const activeEvents = card.events.filter((e) => e.code !== '-' && e.code !== '0x0000');
  return (
    <div className="space-y-3">
      <Card title="Unit Identity">
        <dl>
          <KV label="Unit name" value={card.unitName} />
          {card.panelDriveName && card.panelDriveName !== card.unitName && <KV label="Panel drive name" value={card.panelDriveName} />}
          <KV label="Serial number" value={card.serialNumber || '-'} mono />
          <KV label="Drive rating (07.03)" value={card.driveRating || '-'} />
          <KV label="Firmware (07.04 / 07.05)" value={[card.firmware, card.firmwareVersion].filter(Boolean).join(' / ') || '-'} mono />
        </dl>
      </Card>

      <Card title="Motor & Limits Quick-Check">
        <dl>
          {card.motor.map((m) => (
            <KV
              key={m.id}
              label={
                <span>
                  <span className="mono mr-2 text-ink">{m.id}</span>
                  {m.label}
                </span>
              }
              value={withUnit(m.value, m.unit)}
              mono
              warn={!!m.warn || (m.id === '99.16' && phaseMismatch)}
              sub={m.warn ?? (m.id === '99.16' && phaseMismatch ? 'Differs from Golden Profile' : undefined)}
            />
          ))}
        </dl>
      </Card>

      <Card title="BACnet Diagnostics">
        <div className="mb-3 rounded-xl bg-ink p-4 text-white">
          <div className="text-[12px] font-bold uppercase tracking-widest text-white/70">Combined BACnet/IP Device Instance ID</div>
          <div className="mono mt-1 text-[34px] font-black leading-none">{b.combinedDeviceId ?? '-'}</div>
          <div className="mono mt-2 text-[13px] text-white/80">
            51.15 hi = {b.deviceIdHi ?? '-'} &nbsp;|&nbsp; 51.14 lo = {b.deviceIdLo ?? '-'} &nbsp;|&nbsp; hi x 10000 + lo
          </div>
        </div>
        <dl>
          <KV label="Fieldbus adapter (51.01)" value={b.fbaType} />
          <KV label="IP address (51.05-51.08)" value={b.ipAddress} mono />
          <KV label="Subnet CIDR (51.09)" value={b.subnetCidr} mono sub={b.subnetMask} />
          <KV label="Gateway (51.10-51.13)" value={b.gateway} mono />
          <KV label="Mapping file version (51.30)" value={b.mappingFileVersion} mono />
          <KV label="FBA comm status (51.31)" value={b.commStatus} />
          <KV label="Embedded protocol (58.01)" value={b.embeddedProtocol} />
          <KV label="MS/TP node address (58.03)" value={b.mstpNode} mono />
          <KV label="MS/TP device instance (58.40)" value={b.mstpDeviceId} mono />
        </dl>
      </Card>

      <Card title="Faults & Warnings" right={activeEvents.length ? <Chip tone="warn">{activeEvents.length} logged</Chip> : <Chip tone="pass">None</Chip>}>
        <ul className="divide-y divide-line">
          {card.events.map((e) => {
            const empty = e.code === '-' || e.code === '0x0000';
            const fault = e.event?.kind === 'fault';
            return (
              <li key={e.id} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] text-ink-2">
                    <span className="mono mr-2 text-ink">{e.id}</span>
                    {e.label}
                  </span>
                  <span className={cx('mono font-bold', empty ? 'text-ink-2' : fault ? 'text-fail' : 'text-warn')}>{e.code}</span>
                </div>
                {!empty && (
                  <div className="mt-1 text-[14px]">
                    {e.event ? (
                      <>
                        <span className="font-bold">{e.event.name}</span>
                        <span className="text-ink-2"> ({e.event.kind === 'pure_event' ? 'event' : e.event.kind})</span>
                        {e.event.description && <span className="block text-ink-2">{e.event.description}</span>}
                      </>
                    ) : (
                      <span className="text-ink-2">Code not found in the event dictionary.</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

/** Mismatch rows: cards on phones, a 5-column table on wide screens. */
export function DiffTable({ rows, tone = 'fail', showReason }: { rows: DiffRow[]; tone?: 'fail' | 'neutral'; showReason?: boolean }) {
  if (!rows.length) return <p className="py-2 text-[15px] text-ink-2">No rows.</p>;
  return (
    <>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className={cx('rounded-xl border-2 p-3', tone === 'fail' ? 'border-fail/40 bg-fail-bg/40' : 'border-line bg-paper')}>
            <div className="flex items-baseline gap-2">
              <span className="mono font-black">{r.id}</span>
              <span className="font-semibold leading-tight">{r.name}</span>
              {r.critical && tone === 'fail' && <Chip tone="fail">Critical</Chip>}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[13px]">
              <div>
                <div className="font-bold uppercase text-ink-2">Golden</div>
                <div className="mono break-words text-[15px] font-semibold">{r.goldenValue}</div>
              </div>
              <div>
                <div className="font-bold uppercase text-ink-2">Unit</div>
                <div className={cx('mono break-words text-[15px] font-bold', tone === 'fail' && 'text-fail')}>{r.unitValue}</div>
              </div>
              <div>
                <div className="font-bold uppercase text-ink-2">Default</div>
                <div className="mono break-words text-[15px]">{r.factoryDefault || '-'}</div>
              </div>
            </div>
            {r.unit && <div className="mt-1 text-[12px] text-ink-2">Unit of measure: {r.unit}</div>}
            {showReason && r.reason && <div className="mt-1 text-[12px] text-ink-2">{r.reason}</div>}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-[15px]">
          <thead>
            <tr className="border-b-2 border-ink text-[12px] uppercase tracking-wider text-ink-2">
              <th className="py-2 pr-3">Param #</th>
              <th className="py-2 pr-3">Parameter Name</th>
              <th className="py-2 pr-3">Golden Value</th>
              <th className="py-2 pr-3">Unit Value</th>
              <th className="py-2 pr-3">Factory Default</th>
              {showReason && <th className="py-2">Class</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line align-top">
                <td className="mono py-2 pr-3 font-bold">{r.id}</td>
                <td className="py-2 pr-3">
                  {r.name}
                  {r.critical && tone === 'fail' && (
                    <span className="ml-2">
                      <Chip tone="fail">Critical</Chip>
                    </span>
                  )}
                </td>
                <td className="mono py-2 pr-3">{withUnit(r.goldenValue, r.unit)}</td>
                <td className={cx('mono py-2 pr-3 font-bold', tone === 'fail' && 'text-fail')}>{withUnit(r.unitValue, r.unit)}</td>
                <td className="mono py-2 pr-3 text-ink-2">{r.factoryDefault || '-'}</td>
                {showReason && <td className="py-2 text-[13px] text-ink-2">{r.reason}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
