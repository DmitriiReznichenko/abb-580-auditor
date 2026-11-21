/**
 * PDF report generation (jsPDF + jspdf-autotable) and CSV export.
 * All report text is English. Built-in PDF fonts only cover Latin-1, so
 * text is sanitized (e.g. "cos φ" -> "cos phi").
 */
import { jsPDF } from 'jspdf';
import { autoTable, type RowInput } from 'jspdf-autotable';
import type { FleetEntry, ParsedUnit } from './types';
import type { AuditResult } from './audit';
import { compareIds } from './format';
import { groupName } from './dictionary';

export interface ReportContext {
  appVersion: string;
  generatedAt?: Date;
}

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/φ/g, 'phi'],
  [/Ω/g, 'Ohm'],
  [/μ|µ/g, 'u'],
  [/[–—]/g, '-'],
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
  [/…/g, '...'],
  [/≤/g, '<='],
  [/≥/g, '>='],
];

/** Make text safe for the built-in Helvetica (WinAnsi) font. */
export function pdfSafe(s: string | number | null | undefined): string {
  let t = s === null || s === undefined ? '' : String(s);
  for (const [re, rep] of REPLACEMENTS) t = t.replace(re, rep);
  // Keep printable Latin-1 only.
  return t.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function addFooters(doc: jsPDF, left: string): void {
  const n = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(90);
    doc.text(pdfSafe(left), 14, h - 7);
    doc.text(`Page ${i} of ${n}`, w - 14, h - 7, { align: 'right' });
  }
}

function header(doc: jsPDF, title: string, sub: string): number {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(20, 20, 20);
  doc.rect(0, 0, w, 18, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(pdfSafe(title), 14, 11.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(pdfSafe(sub), w - 14, 11.5, { align: 'right' });
  doc.setTextColor(0);
  return 24;
}

type DocWithTable = jsPDF & { lastAutoTable?: { finalY: number } };

function lastY(doc: jsPDF, fallback: number): number {
  return (doc as DocWithTable).lastAutoTable?.finalY ?? fallback;
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  const h = doc.internal.pageSize.getHeight();
  if (y > h - 30) {
    doc.addPage();
    y = 16;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(0);
  doc.text(pdfSafe(text), 14, y);
  return y + 2.5;
}

const TABLE_BASE = {
  theme: 'grid' as const,
  styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.4, textColor: 0, lineColor: 160, lineWidth: 0.1 },
  headStyles: { fillColor: [30, 30, 30] as [number, number, number], textColor: 255, fontStyle: 'bold' as const },
  margin: { left: 14, right: 14 },
};

// ---------------------------------------------------------------------------
// 1) Audit Report
// ---------------------------------------------------------------------------

export function buildAuditReportPdf(unit: ParsedUnit, result: AuditResult, ctx: ReportContext): ArrayBuffer {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const now = ctx.generatedAt ?? new Date();
  let y = header(doc, 'Commissioning Audit Report', `ABB 580 Field Auditor v${ctx.appVersion} | ${stamp(now)}`);
  const id = result.identity;

  // Verdict banner
  const w = doc.internal.pageSize.getWidth();
  const verdict = result.verdict;
  const color: [number, number, number] = verdict === 'PASS' ? [0, 122, 51] : verdict === 'FAIL' ? [190, 0, 0] : [110, 110, 110];
  doc.setFillColor(...color);
  doc.rect(14, y, w - 28, 13, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(`VERDICT: ${verdict}`, 18, y + 8.7);
  doc.setFontSize(9);
  const verdictNote =
    verdict === 'NO PROFILE'
      ? 'No Golden Profile selected'
      : `${result.mismatches.length} configuration mismatch(es) vs Golden Profile`;
  doc.text(pdfSafe(verdictNote), w - 18, y + 8.4, { align: 'right' });
  doc.setTextColor(0);
  y += 18;

  autoTable(doc, {
    ...TABLE_BASE,
    startY: y,
    head: [['Unit Identity', '']],
    body: [
      ['Unit Name', id.unitName],
      ['Serial Number', id.serialNumber ?? '-'],
      ['Panel Drive Name', id.panelDriveName ?? '-'],
      ['Equipment Category', result.category ?? '-'],
      ['Golden Profile', result.profileName ?? '(none)'],
      ['Drive Rating (07.03)', id.driveRating ?? '-'],
      ['Firmware (07.04 / 07.05)', `${id.firmware ?? '-'} / ${id.firmwareVersion ?? '-'}`],
      ['Source File', `${unit.fileName} (${unit.source === 'pdf' ? 'Drive Composer PDF' : '.dcparamsbak'})`],
    ].map((r) => r.map(pdfSafe)),
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } },
  });
  y = lastY(doc, y) + 6;

  if (result.alerts.length) {
    y = sectionTitle(doc, 'Safety & Startup Alerts', y);
    autoTable(doc, {
      ...TABLE_BASE,
      startY: y,
      head: [['Level', 'Alert']],
      body: result.alerts.map((a) => [a.level.toUpperCase(), pdfSafe(a.message)]),
      columnStyles: { 0: { cellWidth: 22, fontStyle: 'bold' } },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 0) {
          d.cell.styles.textColor = d.cell.raw === 'DANGER' ? [190, 0, 0] : d.cell.raw === 'WARNING' ? [170, 90, 0] : [0, 70, 140];
        }
      },
    });
    y = lastY(doc, y) + 6;
  }

  y = sectionTitle(doc, 'Motor & Limits Quick-Check (Startup Report)', y);
  autoTable(doc, {
    ...TABLE_BASE,
    startY: y,
    head: [['Param #', 'Parameter', 'Value', 'Note']],
    body: id.motor.map((m) => [m.id, pdfSafe(m.label), pdfSafe(`${m.value}${m.unit ? ' ' + m.unit : ''}`), pdfSafe(m.warn ?? 'OK')]),
    columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 52 }, 2: { cellWidth: 32 } },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 3 && d.cell.raw !== 'OK') d.cell.styles.textColor = [190, 0, 0];
    },
  });
  y = lastY(doc, y) + 6;

  const b = id.bacnet;
  y = sectionTitle(doc, 'BACnet / Network Diagnostics', y);
  autoTable(doc, {
    ...TABLE_BASE,
    startY: y,
    head: [['Item', 'Value']],
    body: [
      ['FBA A type (51.01)', b.fbaType],
      ['IP address (51.05-51.08)', b.ipAddress],
      ['Subnet CIDR (51.09)', `${b.subnetCidr}${b.subnetMask ? ' (' + b.subnetMask + ')' : ''}`],
      ['Gateway (51.10-51.13)', b.gateway],
      ['Combined BACnet/IP Device ID (51.15 x 10000 + 51.14)', b.combinedDeviceId === null ? '-' : String(b.combinedDeviceId)],
      ['Device obj ID hi / lo (51.15 / 51.14)', `${b.deviceIdHi ?? '-'} / ${b.deviceIdLo ?? '-'}`],
      ['Mapping file version (51.30)', b.mappingFileVersion],
      ['Comm status (51.31)', b.commStatus],
      ['Embedded protocol (58.01)', b.embeddedProtocol],
      ['MS/TP node (58.03) / Device ID (58.40)', `${b.mstpNode} / ${b.mstpDeviceId}`],
    ].map((r) => r.map(pdfSafe)),
    columnStyles: { 0: { cellWidth: 85, fontStyle: 'bold' } },
  });
  y = lastY(doc, y) + 6;

  y = sectionTitle(doc, 'Decoded Faults & Warnings', y);
  autoTable(doc, {
    ...TABLE_BASE,
    startY: y,
    head: [['Param #', 'Slot', 'Code', 'Event', 'Description']],
    body: id.events.map((e) => [
      e.id,
      pdfSafe(e.label),
      e.code,
      pdfSafe(e.code === '0x0000' ? '-' : e.event?.name ?? 'Unknown code'),
      pdfSafe(e.event?.description ?? ''),
    ]),
    columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 30 }, 2: { cellWidth: 18 }, 3: { cellWidth: 45 } },
  });
  y = lastY(doc, y) + 6;

  y = sectionTitle(doc, `Configuration Mismatches (${result.mismatches.length})`, y);
  const mm: RowInput[] = result.mismatches.length
    ? result.mismatches.map((r) => [
        r.id,
        pdfSafe(r.name),
        pdfSafe(`${r.goldenValue}${r.unit ? ' ' + r.unit : ''}`),
        pdfSafe(`${r.unitValue}${r.unit ? ' ' + r.unit : ''}`),
        pdfSafe(r.factoryDefault),
      ])
    : [[{ content: result.verdict === 'NO PROFILE' ? 'No Golden Profile selected.' : 'No configuration mismatches. PASS.', colSpan: 5 }]];
  autoTable(doc, {
    ...TABLE_BASE,
    startY: y,
    head: [['Param #', 'Parameter Name', 'Golden Value', 'Unit Value', 'Factory Default']],
    body: mm,
    columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 58 } },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 3 && result.mismatches.length) {
        d.cell.styles.textColor = [190, 0, 0];
        d.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = lastY(doc, y) + 6;

  const extra = result.noise.length + result.identityDiffs.length + result.presence.length + result.ignored.length;
  if (extra) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(80);
    const h = doc.internal.pageSize.getHeight();
    if (y > h - 20) {
      doc.addPage();
      y = 16;
    }
    doc.text(
      pdfSafe(
        `Not counted in verdict: ${result.noise.length} live telemetry/counter differences, ${result.identityDiffs.length} unit-unique identity values, ` +
          `${result.presence.length} parameters present in only one file, ${result.ignored.length} profile-ignored parameters.`,
      ),
      14,
      y,
      { maxWidth: w - 28 },
    );
    doc.setTextColor(0);
  }

  addFooters(doc, `ABB 580 Field Auditor v${ctx.appVersion} - Audit Report - ${id.unitName}`);
  return doc.output('arraybuffer');
}

// ---------------------------------------------------------------------------
// 2) Full Parameters (Drive Composer Pro style)
// ---------------------------------------------------------------------------

export function buildFullParamsPdf(unit: ParsedUnit, ctx: ReportContext): ArrayBuffer {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const now = ctx.generatedAt ?? new Date();
  const y = header(doc, 'Drive parameters', `${unit.unitName} | ${unit.driveModel ?? ''} | ${stamp(now)}`);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    pdfSafe(`Unit: ${unit.unitName}   Model: ${unit.driveModel ?? '-'}   Serial: ${unit.serialNumber ?? '-'}   Firmware: ${unit.firmware ?? '-'}   Source: ${unit.fileName}`),
    14,
    y,
  );

  const ids = Object.keys(unit.params).sort(compareIds);
  const body: RowInput[] = [];
  let lastGroup = -1;
  for (const id of ids) {
    const p = unit.params[id];
    if (p.group !== lastGroup) {
      lastGroup = p.group;
      body.push([
        { content: `${p.group}.`, styles: { fontStyle: 'bold', fillColor: [225, 225, 225] } },
        { content: pdfSafe(p.groupName ?? groupName(p.group) ?? ''), colSpan: 6, styles: { fontStyle: 'bold', fillColor: [225, 225, 225] } },
      ]);
    }
    body.push([
      String(p.index),
      pdfSafe(p.name),
      pdfSafe(p.display),
      pdfSafe(p.unit || 'NoUnit'),
      pdfSafe(p.min ?? ''),
      pdfSafe(p.max ?? ''),
      pdfSafe(p.defaultDisplay ?? ''),
    ]);
  }
  autoTable(doc, {
    ...TABLE_BASE,
    startY: y + 4,
    styles: { ...TABLE_BASE.styles, fontSize: 6.6, cellPadding: 1, overflow: 'linebreak' },
    head: [['Index', 'Name', 'Value', 'Unit', 'Min', 'Max', 'Default']],
    body,
    columnStyles: {
      0: { cellWidth: 11 },
      1: { cellWidth: 50 },
      2: { cellWidth: 36 },
      3: { cellWidth: 13 },
      4: { cellWidth: 20 },
      5: { cellWidth: 21 },
      6: { cellWidth: 'auto' },
    },
  });
  addFooters(doc, `ABB 580 Field Auditor v${ctx.appVersion} - Full Parameters - ${unit.unitName}`);
  return doc.output('arraybuffer');
}

// ---------------------------------------------------------------------------
// 3) Fleet summary (PDF + CSV)
// ---------------------------------------------------------------------------

export function buildFleetPdf(fleet: FleetEntry[], ctx: ReportContext, conflictIds: Set<string> = new Set()): ArrayBuffer {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape' });
  const now = ctx.generatedAt ?? new Date();
  const y = header(doc, 'Fleet Audit Summary', `ABB 580 Field Auditor v${ctx.appVersion} | ${stamp(now)}`);
  autoTable(doc, {
    ...TABLE_BASE,
    startY: y,
    head: [['Unit', 'Timestamp', 'Golden Profile', 'Verdict', 'Mismatches', 'IP Address', 'BACnet ID', '99.16', '30.17', '99.06', 'Conflict']],
    body: fleet.map((e) => [
      pdfSafe(e.unitName),
      pdfSafe(e.timestamp.replace('T', ' ').slice(0, 16)),
      pdfSafe(e.profileName),
      e.verdict,
      String(e.mismatchCount),
      pdfSafe(e.ipAddress),
      e.bacnetId === null ? '-' : String(e.bacnetId),
      pdfSafe(e.phaseOrder),
      pdfSafe(e.maxCurrent),
      pdfSafe(e.motorCurrent),
      conflictIds.has(e.id) ? 'DUPLICATE' : '',
    ]),
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      if (d.column.index === 3) d.cell.styles.textColor = d.cell.raw === 'PASS' ? [0, 122, 51] : d.cell.raw === 'FAIL' ? [190, 0, 0] : 80;
      if (d.column.index === 10 && d.cell.raw) d.cell.styles.textColor = [190, 0, 0];
    },
  });
  addFooters(doc, `ABB 580 Field Auditor v${ctx.appVersion} - Fleet Summary`);
  return doc.output('arraybuffer');
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildFleetCsv(fleet: FleetEntry[], conflictIds: Set<string> = new Set()): string {
  const head = ['Unit Name', 'Timestamp', 'Golden Profile', 'Category', 'Verdict', 'Mismatch Count', 'IP Address', 'Combined BACnet Device ID', '99.16 Phase Order', '30.17 Maximum Current', '99.06 Motor Nominal Current', 'Network Conflict'];
  const rows = fleet.map((e) => [
    e.unitName,
    e.timestamp,
    e.profileName,
    e.category ?? '',
    e.verdict,
    e.mismatchCount,
    e.ipAddress,
    e.bacnetId ?? '',
    e.phaseOrder,
    e.maxCurrent,
    e.motorCurrent,
    conflictIds.has(e.id) ? 'DUPLICATE' : '',
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function buildParamsCsv(unit: ParsedUnit): string {
  const head = ['Param #', 'Group', 'Name', 'Value', 'Unit', 'Min', 'Max', 'Default'];
  const rows = Object.keys(unit.params)
    .sort(compareIds)
    .map((id) => {
      const p = unit.params[id];
      return [id, p.groupName ?? '', p.name, p.display, p.unit ?? '', p.min ?? '', p.max ?? '', p.defaultDisplay ?? ''];
    });
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
