/**
 * Shared UI primitives. All touch targets are at least 48px tall.
 */
import { useRef, useState, type ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Icons (inline SVG, no icon fonts / CDN)
// ---------------------------------------------------------------------------

const ICON_PATHS: Record<string, string> = {
  audit: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
  params: 'M4 6h16M4 12h16M4 18h10M18 16l2 2-2 2',
  fleet: 'M3 7h18M3 12h18M3 17h18M7 3v18',
  profiles: 'M12 2l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 16.9 6.1 20l1.3-6.5L2.5 8.9l6.6-.8z',
  upload: 'M12 16V4m0 0l-5 5m5-5l5 5M4 20h16',
  download: 'M12 4v12m0 0l-5-5m5 5l5-5M4 20h16',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  alert: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 16v-4m0-4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  plus: 'M12 5v14M5 12h14',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
  book: 'M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h14',
  wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M2 9a15 15 0 0 1 20 0',
};

export function Icon({ name, className = 'h-6 w-6', strokeWidth = 2.2 }: { name: string; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICON_PATHS[name] ?? ICON_PATHS.info} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

export type BannerTone = 'danger' | 'warning' | 'info' | 'success';

const BANNER_STYLES: Record<BannerTone, string> = {
  danger: 'bg-fail text-white border-fail',
  warning: 'bg-warn-bg text-warn border-warn',
  info: 'bg-info-bg text-info border-info',
  success: 'bg-pass-bg text-pass border-pass',
};

export function Banner({
  tone,
  title,
  children,
  action,
  onClose,
}: {
  tone: BannerTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cx('fade-in rounded-2xl border-2 p-4', BANNER_STYLES[tone])}>
      <div className="flex items-start gap-3">
        <Icon name={tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert'} className="mt-0.5 h-6 w-6 shrink-0" strokeWidth={2.6} />
        <div className="min-w-0 flex-1">
          {title && <div className="text-[17px] font-extrabold leading-tight tracking-wide">{title}</div>}
          {children && <div className={cx('text-[15px] font-semibold leading-snug', title && 'mt-1')}>{children}</div>}
          {action && <div className="mt-3">{action}</div>}
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="-m-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" aria-label="Dismiss">
            <Icon name="x" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// File picker (intentionally NO accept attribute: Android Chrome greys out
// unknown extensions such as .dcparamsbak when an accept filter is present).
// ---------------------------------------------------------------------------

export function FileButton({
  label,
  onFile,
  className = 'btn btn-brand w-full text-[16px] leading-tight',
  busy,
  icon = 'upload',
}: {
  label: string;
  onFile: (file: File) => void | Promise<void>;
  className?: string;
  busy?: boolean;
  icon?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Spinner /> : <Icon name={icon} />}
        <span>{busy ? 'Decoding...' : label}</span>
      </button>
      <input
        ref={ref}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void onFile(f);
        }}
      />
    </>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <span className={cx('inline-block animate-spin rounded-full border-[3px] border-current border-t-transparent', className)} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-[56px] w-full items-center justify-between gap-4 rounded-2xl border-2 border-ink bg-surface px-4 py-2 text-left"
    >
      <span>
        <span className="block font-bold">{label}</span>
        {hint && <span className="block text-[13px] text-ink-2">{hint}</span>}
      </span>
      <span className={cx('relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-pass' : 'bg-line-strong')}>
        <span className={cx('inline-block h-6 w-6 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-7' : 'translate-x-1')} />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function Card({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('card card-pad fade-in', className)}>
      {(title || right) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <h2 className="section-title">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/** Values that read better in a monospace font (numbers, addresses, codes). */
export function isNumericLike(v: unknown): boolean {
  return typeof v === 'string' && /^[-+0-9.,:/x\s]*[0-9][-+0-9a-fA-F.,:/xb\s]*(?:\s?[A-Za-z%°]{1,4})?$/.test(v.trim());
}

export function KV({ label, value, mono, warn, sub }: { label: ReactNode; value: ReactNode; mono?: boolean; warn?: boolean; sub?: ReactNode }) {
  const useMono = mono && (typeof value !== 'string' || isNumericLike(value));
  return (
    <div className={cx('kv flex-wrap', warn && '-mx-2 rounded-lg bg-warn-bg px-2')}>
      <dt>{label}</dt>
      <dd className={cx(useMono && 'mono', warn && 'text-warn')}>{value}</dd>
      {sub && <div className={cx('w-full text-[13px] leading-snug', warn ? 'font-semibold text-warn' : 'text-right text-ink-2')}>{sub}</div>}
    </div>
  );
}

export function VerdictBadge({ verdict, large }: { verdict: 'PASS' | 'FAIL' | 'NO PROFILE'; large?: boolean }) {
  const cls =
    verdict === 'PASS' ? 'bg-pass text-white' : verdict === 'FAIL' ? 'bg-fail text-white' : 'bg-line text-ink';
  return (
    <span className={cx('inline-flex items-center justify-center rounded-xl font-black tracking-wider', cls, large ? 'min-h-[64px] min-w-[120px] px-5 text-[28px]' : 'min-h-[32px] px-3 text-[13px]')}>
      {verdict}
    </span>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'fail' | 'pass' | 'warn' | 'info' }) {
  const map = {
    neutral: 'bg-paper text-ink-2 border-line',
    fail: 'bg-fail-bg text-fail border-fail',
    pass: 'bg-pass-bg text-pass border-pass',
    warn: 'bg-warn-bg text-warn border-warn',
    info: 'bg-info-bg text-info border-info',
  } as const;
  return <span className={cx('inline-flex items-center rounded-md border px-2 py-0.5 text-[12px] font-bold', map[tone])}>{children}</span>;
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-line-strong px-6 py-10 text-center">
      <Icon name={icon} className="h-10 w-10 text-ink-2" />
      <div className="mt-3 text-[17px] font-bold">{title}</div>
      {children && <div className="mt-1 max-w-sm text-[15px] text-ink-2">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export interface ToastMsg {
  id: number;
  text: string;
  tone: 'ok' | 'err';
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const push = (text: string, tone: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts([{ id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  };
  return { toasts, push };
}

export function ToastHost({ toasts }: { toasts: ToastMsg[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[92px] z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div key={t.id} className={cx('fade-in max-w-md rounded-xl px-4 py-3 text-[15px] font-semibold text-white shadow-lg', t.tone === 'ok' ? 'bg-ink' : 'bg-fail')}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
