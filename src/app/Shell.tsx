import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccountsPage } from '../features/accounts/AccountsPage';
import { BudgetsPage } from '../features/budgets/BudgetsPage';
import { Dashboard } from '../features/dashboard/Dashboard';
import { GoalsPage } from '../features/goals/GoalsPage';
import { PocketsPage } from '../features/pockets/PocketsPage';
import { RemindersPage } from '../features/reminders/RemindersPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { TransactionsPage } from '../features/transactions/TransactionsPage';
import { useTxUi } from '../features/transactions/TxUi';
import { Dialog } from '../components/Dialog';
import { BrandMark, PrivacyToggle } from '../components/ui';
import { periodLabel, type PeriodPreset } from '../domain/dates';
import { reminderAgenda } from '../domain/reminders';
import { href, useRoute } from './router';
import { useSession } from './session';
import { useStore } from './store';

interface RouteDef {
  path: string;
  label: string;
  icon: string;
  render: () => ReactNode;
  usesPeriod?: boolean;
}

const ROUTES: RouteDef[] = [
  { path: '/', label: 'Beranda', icon: '🏠', render: () => <Dashboard />, usesPeriod: true },
  { path: '/transaksi', label: 'Transaksi', icon: '📒', render: () => <TransactionsPage /> },
  { path: '/rekening', label: 'Rekening', icon: '🏦', render: () => <AccountsPage /> },
  { path: '/kantong', label: 'Kantong', icon: '✉️', render: () => <PocketsPage /> },
  { path: '/anggaran', label: 'Anggaran', icon: '🎯', render: () => <BudgetsPage /> },
  { path: '/tujuan', label: 'Tujuan', icon: '🌱', render: () => <GoalsPage /> },
  { path: '/laporan', label: 'Laporan', icon: '📊', render: () => <ReportsPage />, usesPeriod: true },
  { path: '/pengingat', label: 'Pengingat', icon: '🔔', render: () => <RemindersPage /> },
  { path: '/pengaturan', label: 'Pengaturan', icon: '⚙️', render: () => <SettingsPage /> },
];

const MOBILE_MAIN = ['/', '/transaksi', '/kantong', '/laporan'];

function PeriodPicker() {
  const { period, setPeriod } = useStore();
  return (
    <div className="row" role="group" aria-label="Periode">
      <label className="sr-only" htmlFor="period-preset">Periode</label>
      <select
        id="period-preset"
        className="select"
        style={{ width: 'auto', minWidth: 150 }}
        value={period.preset}
        onChange={(e) => setPeriod(e.target.value as PeriodPreset, { from: period.from, to: period.to })}
      >
        <option value="this-week">Minggu ini</option>
        <option value="this-month">Bulan ini</option>
        <option value="last-month">Bulan lalu</option>
        <option value="custom">Rentang khusus</option>
      </select>
      {period.preset === 'custom' && (
        <>
          <label className="sr-only" htmlFor="period-from">Dari</label>
          <input id="period-from" type="date" className="input" style={{ width: 'auto' }} value={period.from} onChange={(e) => e.target.value && setPeriod('custom', { from: e.target.value, to: period.to })} />
          <span aria-hidden="true">–</span>
          <label className="sr-only" htmlFor="period-to">Sampai</label>
          <input id="period-to" type="date" className="input" style={{ width: 'auto' }} value={period.to} onChange={(e) => e.target.value && setPeriod('custom', { from: period.from, to: e.target.value })} />
        </>
      )}
    </div>
  );
}

export function Shell() {
  const { path } = useRoute();
  const { ds, mode, today, period } = useStore();
  const session = useSession();
  const { openNew } = useTxUi();
  const [more, setMore] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  const overdue = reminderAgenda(ds, today).overdue.length;

  useEffect(() => {
    document.title = `${route.label} · Kantong`;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [route]);

  const navItem = (r: RouteDef) => (
    <a key={r.path} href={href(r.path)} aria-current={r.path === route.path ? 'page' : undefined}>
      <span className="nav__icon" aria-hidden="true">{r.icon}</span>
      {r.label}
      {r.path === '/pengingat' && overdue > 0 && <span className="badge badge--over" style={{ marginLeft: 'auto' }}>{overdue}<span className="sr-only"> terlewat</span></span>}
    </a>
  );

  return (
    <>
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>Lewati ke konten</a>
      {mode === 'demo' && (
        <div className="demo-banner" role="note">
          <span className="badge badge--demo">DATA DEMO</span>
          <span>Data fiktif, hanya di browser ini — terpisah dari catatan pribadi.</span>
          <button className="btn btn--sm" onClick={() => void session.resetDemo()}>Reset demo</button>
          <button className="btn btn--sm" onClick={() => session.leave()}>Keluar demo</button>
        </div>
      )}
      <div className="app">
        <aside className="sidebar" aria-label="Navigasi utama">
          <a className="brand" href={href('/')}>
            <BrandMark />
            <span>
              <span className="brand__name">Kantong</span>
              <span className="brand__tag" style={{ display: 'block' }}>Uang tertata, hidup lebih lega.</span>
            </span>
          </a>
          <nav className="nav">{ROUTES.map(navItem)}</nav>
          <div className="sidebar__foot">
            {mode === 'personal' ? (
              <>
                <span className="muted" style={{ overflowWrap: 'anywhere' }}>👤 {session.email}</span>
                <button className="btn btn--sm" onClick={() => void session.signOut()}>Keluar</button>
              </>
            ) : (
              <button className="btn btn--sm" onClick={() => session.leave()}>Mulai catatan pribadi</button>
            )}
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <a className="brand show-mobile" href={href('/')} aria-label="Kantong — beranda"><BrandMark size={30} /></a>
            <div className="topbar__title">
              <span className="mono hide-mobile">{route.usesPeriod ? periodLabel(period) : route.label}</span>
            </div>
            {route.usesPeriod && <PeriodPicker />}
            <button className="btn btn--primary hide-mobile" onClick={() => openNew()}>＋ Catat</button>
            <PrivacyToggle />
            <a className="btn btn--icon hide-mobile" href={href('/pengaturan')} aria-label="Pengaturan" title="Pengaturan">⚙️</a>
          </header>
          <main id="main" className="content" ref={mainRef} tabIndex={-1} style={{ outline: 'none' }}>
            {route.render()}
          </main>
        </div>
      </div>

      <button className="btn btn--primary fab" onClick={() => openNew()} aria-label="Catat transaksi">＋</button>
      <nav className="bottom-nav" aria-label="Navigasi bawah">
        {ROUTES.filter((r) => MOBILE_MAIN.includes(r.path)).map((r) => (
          <a key={r.path} href={href(r.path)} aria-current={r.path === route.path ? 'page' : undefined}>
            <span className="ico" aria-hidden="true">{r.icon}</span>{r.label}
          </a>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-current={!MOBILE_MAIN.includes(route.path) ? 'page' : undefined} aria-haspopup="dialog">
          <span className="ico" aria-hidden="true">☰</span>Lainnya{overdue > 0 && <span className="sr-only"> ({overdue} pengingat terlewat)</span>}
        </button>
      </nav>
      {more && (
        <Dialog title="Menu lainnya" icon="☰" tone="paper" onClose={() => setMore(false)}>
          <nav className="nav" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setMore(false); }}>
            {ROUTES.filter((r) => !MOBILE_MAIN.includes(r.path)).map(navItem)}
          </nav>
          <div className="stack" style={{ marginTop: 14 }}>
            {mode === 'personal' ? (
              <button className="btn" onClick={() => void session.signOut()}>Keluar ({session.email})</button>
            ) : (
              <button className="btn" onClick={() => session.leave()}>Keluar demo</button>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
