import { useMemo, useState } from 'react';
import { downloadText } from '../../app/download';
import { href, navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { useUi } from '../../app/ui';
import { CategoryBars, FlowChart } from '../../components/charts';
import { Amount, Illustration, Meter, RetroWindow } from '../../components/ui';
import { transactionsCsv } from '../../domain/csv';
import { formatRange, monthEnd, monthOf, monthStart, periodLabel } from '../../domain/dates';
import { BEHAVIOR_LABEL, PRIORITY_LABEL } from '../../domain/defaults';
import {
  accountReport,
  budgetRows,
  cashflowSeries,
  expenseByCategory,
  expenseSplit,
  filterTransactions,
  goalStatus,
  granularityFor,
  incomeByCategory,
  periodSummary,
  pocketReport,
  type Granularity,
} from '../../domain/ledger';
import { percent } from '../../domain/money';

const GRAN = { day: 'Harian', week: 'Mingguan', month: 'Bulanan' } as const;

export function ReportsPage() {
  const { ds, period, today, fmt } = useStore();
  const { toast } = useUi();
  const [gran, setGran] = useState<Granularity | 'auto'>('auto');
  const { from, to } = period;
  const g = gran === 'auto' ? granularityFor(from, to) : gran;
  const s = useMemo(() => periodSummary(ds, from, to), [ds, from, to]);
  const cats = useMemo(() => expenseByCategory(ds, from, to), [ds, from, to]);
  const incomes = useMemo(() => incomeByCategory(ds, from, to), [ds, from, to]);
  const series = useMemo(() => cashflowSeries(ds, from, to, g), [ds, from, to, g]);
  const prio = useMemo(() => expenseSplit(ds, from, to, 'priority'), [ds, from, to]);
  const beh = useMemo(() => expenseSplit(ds, from, to, 'behavior'), [ds, from, to]);
  const accRows = useMemo(() => accountReport(ds, from, to), [ds, from, to]);
  const pocRows = useMemo(() => pocketReport(ds, from, to), [ds, from, to]);
  const singleMonth = monthOf(from) === monthOf(to) && from === monthStart(monthOf(from)) && to === monthEnd(monthOf(from));
  const budgets = useMemo(() => (singleMonth ? new Map(budgetRows(ds, monthOf(from)).map((b) => [b.categoryId, b])) : null), [ds, from, singleMonth]);
  const cat = (id: string) => ds.categories.find((c) => c.id === id);
  const tx = (q: Record<string, string>) => href('/transaksi', { from, to, ref: 'Laporan', ...q });

  const exportCsv = () => {
    const list = filterTransactions(ds, { from, to, status: 'all' });
    downloadText(`kantong-laporan-${from}_${to}.csv`, transactionsCsv(ds, list, { from, to }), 'text/csv');
    toast(`CSV ${list.length} transaksi (termasuk yang dibatalkan, ditandai statusnya) diunduh.`, 'success');
  };

  return (
    <>
      <div className="page-head">
        <div className="hero-strip">
          <Illustration name="crt" size={110} />
          <div>
            <h1>Laporan</h1>
            <p className="muted">{periodLabel(period)} · ubah periode di bagian atas.</p>
            <p className="print-only">Kantong — laporan {formatRange(from, to)}</p>
          </div>
        </div>
        <div className="page-head__actions no-print">
          <button className="btn" onClick={exportCsv}>⬇ Ekspor CSV</button>
          <button className="btn" onClick={() => window.print()} title="Gunakan “Simpan sebagai PDF” di dialog cetak browser">🖨 Cetak / PDF</button>
        </div>
      </div>

      <RetroWindow title="1 · Ringkasan periode" icon="🧾" tone="butter">
        <div className="grid grid--2">
          <dl className="kv">
            <dt>Saldo awal ({formatRange(from, from)}, sebelum hari pertama)</dt><dd className="r"><Amount value={s.startBalance} colored /></dd>
            <dt><a href={tx({ type: 'income' })}>Pemasukan</a></dt><dd className="r"><Amount value={s.income} /></dd>
            <dt><a href={tx({ type: 'expense' })}>Pengeluaran bruto</a></dt><dd className="r"><Amount value={s.grossExpense} /></dd>
            <dt><a href={tx({ type: 'refund' })}>Pengembalian dana</a></dt><dd className="r"><Amount value={s.refunds} /></dd>
            <dt><strong>Pengeluaran bersih</strong></dt><dd className="r"><strong><Amount value={s.netExpense} colored /></strong></dd>
            <dt><strong>Selisih</strong></dt><dd className="r"><strong><Amount value={s.diff} sign colored /></strong></dd>
          </dl>
          <dl className="kv">
            <dt>Saldo pembukaan rekening baru</dt><dd className="r"><Amount value={s.openings} /></dd>
            <dt><a href={href('/rekening')}>Penyesuaian rekonsiliasi</a></dt><dd className="r"><Amount value={s.adjustments} sign colored /></dd>
            <dt><strong>Saldo akhir ({formatRange(to, to)})</strong></dt><dd className="r"><strong><Amount value={s.endBalance} colored /></strong></dd>
            <dt>Jumlah transaksi</dt><dd className="r">{s.txCount}</dd>
          </dl>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          Saldo akhir = saldo awal + selisih + pembukaan baru + penyesuaian. Saldo pembukaan dan rekonsiliasi bukan pemasukan; transfer antar rekening dan alokasi kantong netral terhadap saldo total. Refund tidak dihitung sebagai pendapatan.
        </p>
      </RetroWindow>

      <RetroWindow title="2 · Rincian kategori" icon="🧩" tone="coral" flush>
        <div className="table-wrap" role="region" aria-label="Rincian kategori pengeluaran" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th>Kategori</th><th className="r">Bruto</th><th className="r">Refund</th><th className="r">Bersih</th><th className="r">Porsi</th>
                {budgets && <><th className="r">Anggaran</th><th className="r">Selisih anggaran</th></>}
              </tr>
            </thead>
            <tbody>
              {cats.length === 0 && <tr><td colSpan={budgets ? 7 : 5} className="muted">Belum ada pengeluaran pada periode ini.</td></tr>}
              {cats.map((r) => {
                const b = budgets?.get(r.categoryId);
                const share = percent(r.net, s.netExpense);
                return (
                  <tr key={r.categoryId}>
                    <td><a href={tx({ cat: r.categoryId, type: 'expense,refund' })}>{cat(r.categoryId)?.icon} {cat(r.categoryId)?.name}</a></td>
                    <td className="r">{fmt(r.gross)}</td>
                    <td className="r">{fmt(r.refunds)}</td>
                    <td className="r"><strong>{fmt(r.net)}</strong></td>
                    <td className="r">{share != null && r.net > 0 ? `${share}%` : '—'}</td>
                    {budgets && <><td className="r">{b && b.limit > 0 ? fmt(b.limit) : '—'}</td><td className="r">{b && b.limit > 0 ? fmt(b.remaining) : '—'}</td></>}
                  </tr>
                );
              })}
            </tbody>
            {cats.length > 0 && (
              <tfoot>
                <tr><td>Total</td><td className="r">{fmt(s.grossExpense)}</td><td className="r">{fmt(s.refunds)}</td><td className="r">{fmt(s.netExpense)}</td><td className="r">{s.netExpense > 0 ? '100%' : '—'}</td>{budgets && <><td /><td /></>}</tr>
              </tfoot>
            )}
          </table>
        </div>
        {!budgets && <p className="small muted" style={{ padding: '10px 16px' }}>Kolom anggaran tampil bila periode tepat satu bulan kalender.</p>}
        {incomes.length > 0 && (
          <div style={{ padding: 16 }}>
            <h3 style={{ marginBottom: 8 }}>Pemasukan per kategori</h3>
            <ul className="list">
              {incomes.map((r) => (
                <li key={r.categoryId} className="spread" style={{ padding: '6px 0' }}>
                  <a href={tx({ cat: r.categoryId, type: 'income' })}>{cat(r.categoryId)?.icon} {cat(r.categoryId)?.name}</a>
                  <strong><Amount value={r.net} /></strong>
                </li>
              ))}
            </ul>
          </div>
        )}
      </RetroWindow>

      <RetroWindow title="3 · Tren pemasukan & pengeluaran" icon="📈" tone="blue" actions={
        <select className="select" aria-label="Granularitas" value={gran} onChange={(e) => setGran(e.target.value as Granularity | 'auto')} style={{ minHeight: 32, padding: '2px 8px', width: 'auto' }}>
          <option value="auto">Otomatis ({GRAN[granularityFor(from, to)]})</option>
          <option value="day">Harian</option>
          <option value="week">Mingguan</option>
          <option value="month">Bulanan</option>
        </select>
      }>
        <FlowChart data={series} description={`Tren ${GRAN[g].toLowerCase()} ${formatRange(from, to)}. Klik batang untuk menelusuri transaksi.`} onSelect={(b) => navigate('/transaksi', { from: b.from, to: b.to, ref: 'Laporan' })} />
      </RetroWindow>

      <div className="grid grid--2">
        <RetroWindow title="4a · Kebutuhan vs keinginan" icon="⚖️" tone="sage">
          <CategoryBars
            items={prio.map((p) => ({ key: p.key, label: PRIORITY_LABEL[p.key], value: p.net }))}
            total={s.netExpense}
            description="Pengeluaran bersih menurut prioritas."
            emptyText="Belum ada pengeluaran."
            onSelect={(i) => navigate('/transaksi', { from, to, prio: i.key, type: 'expense,refund', ref: 'Laporan' })}
          />
        </RetroWindow>
        <RetroWindow title="4b · Tetap vs variabel" icon="📐" tone="lilac">
          <CategoryBars
            items={beh.map((p) => ({ key: p.key, label: BEHAVIOR_LABEL[p.key], value: p.net }))}
            total={s.netExpense}
            description="Pengeluaran bersih menurut sifat belanja."
            emptyText="Belum ada pengeluaran."
            onSelect={(i) => navigate('/transaksi', { from, to, beh: i.key, type: 'expense,refund', ref: 'Laporan' })}
          />
        </RetroWindow>
      </div>

      <RetroWindow title="5 · Rekening" icon="🏦" tone="blue" flush>
        <div className="table-wrap" role="region" aria-label="Laporan rekening" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Rekening</th><th className="r">Saldo awal</th><th className="r">Pembukaan</th><th className="r">Masuk</th><th className="r">Keluar</th><th className="r">Transfer masuk</th><th className="r">Transfer keluar</th><th className="r">Penyesuaian</th><th className="r">Saldo akhir</th></tr></thead>
            <tbody>
              {accRows.map((r) => (
                <tr key={r.account.id}>
                  <td><a href={tx({ acc: r.account.id })}>{r.account.name}</a>{r.account.archivedAt && <span className="muted"> (arsip)</span>}</td>
                  <td className="r">{fmt(r.start)}</td><td className="r">{fmt(r.opening)}</td><td className="r">{fmt(r.inflow)}</td><td className="r">{fmt(r.outflow)}</td>
                  <td className="r">{fmt(r.transferIn)}</td><td className="r">{fmt(r.transferOut)}</td><td className="r">{fmt(r.adjustments)}</td><td className="r"><strong>{fmt(r.end)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ padding: '10px 16px' }}>Masuk = pemasukan + pengembalian dana; keluar = pengeluaran termasuk biaya transfer.</p>
      </RetroWindow>

      <RetroWindow title="6 · Kantong" icon="✉️" tone="butter" flush>
        <div className="table-wrap" role="region" aria-label="Laporan kantong" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Kantong</th><th className="r">Saldo awal</th><th className="r">Alokasi masuk</th><th className="r">Alokasi keluar</th><th className="r">Pemakaian</th><th className="r">Pengembalian</th><th className="r">Saldo akhir</th></tr></thead>
            <tbody>
              {pocRows.length === 0 && <tr><td colSpan={7} className="muted">Belum ada kantong.</td></tr>}
              {pocRows.map((r) => {
                const p = ds.pockets.find((x) => x.id === r.pocketId)!;
                return (
                  <tr key={r.pocketId}>
                    <td><a href={tx({ pocket: r.pocketId })}>{p.icon} {p.name}</a>{p.archivedAt && <span className="muted"> (arsip)</span>}</td>
                    <td className="r">{fmt(r.start)}</td><td className="r">{fmt(r.allocIn)}</td><td className="r">{fmt(r.allocOut)}</td><td className="r">{fmt(r.spent)}</td><td className="r">{fmt(r.refunded)}</td><td className="r"><strong>{fmt(r.end)}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ padding: '10px 16px' }}>Alokasi adalah pemindahan dana virtual — bukan belanja. Pemakaian = pengeluaran yang diambil dari kantong.</p>
      </RetroWindow>

      <RetroWindow title="7 · Tujuan" icon="🌱" tone="lilac">
        {ds.goals.length === 0 ? <p className="muted small">Belum ada tujuan.</p> : (
          <div className="stack">
            {ds.goals.map((goal) => {
              const st = goalStatus(ds, goal.id, today)!;
              return (
                <div key={goal.id} className="stack" style={{ gap: 4 }}>
                  <div className="spread small"><strong>{goal.icon} {goal.name}</strong><span>{fmt(st.saved)} / {fmt(goal.targetAmount)} · {st.reached ? 'tercapai' : `kurang ${fmt(st.remaining)}`}</span></div>
                  <Meter pct={st.barPct} tone="lilac" label={`Progres ${goal.name}: ${st.pct}%`} />
                </div>
              );
            })}
            <p className="small muted">Posisi sekarang, dibaca dari saldo kantong masing-masing.</p>
          </div>
        )}
      </RetroWindow>
    </>
  );
}
