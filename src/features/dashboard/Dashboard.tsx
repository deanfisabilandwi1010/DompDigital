import { useMemo } from 'react';
import { href, navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { CategoryBars, FlowChart } from '../../components/charts';
import { Amount, Illustration, Meter, MoneyCard, RetroWindow } from '../../components/ui';
import { formatDate, monthOf, periodLabel } from '../../domain/dates';
import { buildInsights } from '../../domain/insights';
import {
  budgetRows,
  cashflowSeries,
  expenseByCategory,
  filterTransactions,
  goalStatus,
  granularityFor,
  periodSummary,
  pocketBalances,
  totalBalance,
  unallocated,
} from '../../domain/ledger';
import { reminderAgenda } from '../../domain/reminders';
import { TxRow } from '../transactions/TxRow';
import { useTxUi } from '../transactions/TxUi';

const GRAN_LABEL = { day: 'harian', week: 'mingguan', month: 'bulanan' } as const;

export function Dashboard() {
  const { ds, period, today, fmt } = useStore();
  const { openNew, openDetail } = useTxUi();

  const total = useMemo(() => totalBalance(ds), [ds]);
  const un = useMemo(() => unallocated(ds), [ds]);
  const sum = useMemo(() => periodSummary(ds, period.from, period.to), [ds, period]);
  const series = useMemo(() => cashflowSeries(ds, period.from, period.to), [ds, period]);
  const gran = granularityFor(period.from, period.to);
  const cats = useMemo(() => expenseByCategory(ds, period.from, period.to), [ds, period]);
  const recent = useMemo(() => filterTransactions(ds, { from: period.from, to: period.to }).slice(0, 5), [ds, period]);
  const pocketBal = useMemo(() => pocketBalances(ds), [ds]);
  const budgets = useMemo(() => budgetRows(ds, monthOf(today)).filter((r) => r.state !== 'none').sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).slice(0, 4), [ds, today]);
  const agenda = useMemo(() => reminderAgenda(ds, today, { aheadDays: 14 }), [ds, today]);
  const insights = useMemo(() => buildInsights(ds, period, today, fmt), [ds, period, today, fmt]);
  const goal = ds.goals.map((g) => ({ g, s: goalStatus(ds, g.id, today)! })).sort((a, b) => Number(a.s.reached) - Number(b.s.reached) || b.s.pct - a.s.pct)[0];
  const hasTx = ds.transactions.length > 0;
  const name = ds.settings.displayName || 'Sobat Kantong';
  const drill = (q: Record<string, string>) => navigate('/transaksi', { from: period.from, to: period.to, ref: 'Beranda', ...q });
  const catMap = new Map(ds.categories.map((c) => [c.id, c]));

  return (
    <>
      <div className="page-head">
        <div>
          <p className="mono muted">{formatDate(today, { weekday: true })}</p>
          <h1>Halo, {name}</h1>
          <p className="muted">{periodLabel(period)}</p>
        </div>
        <div className="page-head__actions">
          <button className={`btn ${hasTx ? '' : 'btn--primary'}`} onClick={() => openNew()}>{hasTx ? '＋ Catat transaksi' : '✨ Catat transaksi pertama'}</button>
        </div>
      </div>

      {!hasTx && (
        <div className="window">
          <div className="window__body hero-strip">
            <Illustration name="mascot" size={120} className="bounce" />
            <div className="stack">
              <h2>Siap mencatat?</h2>
              <p className="muted">Mulai dengan satu transaksi. Saldo, kantong, anggaran, dan laporan akan langsung mengikuti.</p>
              <div><button className="btn btn--primary" onClick={() => openNew()}>✨ Catat transaksi pertama</button></div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid--4 keep-2">
        <MoneyCard label="Saldo tercatat sekarang" value={total} tone="butter" href={href('/rekening')} sub={`${ds.accounts.filter((a) => !a.archivedAt).length} rekening · tidak ikut filter periode`} />
        <MoneyCard label="Pemasukan periode" value={sum.income} tone="sage" onClick={() => drill({ type: 'income' })} sub="Lihat transaksi →" />
        <MoneyCard label="Pengeluaran bersih periode" value={sum.netExpense} tone="coral" onClick={() => drill({ type: 'expense,refund' })} sub={`bruto ${fmt(sum.grossExpense)} − refund ${fmt(sum.refunds)}`} />
        <MoneyCard label="Selisih periode" value={sum.diff} tone="blue" sign sub="pemasukan − pengeluaran bersih" />
      </div>

      <div className="grid grid--2-1">
        <RetroWindow title="Arus kas" icon="📈" tone="blue">
          <FlowChart
            data={series}
            description={`Pemasukan dan pengeluaran bersih ${GRAN_LABEL[gran]}, ${periodLabel(period).toLowerCase()}. Klik batang untuk melihat transaksinya.`}
            onSelect={(b) => navigate('/transaksi', { from: b.from, to: b.to, ref: 'Beranda' })}
          />
        </RetroWindow>
        <RetroWindow title="Pengeluaran per kategori" icon="🧩" tone="coral">
          <CategoryBars
            items={cats.slice(0, 7).map((c) => ({ key: c.categoryId, label: catMap.get(c.categoryId)?.name ?? '?', icon: catMap.get(c.categoryId)?.icon, value: c.net }))}
            total={sum.netExpense}
            description="Pengeluaran bersih per kategori dalam periode. Klik untuk menyaring transaksi."
            emptyText="Belum ada pengeluaran pada periode ini."
            onSelect={(i) => drill({ cat: i.key, type: 'expense,refund' })}
          />
          {cats.length > 7 && <p className="small muted" style={{ marginTop: 8 }}>+{cats.length - 7} kategori lain di <a href={href('/laporan')}>Laporan</a>.</p>}
        </RetroWindow>
      </div>

      <div className="grid grid--3">
        <RetroWindow title="Kantong · posisi sekarang" icon="✉️" tone="butter" actions={<a className="btn" href={href('/kantong')}>Kelola</a>}>
          <div className="stack">
            <div className="spread">
              <span>Dana belum dialokasikan</span>
              <strong><Amount value={un} colored /></strong>
            </div>
            {ds.pockets.filter((p) => !p.archivedAt).slice(0, 5).map((p) => (
              <div key={p.id} className="spread">
                <span>{p.icon} {p.name}</span>
                <strong><Amount value={pocketBal.get(p.id) ?? 0} colored /></strong>
              </div>
            ))}
            {ds.pockets.length === 0 && <p className="muted small">Belum ada kantong. Buat amplop virtual untuk memisahkan dana harian, tagihan, atau tabungan.</p>}
          </div>
        </RetroWindow>

        <RetroWindow title="Anggaran bulan ini" icon="🎯" tone="sage" actions={<a className="btn" href={href('/anggaran')}>Atur</a>}>
          {budgets.length === 0 ? (
            <p className="muted small">Belum ada anggaran bulan ini. Tetapkan batas untuk kategori yang ingin dijaga.</p>
          ) : (
            <div className="stack">
              {budgets.map((b) => {
                const c = catMap.get(b.categoryId);
                return (
                  <div key={b.budgetId} className="stack" style={{ gap: 4 }}>
                    <div className="spread small">
                      <span>{c?.icon} {c?.name}</span>
                      <span>{b.state === 'over' ? <span className="badge badge--over">Lewat {fmt(b.over)}</span> : b.state === 'warn' ? <span className="badge badge--warn">Mendekati batas</span> : `${b.pct}%`}</span>
                    </div>
                    <Meter pct={b.barPct} tone={b.state === 'over' ? 'over' : b.state === 'warn' ? 'warn' : undefined} label={`${c?.name}: ${b.pct}% dari anggaran`} />
                    <span className="small muted">{fmt(b.actual)} dari {fmt(b.limit)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </RetroWindow>

        <RetroWindow title="Tujuan tabungan" icon="🌱" tone="lilac" actions={<a className="btn" href={href('/tujuan')}>Lihat</a>}>
          {goal ? (
            <div className="hero-strip">
              <Illustration name="jar" size={84} />
              <div className="stack" style={{ flex: 1, minWidth: 0, gap: 6 }}>
                <strong>{goal.g.icon} {goal.g.name}</strong>
                <Meter pct={goal.s.barPct} tone="lilac" label={`Progres ${goal.g.name}`} />
                <span className="small"><Amount value={goal.s.saved} /> dari {fmt(goal.g.targetAmount)} · {goal.s.pct}%</span>
                {goal.s.reached ? <span className="badge badge--income">Tercapai 🎉</span> : goal.s.perMonth != null ? <span className="small muted">±{fmt(goal.s.perMonth)}/bulan hingga tenggat</span> : null}
              </div>
            </div>
          ) : (
            <p className="muted small">Belum ada tujuan. Tujuan membaca saldo satu kantong khusus.</p>
          )}
        </RetroWindow>
      </div>

      <div className="grid grid--2-1">
        <RetroWindow title="Transaksi terbaru dalam periode" icon="🧾" tone="paper" actions={<a className="btn" href={href('/transaksi', { from: period.from, to: period.to })}>Semua</a>}>
          {recent.length === 0 ? (
            <p className="muted">Belum ada transaksi pada periode ini.</p>
          ) : (
            <ul className="list">{recent.map((t) => <li key={t.id}><TxRow t={t} onOpen={openDetail} /></li>)}</ul>
          )}
        </RetroWindow>
        <div className="stack" style={{ gap: 20 }}>
          <RetroWindow title="Pengingat terdekat" icon="🔔" tone="butter" actions={<a className="btn" href={href('/pengingat')}>Buka</a>}>
            {agenda.overdue.length + agenda.upcoming.length === 0 ? (
              <p className="muted small">Tidak ada jadwal dalam 14 hari ke depan.</p>
            ) : (
              <ul className="list small">
                {[...agenda.overdue, ...agenda.upcoming].slice(0, 4).map((i) => (
                  <li key={i.reminder.id + i.dueDate} className="spread" style={{ padding: '8px 0' }}>
                    <span>{i.overdue && <span className="badge badge--over">Terlewat</span>} {i.reminder.name} · {formatDate(i.dueDate, { year: false })}</span>
                    <strong><Amount value={i.reminder.amount} /></strong>
                  </li>
                ))}
              </ul>
            )}
          </RetroWindow>
          <RetroWindow title="Catatan singkat" icon="💡" tone="sage">
            <ul className="insights">
              {insights.map((i) => (
                <li key={i.id} className={i.tone}>
                  <span className="ic" aria-hidden="true">{i.tone === 'warn' ? '!' : i.tone === 'good' ? '✓' : '›'}</span>
                  <span>
                    {i.text}{' '}
                    {i.link && <a href={href(i.link.path, { ...i.link.query, ref: 'Beranda' })}>Detail</a>}
                  </span>
                </li>
              ))}
            </ul>
          </RetroWindow>
        </div>
      </div>
    </>
  );
}
