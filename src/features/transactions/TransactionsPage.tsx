import { useMemo, useState } from 'react';
import { downloadText } from '../../app/download';
import { navigate, useRoute, type Query } from '../../app/router';
import { useStore } from '../../app/store';
import { useUi } from '../../app/ui';
import { Amount, EmptyState, RetroWindow } from '../../components/ui';
import { transactionsCsv } from '../../domain/csv';
import { formatDate, formatRange, isValidDate } from '../../domain/dates';
import { BEHAVIOR_LABEL, PRIORITY_LABEL, TX_TYPE_LABEL } from '../../domain/defaults';
import { filterTransactions, totalsOf, type TxFilter } from '../../domain/ledger';
import { parseAmountInput } from '../../domain/money';
import type { Behavior, Priority, TxType } from '../../domain/types';
import { TxRow, txAmountValue, txIcon, txTitle } from './TxRow';
import { useTxUi } from './TxUi';

const PAGE = 50;
const list = (q: URLSearchParams, k: string) => (q.get(k) ?? '').split(',').filter(Boolean);

export function queryToFilter(q: URLSearchParams): TxFilter {
  const num = (k: string) => {
    const r = parseAmountInput(q.get(k) ?? '', { allowZero: true });
    return r.ok ? r.value : undefined;
  };
  return {
    from: isValidDate(q.get('from')) ? q.get('from')! : undefined,
    to: isValidDate(q.get('to')) ? q.get('to')! : undefined,
    types: list(q, 'type') as TxType[],
    categoryIds: list(q, 'cat'),
    accountIds: list(q, 'acc'),
    pocketIds: list(q, 'pocket'),
    priorities: list(q, 'prio') as (Priority | 'none')[],
    behaviors: list(q, 'beh') as (Behavior | 'none')[],
    q: q.get('q') ?? undefined,
    min: num('min'),
    max: num('max'),
    status: (['active', 'voided', 'all'].includes(q.get('status') ?? '') ? q.get('status') : 'active') as TxFilter['status'],
  };
}

export function TransactionsPage() {
  const { ds, fmt } = useStore();
  const { query } = useRoute();
  const { openDetail, openNew } = useTxUi();
  const { toast } = useUi();
  const [limit, setLimit] = useState(PAGE);
  const filter = useMemo(() => queryToFilter(query), [query]);
  const results = useMemo(() => filterTransactions(ds, filter), [ds, filter]);
  const totals = useMemo(() => totalsOf(results), [results]);
  const shown = results.slice(0, limit);

  const current: Query = Object.fromEntries(query.entries());
  const set = (patch: Query) => {
    setLimit(PAGE);
    const next = { ...current, ...patch };
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    navigate('/transaksi', next, { replace: true });
  };
  const toggleIn = (key: string, value: string) => {
    const cur = list(query, key);
    set({ [key]: (cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]).join(',') });
  };

  const name = (rows: { id: string; name: string }[], id: string) => rows.find((r) => r.id === id)?.name ?? id;
  const chips: { label: string; remove: () => void }[] = [];
  if (filter.from || filter.to) chips.push({ label: `Tanggal: ${filter.from ? formatDate(filter.from) : '…'} – ${filter.to ? formatDate(filter.to) : '…'}`, remove: () => set({ from: '', to: '' }) });
  filter.types?.forEach((t) => chips.push({ label: TX_TYPE_LABEL[t] ?? t, remove: () => toggleIn('type', t) }));
  filter.categoryIds?.forEach((c) => chips.push({ label: `Kategori: ${name(ds.categories, c)}`, remove: () => toggleIn('cat', c) }));
  filter.accountIds?.forEach((a) => chips.push({ label: `Rekening: ${name(ds.accounts, a)}`, remove: () => toggleIn('acc', a) }));
  filter.pocketIds?.forEach((p) => chips.push({ label: p === 'none' ? 'Tanpa kantong' : `Kantong: ${name(ds.pockets, p)}`, remove: () => toggleIn('pocket', p) }));
  filter.priorities?.forEach((p) => chips.push({ label: PRIORITY_LABEL[p], remove: () => toggleIn('prio', p) }));
  filter.behaviors?.forEach((b) => chips.push({ label: BEHAVIOR_LABEL[b], remove: () => toggleIn('beh', b) }));
  if (filter.min != null) chips.push({ label: `Min ${fmt(filter.min)}`, remove: () => set({ min: '' }) });
  if (filter.max != null) chips.push({ label: `Maks ${fmt(filter.max)}`, remove: () => set({ max: '' }) });
  if (filter.q) chips.push({ label: `Cari: “${filter.q}”`, remove: () => set({ q: '' }) });
  if (filter.status !== 'active') chips.push({ label: filter.status === 'voided' ? 'Hanya dibatalkan' : 'Termasuk dibatalkan', remove: () => set({ status: '' }) });

  const exportCsv = () => {
    const csv = transactionsCsv(ds, results, { from: filter.from, to: filter.to });
    const span = filter.from || filter.to ? `${filter.from ?? 'awal'}_${filter.to ?? 'akhir'}` : 'semua';
    downloadText(`kantong-transaksi-${span}.csv`, csv, 'text/csv');
    toast(`CSV berisi ${results.length} transaksi diunduh.`, 'success');
  };

  const fromRef = query.get('ref');
  return (
    <>
      <div className="page-head">
        <div>
          {fromRef && <button className="btn btn--sm btn--ghost" onClick={() => history.back()}>← Kembali ke {fromRef}</button>}
          <h1>Buku transaksi</h1>
          <p className="muted">Cari, saring, dan telusuri setiap catatan.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={exportCsv} disabled={results.length === 0}>⬇ Ekspor CSV</button>
          <button className="btn btn--primary" onClick={() => openNew()}>＋ Catat</button>
        </div>
      </div>

      <RetroWindow title="Saring" icon="🔎" tone="blue">
        <div className="stack">
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="f-q">Cari catatan atau tag</label>
              <input id="f-q" className="input" type="search" value={query.get('q') ?? ''} onChange={(e) => set({ q: e.target.value })} placeholder="mis. kantor, #pasar" />
            </div>
            <div className="field">
              <label htmlFor="f-from">Dari tanggal</label>
              <input id="f-from" className="input" type="date" value={query.get('from') ?? ''} onChange={(e) => set({ from: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="f-to">Sampai tanggal</label>
              <input id="f-to" className="input" type="date" value={query.get('to') ?? ''} onChange={(e) => set({ to: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <span className="field__label">Jenis</span>
            <div className="chips" role="group" aria-label="Jenis transaksi">
              {(['income', 'expense', 'transfer', 'refund'] as const).map((t) => (
                <button key={t} type="button" className="chip chip--toggle" aria-pressed={filter.types?.includes(t)} onClick={() => toggleIn('type', t)}>{TX_TYPE_LABEL[t]}</button>
              ))}
            </div>
          </div>
          <details>
            <summary className="mono" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Filter lanjutan</summary>
            <div className="form-grid" style={{ marginTop: 10 }}>
              <AddSelect id="f-cat" label="Tambah kategori" options={ds.categories.map((c) => [c.id, `${c.icon} ${c.name}${c.archivedAt ? ' (arsip)' : ''}`])} onAdd={(v) => toggleIn('cat', v)} />
              <AddSelect id="f-acc" label="Tambah rekening" options={ds.accounts.map((a) => [a.id, a.name])} onAdd={(v) => toggleIn('acc', v)} />
              <AddSelect id="f-pocket" label="Tambah kantong" options={[['none', 'Tanpa kantong'], ...ds.pockets.map((p) => [p.id, p.name] as [string, string])]} onAdd={(v) => toggleIn('pocket', v)} />
              <div className="field">
                <label htmlFor="f-status">Status</label>
                <select id="f-status" className="select" value={filter.status} onChange={(e) => set({ status: e.target.value === 'active' ? '' : e.target.value })}>
                  <option value="active">Aktif</option>
                  <option value="voided">Dibatalkan</option>
                  <option value="all">Semua</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-min">Nominal minimum</label>
                <input id="f-min" className="input" inputMode="numeric" value={query.get('min') ?? ''} onChange={(e) => set({ min: e.target.value.replace(/[^\d]/g, '') })} />
              </div>
              <div className="field">
                <label htmlFor="f-max">Nominal maksimum</label>
                <input id="f-max" className="input" inputMode="numeric" value={query.get('max') ?? ''} onChange={(e) => set({ max: e.target.value.replace(/[^\d]/g, '') })} />
              </div>
              <div className="field span-2">
                <span className="field__label">Prioritas & sifat</span>
                <div className="chips">
                  {(['need', 'want', 'none'] as const).map((p) => (
                    <button key={p} type="button" className="chip chip--toggle" aria-pressed={filter.priorities?.includes(p)} onClick={() => toggleIn('prio', p)}>{PRIORITY_LABEL[p]}</button>
                  ))}
                  {(['fixed', 'variable'] as const).map((b) => (
                    <button key={b} type="button" className="chip chip--toggle" aria-pressed={filter.behaviors?.includes(b)} onClick={() => toggleIn('beh', b)}>{BEHAVIOR_LABEL[b]}</button>
                  ))}
                </div>
              </div>
            </div>
          </details>
          {chips.length > 0 && (
            <div className="spread">
              <div className="chips" aria-label="Filter aktif">
                {chips.map((c, i) => (
                  <span key={i} className="chip">{c.label}<button type="button" onClick={c.remove} aria-label={`Hapus filter ${c.label}`}>✕</button></span>
                ))}
              </div>
              <button className="btn btn--sm" onClick={() => navigate('/transaksi', {}, { replace: true })}>Reset filter</button>
            </div>
          )}
        </div>
      </RetroWindow>

      <div className="grid grid--4 keep-2">
        <div className="money-card"><span className="money-card__label">Hasil</span><span className="money-card__value">{totals.count}</span><span className="money-card__sub">transaksi{filter.from || filter.to ? ` · ${formatRange(filter.from ?? filter.to!, filter.to ?? filter.from!)}` : ''}</span></div>
        <div className="money-card money-card--sage"><span className="money-card__label">Pemasukan</span><span className="money-card__value"><Amount value={totals.income} /></span></div>
        <div className="money-card money-card--coral"><span className="money-card__label">Pengeluaran bersih</span><span className="money-card__value"><Amount value={totals.netExpense} colored /></span><span className="money-card__sub">bruto {fmt(totals.grossExpense)} − refund {fmt(totals.refunds)}</span></div>
        <div className="money-card money-card--blue"><span className="money-card__label">Transfer</span><span className="money-card__value"><Amount value={totals.transfers} /></span><span className="money-card__sub">netral terhadap saldo total</span></div>
      </div>

      <RetroWindow title={`Transaksi (${results.length})`} icon="📒" tone="butter" flush>
        {results.length === 0 ? (
          <EmptyState title={ds.transactions.length ? 'Tidak ada yang cocok' : 'Belum ada transaksi'} action={!ds.transactions.length && <button className="btn btn--primary" onClick={() => openNew()}>Catat transaksi pertama</button>}>
            {ds.transactions.length ? 'Coba longgarkan filter atau reset.' : 'Catatan pertama Anda akan muncul di sini.'}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap hide-mobile" role="region" aria-label="Tabel transaksi" tabIndex={0}>
              <table className="table">
                <thead>
                  <tr><th>Tanggal</th><th>Keterangan</th><th>Jenis</th><th>Rekening</th><th>Kantong</th><th className="r">Nominal</th></tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id} className={`clickable ${t.status === 'voided' ? 'is-void' : ''}`} onClick={() => openDetail(t.id)}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDate(t.date)}</td>
                      <td>
                        <button className="link-btn" style={{ color: 'var(--ink)', textDecoration: 'none', textAlign: 'left' }} onClick={(e) => { e.stopPropagation(); openDetail(t.id); }}>
                          {txIcon(ds, t)} {txTitle(ds, t)}
                        </button>
                        {t.note && <div className="small muted">{t.note}</div>}
                      </td>
                      <td><span className={`badge badge--${t.type}`}>{TX_TYPE_LABEL[t.type]}</span>{t.status === 'voided' && <> <span className="badge badge--void">Batal</span></>}</td>
                      <td>{name(ds.accounts, t.accountId)}{t.destinationAccountId ? ` → ${name(ds.accounts, t.destinationAccountId)}` : ''}</td>
                      <td>{t.pocketId ? name(ds.pockets, t.pocketId) : t.type === 'expense' ? <span className="muted">—</span> : ''}</td>
                      <td className="r amt" style={{ fontWeight: 700 }}><Amount value={txAmountValue(t)} sign={t.type !== 'transfer'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="list show-mobile" style={{ padding: '4px 10px' }}>
              {shown.map((t) => <li key={t.id}><TxRow t={t} onOpen={openDetail} /></li>)}
            </ul>
            {results.length > limit && (
              <div className="row" style={{ justifyContent: 'center', padding: 14 }}>
                <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>Muat {Math.min(PAGE, results.length - limit)} lagi ({results.length - limit} tersisa)</button>
              </div>
            )}
          </>
        )}
      </RetroWindow>
    </>
  );
}

function AddSelect({ id, label, options, onAdd }: { id: string; label: string; options: [string, string][]; onAdd: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="select"
        value=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value);
        }}
      >
        <option value="">— pilih —</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
