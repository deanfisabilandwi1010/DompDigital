import { useMemo, useState, type FormEvent } from 'react';
import { href } from '../../app/router';
import { errorMessage, useCommit, useStore } from '../../app/store';
import { useUi } from '../../app/ui';
import { Dialog } from '../../components/Dialog';
import { Amount, AmountInput, EmptyState, Field, Illustration, RetroWindow } from '../../components/ui';
import { planAllocate, planArchivePocket, planSavePocket, planUnvoidAllocation, planVoidAllocation } from '../../domain/commands';
import { formatDate } from '../../domain/dates';
import { PALETTE, POCKET_SUGGESTIONS, SWATCHES } from '../../domain/defaults';
import { pocketBalances, unallocated } from '../../domain/ledger';
import { parseAmountInput } from '../../domain/money';
import type { ID, Pocket } from '../../domain/types';

type AllocMode = { from: ID | null; to: ID | null };

export function PocketsPage() {
  const { ds, fmt } = useStore();
  const { act } = useCommit();
  const { confirm } = useUi();
  const [form, setForm] = useState<Pocket | 'new' | null>(null);
  const [alloc, setAlloc] = useState<AllocMode | null>(null);
  const [activity, setActivity] = useState<ID | null>(null);
  const bal = useMemo(() => pocketBalances(ds), [ds]);
  const un = useMemo(() => unallocated(ds), [ds]);
  const active = ds.pockets.filter((p) => !p.archivedAt);
  const archived = ds.pockets.filter((p) => p.archivedAt);
  const inPockets = [...bal.values()].reduce((a, b) => a + b, 0);
  const goalOf = (id: ID) => ds.goals.find((g) => g.pocketId === id);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Kantong</h1>
          <p className="muted">Amplop virtual untuk tujuan penggunaan uang. Kantong membagi saldo total — tidak menambah aset baru.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => setAlloc({ from: null, to: null })} disabled={active.length === 0}>⇄ Alokasikan</button>
          <button className="btn btn--primary" onClick={() => setForm('new')}>＋ Kantong baru</button>
        </div>
      </div>

      <div className="grid grid--3">
        <div className="money-card money-card--sage">
          <span className="money-card__label">Dana belum dialokasikan</span>
          <span className="money-card__value"><Amount value={un} colored /></span>
          <span className="money-card__sub">{un < 0 ? 'Defisit: alokasi kantong melebihi saldo total.' : 'Siap dibagi ke kantong.'}</span>
        </div>
        <div className="money-card money-card--butter">
          <span className="money-card__label">Total di kantong</span>
          <span className="money-card__value"><Amount value={inPockets} colored /></span>
          <span className="money-card__sub">termasuk kantong arsip</span>
        </div>
        <div className="money-card">
          <span className="money-card__label">Saldo total</span>
          <span className="money-card__value"><Amount value={un + inPockets} colored /></span>
          <span className="money-card__sub">= kantong + belum dialokasikan</span>
        </div>
      </div>

      {active.length === 0 ? (
        <RetroWindow title="Kantong" icon="✉️" tone="butter">
          <EmptyState title="Belum ada kantong" action={<button className="btn btn--primary" onClick={() => setForm('new')}>Buat kantong pertama</button>}>
            Contoh: Harian, Tagihan, Dana darurat. Tidak ada persentase alokasi yang dipaksakan.
          </EmptyState>
        </RetroWindow>
      ) : (
        <div className="grid grid--3">
          {active.map((p) => {
            const b = bal.get(p.id) ?? 0;
            const g = goalOf(p.id);
            return (
              <article key={p.id} className="envelope" style={{ ['--env' as string]: p.color }}>
                <span className="envelope__tab">{p.name}</span>
                <div className="envelope__body">
                  <div className="envelope__content">
                    <div className="spread">
                      <span className="envelope__icon" aria-hidden="true">{p.icon}</span>
                      <button className="btn btn--sm btn--ghost btn--icon" aria-label={`Edit kantong ${p.name}`} onClick={() => setForm(p)}>✏️</button>
                    </div>
                    <span className="envelope__amount"><Amount value={b} colored /></span>
                    {g && <span className="small muted">🎯 Terhubung ke tujuan “{g.name}”</span>}
                    {b < 0 && <span className="small neg">Defisit — alokasikan dana untuk menutupnya.</span>}
                    <div className="envelope__actions">
                      <button className="btn btn--sm btn--butter" onClick={() => setAlloc({ from: null, to: p.id })}>Alokasikan</button>
                      <button className="btn btn--sm" onClick={() => setAlloc({ from: p.id, to: null })}>Pindahkan</button>
                      <button className="btn btn--sm" onClick={() => setActivity(p.id)}>Lihat aktivitas</button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <RetroWindow title="Riwayat alokasi" icon="🗂️" tone="paper">
        <AllocationList />
      </RetroWindow>

      {archived.length > 0 && (
        <RetroWindow title="Kantong arsip" icon="🗄️" tone="paper">
          <ul className="list">
            {archived.map((p) => (
              <li key={p.id} className="spread" style={{ padding: '10px 0' }}>
                <span>{p.icon} {p.name} · <Amount value={bal.get(p.id) ?? 0} colored /></span>
                <span className="row">
                  {(bal.get(p.id) ?? 0) > 0 && <button className="btn btn--sm" onClick={() => setAlloc({ from: p.id, to: null })}>Pindahkan dana</button>}
                  <button className="btn btn--sm" onClick={() => act((d, c) => planArchivePocket(d, p.id, false, c), `${p.name} aktif kembali.`)}>Aktifkan</button>
                </span>
              </li>
            ))}
          </ul>
        </RetroWindow>
      )}

      {form && (
        <PocketForm
          pocket={form === 'new' ? undefined : form}
          onClose={() => setForm(null)}
          onArchive={async (p) => {
            if (await confirm({ title: `Arsipkan ${p.name}?`, body: 'Kantong arsip tetap menyimpan riwayat dan pengembalian dana historis, dan dapat diaktifkan kembali. Saldo harus Rp0.', confirmLabel: 'Arsipkan' })) {
              if (await act((d, c) => planArchivePocket(d, p.id, true, c), `${p.name} diarsipkan.`)) setForm(null);
            }
          }}
        />
      )}
      {alloc && <AllocateForm initial={alloc} onClose={() => setAlloc(null)} />}
      {activity && <PocketActivity pocketId={activity} onClose={() => setActivity(null)} fmt={fmt} />}
    </>
  );
}

function AllocationList() {
  const { ds, fmt } = useStore();
  const { act } = useCommit();
  const { confirm } = useUi();
  const rows = [...ds.allocations].sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1)).slice(0, 30);
  const pn = (id: ID | null) => (id ? (ds.pockets.find((p) => p.id === id)?.name ?? '?') : 'Belum dialokasikan');
  if (rows.length === 0) return <p className="muted small">Alokasi memindahkan dana virtual antar kantong. Alokasi bukan belanja dan tidak mengubah saldo total.</p>;
  return (
    <ul className="list">
      {rows.map((a) => (
        <li key={a.id} className="spread" style={{ padding: '10px 0' }}>
          <span>
            {formatDate(a.date)} · {pn(a.fromPocketId)} → <strong>{pn(a.toPocketId)}</strong>
            {a.note && <span className="muted"> · {a.note}</span>}
            {a.status === 'voided' && <> <span className="badge badge--void">Batal</span></>}
          </span>
          <span className="row">
            <strong><Amount value={a.amount} /></strong>
            {a.status === 'active' ? (
              <button className="btn btn--sm btn--ghost" onClick={async () => {
                if (await confirm({ title: 'Batalkan alokasi?', body: `Alokasi ${fmt(a.amount)} dari ${pn(a.fromPocketId)} ke ${pn(a.toPocketId)} (${formatDate(a.date)}) akan dibatalkan.`, danger: true, confirmLabel: 'Batalkan alokasi' })) {
                  await act((d, c) => planVoidAllocation(d, a.id, c), 'Alokasi dibatalkan.');
                }
              }}>Batalkan</button>
            ) : (
              <button className="btn btn--sm btn--ghost" onClick={() => act((d, c) => planUnvoidAllocation(d, a.id, c), 'Alokasi dipulihkan.')}>Pulihkan</button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PocketForm({ pocket, onClose, onArchive }: { pocket?: Pocket; onClose: () => void; onArchive: (p: Pocket) => void }) {
  const { commit, busy } = useCommit();
  const [name, setName] = useState(pocket?.name ?? '');
  const [icon, setIcon] = useState(pocket?.icon ?? '✉️');
  const [color, setColor] = useState(pocket?.color ?? PALETTE.butter);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (await commit((d, c) => planSavePocket(d, { name, icon, color }, c, pocket?.id), pocket ? 'Kantong diperbarui.' : 'Kantong dibuat.')) onClose();
    } catch (x) {
      setErr(errorMessage(x));
    }
  };
  return (
    <Dialog title={pocket ? 'Edit kantong' : 'Kantong baru'} icon="✉️" tone="butter" onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="stack" noValidate>
        {err && <div className="error-summary" role="alert">{err}</div>}
        {!pocket && (
          <div className="chips" aria-label="Saran">
            {POCKET_SUGGESTIONS.map((s) => (
              <button key={s.name} type="button" className="chip chip--toggle" onClick={() => { setName(s.name); setIcon(s.icon); setColor(s.color); }}>{s.icon} {s.name}</button>
            ))}
          </div>
        )}
        <div className="form-grid">
          <Field label="Nama" htmlFor="p-name" className="span-2">
            <input id="p-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-autofocus />
          </Field>
          <Field label="Ikon (emoji)" htmlFor="p-icon">
            <input id="p-icon" className="input" value={icon} maxLength={8} onChange={(e) => setIcon(e.target.value)} />
          </Field>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div className="form-actions">
          {pocket && <button type="button" className="btn btn--ghost" onClick={() => onArchive(pocket)} disabled={busy}>Arsipkan</button>}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="field">
      <span className="field__label" id="color-l">Warna</span>
      <div className="chips" role="radiogroup" aria-labelledby="color-l">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            aria-label={`Warna ${c}`}
            onClick={() => onChange(c)}
            style={{ width: 36, height: 36, borderRadius: 10, border: value === c ? '3px solid var(--ink)' : '1.5px solid var(--ink)', background: c, cursor: 'pointer' }}
          />
        ))}
      </div>
    </div>
  );
}

export function AllocateForm({ initial, onClose }: { initial: AllocMode; onClose: () => void }) {
  const { ds, today, fmt } = useStore();
  const { commit, busy } = useCommit();
  const [from, setFrom] = useState(initial.from ?? '');
  const [to, setTo] = useState(initial.to ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const bal = pocketBalances(ds);
  const avail = from ? (bal.get(from) ?? 0) : unallocated(ds);
  const label = (id: string) => (id ? (ds.pockets.find((p) => p.id === id)?.name ?? '?') : 'Dana belum dialokasikan');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = parseAmountInput(amount);
    if (!amt.ok) return setErr(amt.error);
    try {
      if (await commit((d, c) => planAllocate(d, { date, fromPocketId: from || null, toPocketId: to || null, amount: amt.value, note }, c), `Dana ${fmt(amt.value)} dipindahkan ke ${label(to)}.`)) onClose();
    } catch (x) {
      setErr(errorMessage(x));
    }
  };
  return (
    <Dialog title="Alokasikan dana" icon="⇄" tone="butter" onClose={onClose} busy={busy} description="Memindahkan dana virtual. Saldo rekening dan saldo total tidak berubah.">
      <form onSubmit={submit} className="stack" noValidate>
        {err && <div className="error-summary" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Dari" htmlFor="al-from">
            <select id="al-from" className="select" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Dana belum dialokasikan · {fmt(unallocated(ds))}</option>
              {ds.pockets.filter((p) => p.id !== to && (!p.archivedAt || (bal.get(p.id) ?? 0) > 0)).map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name} · {fmt(bal.get(p.id) ?? 0)}</option>)}
            </select>
          </Field>
          <Field label="Ke" htmlFor="al-to">
            <select id="al-to" className="select" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Dana belum dialokasikan</option>
              {ds.pockets.filter((p) => !p.archivedAt && p.id !== from).map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
            </select>
          </Field>
          <Field label="Nominal" htmlFor="al-amt" className="span-2" hint={<>Tersedia: <strong>{fmt(Math.max(0, avail))}</strong>{avail > 0 && <> · <button type="button" className="link-btn" onClick={() => setAmount(avail.toLocaleString('id-ID'))}>pakai semua</button></>}</>}>
            <AmountInput id="al-amt" value={amount} onChange={setAmount} autoFocus />
          </Field>
          <Field label="Tanggal" htmlFor="al-date">
            <input id="al-date" type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Catatan (opsional)" htmlFor="al-note">
            <input id="al-note" className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button>
          <button className="btn btn--primary" disabled={busy || from === to}>{busy ? 'Menyimpan…' : 'Alokasikan'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function PocketActivity({ pocketId, onClose, fmt }: { pocketId: ID; onClose: () => void; fmt: (n: number) => string }) {
  const { ds } = useStore();
  const p = ds.pockets.find((x) => x.id === pocketId)!;
  const pn = (id: ID | null) => (id ? (ds.pockets.find((x) => x.id === id)?.name ?? '?') : 'Belum dialokasikan');
  const items = [
    ...ds.allocations.filter((a) => a.fromPocketId === pocketId || a.toPocketId === pocketId).map((a) => ({
      id: a.id, date: a.date, at: a.createdAt, status: a.status,
      text: a.toPocketId === pocketId ? `Alokasi masuk dari ${pn(a.fromPocketId)}` : `Alokasi keluar ke ${pn(a.toPocketId)}`,
      value: a.toPocketId === pocketId ? a.amount : -a.amount,
    })),
    ...ds.transactions.filter((t) => t.pocketId === pocketId && (t.type === 'expense' || t.type === 'refund')).map((t) => ({
      id: t.id, date: t.date, at: t.createdAt, status: t.status,
      text: `${t.type === 'expense' ? 'Pemakaian' : 'Pengembalian'} · ${ds.categories.find((c) => c.id === t.categoryId)?.name ?? ''}${t.note ? ` · ${t.note}` : ''}`,
      value: t.type === 'expense' ? -t.amount : t.amount,
    })),
  ].sort((a, b) => (a.date === b.date ? (a.at < b.at ? 1 : -1) : a.date < b.date ? 1 : -1));
  return (
    <Dialog title={`Aktivitas ${p.name}`} icon={p.icon} tone="butter" variant="drawer" onClose={onClose}>
      <div className="stack">
        <div className="hero-strip"><Illustration name="jar" size={72} /><p className="muted small">Alokasi bukan belanja. Pemakaian = pengeluaran yang diambil dari kantong ini.</p></div>
        {items.length === 0 ? <p className="muted">Belum ada aktivitas.</p> : (
          <ul className="list">
            {items.map((i) => (
              <li key={i.id} className="spread" style={{ padding: '10px 0', opacity: i.status === 'voided' ? 0.6 : 1 }}>
                <span className="small">{formatDate(i.date)} · {i.text}{i.status === 'voided' && ' (batal)'}</span>
                <strong className={i.value < 0 ? '' : ''}>{fmt(i.value)}</strong>
              </li>
            ))}
          </ul>
        )}
        <a className="btn" href={href('/transaksi', { pocket: pocketId, ref: 'Kantong' })} onClick={onClose}>Lihat transaksi kantong ini</a>
      </div>
    </Dialog>
  );
}
