/**
 * Report export actions shared by the Audit and Parameters tabs.
 */
import type { ParsedUnit } from '../lib/types';
import type { AuditResult } from '../lib/audit';
import { buildAuditReportPdf, buildFullParamsPdf, buildParamsCsv } from '../lib/reports';
import { APP_VERSION, downloadBlob, safeFileName, shareOrDownload } from './platform';

function stampForFile(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function auditReportName(unit: ParsedUnit): string {
  return `${safeFileName(unit.unitName)}_Audit_Report_${stampForFile()}.pdf`;
}

export function fullParamsName(unit: ParsedUnit): string {
  return `${safeFileName(unit.unitName)}_Full_Parameters_${stampForFile()}.pdf`;
}

export function exportAuditPdf(unit: ParsedUnit, result: AuditResult): void {
  const pdf = buildAuditReportPdf(unit, result, { appVersion: APP_VERSION });
  downloadBlob(pdf, auditReportName(unit), 'application/pdf');
}

export function exportFullPdf(unit: ParsedUnit): void {
  const pdf = buildFullParamsPdf(unit, { appVersion: APP_VERSION });
  downloadBlob(pdf, fullParamsName(unit), 'application/pdf');
}

export function exportParamsCsv(unit: ParsedUnit): void {
  downloadBlob(buildParamsCsv(unit), `${safeFileName(unit.unitName)}_Parameters_${stampForFile()}.csv`, 'text/csv');
}

/** Share the audit report (or the full parameter list when no audit is available). */
export async function sharePdf(unit: ParsedUnit, result: AuditResult | null): Promise<boolean> {
  if (result) {
    const pdf = buildAuditReportPdf(unit, result, { appVersion: APP_VERSION });
    return shareOrDownload(pdf, auditReportName(unit), `${unit.unitName} - Audit Report`);
  }
  const pdf = buildFullParamsPdf(unit, { appVersion: APP_VERSION });
  return shareOrDownload(pdf, fullParamsName(unit), `${unit.unitName} - Full Parameters`);
}
