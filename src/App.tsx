/**
 * App shell: header (name, build version, cache refresh), hash routing and
 * bottom navigation (Audit | Parameters | Fleet Log | Profiles).
 */
import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './ui/store';
import { Icon, Spinner, ToastHost, cx, useToasts } from './ui/components';
import { AuditTab } from './ui/AuditTab';
import { ParametersTab } from './ui/ParametersTab';
import { FleetTab } from './ui/FleetTab';
import { ProfilesTab } from './ui/ProfilesTab';
import { APP_VERSION, hardRefreshApp } from './ui/platform';

type Route = 'audit' | 'parameters' | 'fleet' | 'profiles';

const TABS: Array<{ id: Route; label: string; icon: string }> = [
  { id: 'audit', label: 'Audit', icon: 'audit' },
  { id: 'parameters', label: 'Parameters', icon: 'params' },
  { id: 'fleet', label: 'Fleet Log', icon: 'fleet' },
  { id: 'profiles', label: 'Profiles', icon: 'profiles' },
];

function readRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (TABS.find((t) => t.id === h)?.id ?? 'audit') as Route;
}

function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (r: Route) => {
    if (r !== route) window.location.hash = `#/${r}`;
    window.scrollTo({ top: 0 });
  };
  return [route, go];
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

function Shell() {
  const [route, go] = useHashRoute();
  const { ready, fleet, session, sessionResult } = useStore();
  const { toasts, push } = useToasts();
  const online = useOnline();
  const [refreshing, setRefreshing] = useState(false);

  return (
    <div className="min-h-dvh pb-[96px]">
      <header className="sticky top-0 z-30 border-b-4 border-brand bg-ink text-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-[13px] font-black">580</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-extrabold leading-tight">ABB 580 Field Auditor</div>
            <div className="mono flex items-center gap-2 text-[11px] text-white/70">
              <span>v{APP_VERSION}</span>
              <span className={cx('inline-flex items-center gap-1', online ? 'text-white/70' : 'text-amber-300')}>
                <span className={cx('inline-block h-2 w-2 rounded-full', online ? 'bg-emerald-400' : 'bg-amber-300')} />
                {online ? 'online' : 'offline'}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-white/30 active:bg-white/10"
            aria-label="Refresh app cache"
            title="Refresh app cache"
            onClick={() => {
              setRefreshing(true);
              void hardRefreshApp();
            }}
          >
            {refreshing ? <Spinner /> : <Icon name="refresh" />}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-4">
        {!ready ? (
          <div className="flex justify-center py-20">
            <Spinner className="h-10 w-10" />
          </div>
        ) : route === 'audit' ? (
          <AuditTab toast={push} goProfiles={() => go('profiles')} />
        ) : route === 'parameters' ? (
          <ParametersTab toast={push} />
        ) : route === 'fleet' ? (
          <FleetTab toast={push} />
        ) : (
          <ProfilesTab toast={push} />
        )}
      </main>

      <ToastHost toasts={toasts} />

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t-2 border-ink bg-surface" aria-label="Main">
        <div className="mx-auto grid max-w-3xl grid-cols-4">
          {TABS.map((t) => {
            const active = route === t.id;
            const badge =
              t.id === 'audit' && session && sessionResult
                ? sessionResult.verdict === 'FAIL'
                  ? String(sessionResult.mismatches.length)
                  : sessionResult.verdict === 'PASS'
                    ? 'OK'
                    : ''
                : t.id === 'fleet' && fleet.length
                  ? String(fleet.length)
                  : '';
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => go(t.id)}
                aria-current={active ? 'page' : undefined}
                className={cx('relative flex min-h-[68px] flex-col items-center justify-center gap-1 text-[12px] font-bold', active ? 'text-ink' : 'text-ink-2')}
              >
                {active && <span className="absolute inset-x-4 top-0 h-1 rounded-b bg-brand" />}
                <span className={cx('relative flex h-8 w-14 items-center justify-center rounded-full', active && 'bg-ink text-white')}>
                  <Icon name={t.icon} className="h-[22px] w-[22px]" />
                  {badge && (
                    <span
                      className={cx(
                        'absolute -right-1 -top-1 min-w-[20px] rounded-full px-1 text-[11px] leading-[20px] text-white',
                        t.id === 'audit' && sessionResult?.verdict === 'PASS' ? 'bg-pass' : t.id === 'audit' ? 'bg-fail' : 'bg-info',
                      )}
                    >
                      {badge}
                    </span>
                  )}
                </span>
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
