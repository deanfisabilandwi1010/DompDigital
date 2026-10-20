import { useMemo, useState, type FormEvent } from 'react';
import { href } from '../../app/router';
import { errorMessage, useCommit, useStore } from '../../app/store';
import { useUi } from '../../app/ui';
import { Dialog } from '../../components/Dialog';
import { Amount, AmountInput, amountToInput, EmptyState, Field, Meter, RetroWindow } from '../../components/ui';
import { planCopyBudgets, planDeleteBudget, planSetBudget } from '../../domain/commands';
import { addMonthsToMonth, formatMonth, monthEnd, monthOf, monthStart } from '../../domain/dates';
import { budgetRows, expenseByCategory, type BudgetRow } from '../../domain/ledger';
import { parseAmountInput } from '../../domain/money';
import type { ID } from '../../domain/types';

export function BudgetsPage() {
  const { ds, today, fmt } = useStore();
  const { act } = useCommit();
  const { confirm } = useUi();
  const [month, setMonth] = useState(monthOf(today));
  const [form, setForm] = useState<{ categoryId?: ID; limit?: number } | null>(null);
  const rows = useMemo(() => budgetRows(ds, month), [ds, month]);
  const spent = useMemo(() => expenseByCategory(ds, monthStart(month), monthEnd(month)), [ds, month]);
  const cat = (id: ID) => ds.categories.find((c) => c.id === id);
  const unbudgeted = spent.filter((s) => !rows.some((r) => r.categoryId === s.categoryId) && s.net !== 0);
  const totalLimit = rows.reduce((a, r) => a + r.limit, 0);
  const totalActual = rows.reduce((a, r) => a + r.actual, 0);
  const prevMonth = addMonthsToMonth(month, -1);
  const prevCount = ds.budgets.filter((b) => b.month === prevMonth).length;

  const status = (r: BudgetRow) => {
    if (r.state === 'none') return <span className="badge">Tidak ada anggaran</span>;
    if (r.state === 'over') return <span className="badge badge--over">Lewat {fmt(r.over)} · {r.pct}%</span>;
    if (r.state === 'warn') return <span className="badge badge--warn">Mendekati batas · {r.pct}%</span>;
    return <span className="badge badge--income">{r.pct}% terpakai</span>;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Anggaran</h1>
          <p className="muted">Batas pengeluaran per kategori per bulan. Realisasi = pengeluaran − pengembalian dana. Tidak ada rollover otomatis.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" disabled={prevCount === 0} onClick={() => act((d, c) => planCopyBudgets(d, prevMonth, month, c), `Batas dari ${formatMonth(prevMonth)} disalin.`)}>
            ⧉ Salin dari {formatMonth(prevMonth)}
          </button>
          <button className="btn btn--primary" onClick={() => setForm({})}>＋ Tetapkan anggaran</button>
        </div>
      </div>

      <div className="row" role="group" aria-label="Pilih bulan">
        <button className="btn btn--icon" aria-label="Bulan sebelumnya" onClick={() => setMonth(addMonthsToMonth(month, -1))}>‹</button>
        <h2 style={{ minWidth: 190, textAlign: 'center' }} aria-live="polite">{formatMonth(month)}</h2>
        <button className="btn btn--icon" aria-label="Bulan berikutnya" onClick={() => setMonth(addMonthsToMonth(month, 1))}>›</button>
        {month !== monthOf(today) && <button className="btn btn--sm" onClick={() => setMonth(monthOf(today))}>Bulan ini</button>}
      </div>

      {rows.length > 0 && (
        <div className="grid grid--3">
          <div className="money-card money-card--sage"><span className="money-card__label">Total batas</span><span className="money-card__value"><Amount value={totalLimit} /></span></div>
          <div className="money-card money-card--coral"><span className="money-card__label">Realisasi kategori beranggaran</span><span className="money-card__value"><Amount value={totalActual} colored /></span></div>
          <div className="money-card money-card--butter"><span className="money-card__label">Sisa</span><span className="money-card__value"><Amount value={totalLimit - totalActual} colored /></span></div>
        </div>
      )}

      <RetroWindow title={`Anggaran ${formatMonth(month)}`} icon="🎯" tone="sage">
        {rows.length === 0 ? (
          <EmptyState title="Belum ada anggaran bulan ini" action={<button className="btn btn--primary" onClick={() => setForm({})}>Tetapkan anggaran</button>}>
            {prevCount > 0 ? `Anda bisa menyalin ${prevCount} batas dari ${formatMonth(prevMonth)}.` : 'Pilih kategori yang ingin dijaga dan tetapkan batasnya.'}
          </EmptyState>
        ) : (
          <ul className="list">
            {rows.map((r) => {
              const c = cat(r.categoryId);
              return (
                <li key={r.budgetId} style={{ padding: '12px 0' }}>
                  <div className="stack" style={{ gap: 6 }}>
                    <div className="spread">
                      <strong>{c?.icon} {c?.name}{c?.archivedAt ? ' (arsip)' : ''}</strong>
                      {status(r)}
                    </div>
                    {r.state !== 'none' && <Meter pct={r.barPct} tone={r.state === 'over' ? 'over' : r.state === 'warn' ? 'warn' : undefined} label={`${c?.name}: ${r.pct}% dari anggaran`} />}
                    <div className="spread small">
                      <span>
                        <a href={href('/transaksi', { cat: r.categoryId, from: monthStart(month), to: monthEnd(month), type: 'expense,refund', ref: 'Anggaran' })}>Realisasi {fmt(r.actual)}</a>
                        {r.limit > 0 && <> dari {fmt(r.limit)} · {r.remaining >= 0 ? `sisa ${fmt(r.remaining)}` : `kelebihan ${fmt(-r.remaining)}`}</>}
                        {r.actual < 0 && <span className="muted"> · pengembalian dana melebihi pengeluaran bulan ini</span>}
                      </span>
                      <span className="row">
                        <button className="btn btn--sm" onClick={() => setForm({ categoryId: r.categoryId, limit: r.limit })}>Ubah</button>
                        <button className="btn btn--sm btn--ghost" onClick={async () => {
                          if (await confirm({ title: 'Hapus anggaran?', body: `Batas ${c?.name} untuk ${formatMonth(month)} dihapus. Transaksi tidak terpengaruh.`, confirmLabel: 'Hapus', danger: true })) {
                            await act((d, x) => planDeleteBudget(d, r.budgetId, x), 'Anggaran dihapus.');
                          }
                        }}>Hapus</button>
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </RetroWindow>

      {unbudgeted.length > 0 && (
        <RetroWindow title="Pengeluaran tanpa anggaran" icon="📌" tone="paper">
          <ul className="list">
            {unbudgeted.map((s) => (
              <li key={s.categoryId} className="spread" style={{ padding: '8px 0' }}>
                <span>{cat(s.categoryId)?.icon} {cat(s.categoryId)?.name}</span>
                <span className="row"><Amount value={s.net} colored />{cat(s.categoryId) && !cat(s.categoryId)!.archivedAt && <button className="btn btn--sm" onClick={() => setForm({ categoryId: s.categoryId })}>Beri batas</button>}</span>
              </li>
            ))}
          </ul>
        </RetroWindow>
      )}

      {form && <BudgetForm month={month} initial={form} onClose={() => setForm(null)} />}
    </>
  );
}

function BudgetForm({ month, initial, onClose }: { month: string; initial: { categoryId?: ID; limit?: number }; onClose: () => void }) {
  const { ds } = useStore();
  const { commit, busy } = useCommit();
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '');
  const [limit, setLimit] = useState(amountToInput(initial.limit));
  const [err, setErr] = useState<string | null>(null);
  const taken = new Set(ds.budgets.filter((b) => b.month === month).map((b) => b.categoryId));
  const options = ds.categories.filter((c) => c.kind === 'expense' && !c.archivedAt && (!taken.has(c.id) || c.id === initial.categoryId));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = parseAmountInput(limit || '0', { allowZero: true });
    if (!categoryId) return setErr('Pilih kategori.');
    if (!amt.ok) return setErr(amt.error);
    try {
      if (await commit((d, c) => planSetBudget(d, { month, categoryId, limitAmount: amt.value }, c), 'Anggaran disimpan.')) onClose();
    } catch (x) {
      setErr(errorMessage(x));
    }
  };
  return (
    <Dialog title={`Anggaran ${formatMonth(month)}`} icon="🎯" tone="sage" onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="stack" noValidate>
        {err && <div className="error-summary" role="alert">{err}</div>}
        <Field label="Kategori pengeluaran" htmlFor="b-cat">
          <select id="b-cat" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!!initial.categoryId}>
            <option value="">— Pilih kategori —</option>
            {options.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </Field>
        <Field label="Batas per bulan" htmlFor="b-limit" hint="Batas 0 ditampilkan sebagai “Tidak ada anggaran”.">
          <AmountInput id="b-limit" value={limit} onChange={setLimit} autoFocus={!!initial.categoryId} />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </Dialog>
  );
}
