import { useMemo, useState, type FormEvent } from 'react';
import { errorMessage, useCommit, useStore } from '../../app/store';
import { Dialog } from '../../components/Dialog';
import { Amount, AmountInput, amountToInput, EmptyState, Field, RetroWindow } from '../../components/ui';
import { planSaveReminder, planSetOccurrence } from '../../domain/commands';
import { formatDate, isValidDate } from '../../domain/dates';
import { FREQ_LABEL } from '../../domain/defaults';
import { parseAmountInput } from '../../domain/money';
import { dueDatesBetween, reminderAgenda, type AgendaItem } from '../../domain/reminders';
import type { Frequency, Reminder, ReminderKind } from '../../domain/types';
import { useTxUi } from '../transactions/TxUi';

export function RemindersPage() {
  const { ds, today, fmt } = useStore();
  const { act } = useCommit();
  const { openNew, openDetail } = useTxUi();
  const [form, setForm] = useState<Reminder | 'new' | null>(null);
  const agenda = useMemo(() => reminderAgenda(ds, today), [ds, today]);

  const record = (i: AgendaItem) =>
    openNew({
      type: i.reminder.kind === 'income' ? 'income' : 'expense',
      amount: i.reminder.amount,
      accountId: i.reminder.accountId,
      categoryId: i.reminder.categoryId,
      pocketId: i.reminder.pocketId,
      note: i.reminder.name,
      date: i.dueDate <= today ? i.dueDate : today,
      occurrence: { reminderId: i.reminder.id, dueDate: i.dueDate, label: i.reminder.name },
    });

  const Item = ({ i }: { i: AgendaItem }) => (
    <li className="spread" style={{ padding: '10px 0' }}>
      <span>
        <strong>{i.reminder.kind === 'income' ? '💰' : '🧾'} {i.reminder.name}</strong>
        <span className="small muted" style={{ display: 'block' }}>
          Jatuh tempo {formatDate(i.dueDate, { weekday: true })} · {fmt(i.reminder.amount)}
        </span>
      </span>
      <span className="row">
        {i.status === 'open' ? (
          <>
            <button className="btn btn--sm btn--primary" onClick={() => record(i)}>Catat sekarang</button>
            <button className="btn btn--sm btn--ghost" onClick={() => act((d, c) => planSetOccurrence(d, i.reminder.id, i.dueDate, 'skipped', c), 'Kejadian dilewati.')}>Lewati</button>
          </>
        ) : i.status === 'recorded' ? (
          <>
            <span className="badge badge--income">Tercatat</span>
            {i.occurrence?.linkedTransactionId && <button className="btn btn--sm btn--ghost" onClick={() => openDetail(i.occurrence!.linkedTransactionId!)}>Lihat</button>}
          </>
        ) : (
          <>
            <span className="badge">Dilewati</span>
            <button className="btn btn--sm btn--ghost" onClick={() => act((d, c) => planSetOccurrence(d, i.reminder.id, i.dueDate, 'open', c), 'Kejadian dibuka kembali.')}>Buka kembali</button>
          </>
        )}
      </span>
    </li>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pengingat</h1>
          <p className="muted">Jadwal tagihan & pemasukan. Daftar dihitung saat aplikasi dibuka — tidak ada notifikasi ketika aplikasi tertutup, dan tidak ada pencatatan otomatis.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={() => setForm('new')}>＋ Pengingat baru</button>
        </div>
      </div>

      <div className="grid grid--2">
        <RetroWindow title={`Terlewat (${agenda.overdue.length})`} icon="⏰" tone="coral">
          {agenda.overdue.length === 0 ? <p className="muted small">Tidak ada jadwal terlewat dalam 90 hari terakhir.</p> : <ul className="list">{agenda.overdue.map((i) => <Item key={i.reminder.id + i.dueDate} i={i} />)}</ul>}
        </RetroWindow>
        <RetroWindow title={`Mendatang 30 hari (${agenda.upcoming.length})`} icon="📅" tone="butter">
          {agenda.upcoming.length === 0 ? <p className="muted small">Tidak ada jadwal dalam 30 hari ke depan.</p> : <ul className="list">{agenda.upcoming.map((i) => <Item key={i.reminder.id + i.dueDate} i={i} />)}</ul>}
        </RetroWindow>
      </div>

      <RetroWindow title="Template pengingat" icon="🔔" tone="paper">
        {ds.reminders.length === 0 ? (
          <EmptyState title="Belum ada pengingat" action={<button className="btn btn--primary" onClick={() => setForm('new')}>Buat pengingat</button>}>
            Contoh: listrik bulanan, gaji tanggal 25, langganan tahunan.
          </EmptyState>
        ) : (
          <ul className="list">
            {ds.reminders.map((r) => (
              <li key={r.id} className="spread" style={{ padding: '10px 0', opacity: r.active ? 1 : 0.6 }}>
                <span>
                  <strong>{r.name}</strong> {!r.active && <span className="badge">Nonaktif</span>}
                  <span className="small muted" style={{ display: 'block' }}>
                    {FREQ_LABEL[r.frequency]} sejak {formatDate(r.anchorDate)} · {ds.accounts.find((a) => a.id === r.accountId)?.name} · {ds.categories.find((c) => c.id === r.categoryId)?.name}
                  </span>
                </span>
                <span className="row">
                  <strong><Amount value={r.amount} /></strong>
                  <button className="btn btn--sm" onClick={() => setForm(r)}>Edit</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </RetroWindow>

      {agenda.done.length > 0 && (
        <RetroWindow title="Sudah ditangani" icon="✅" tone="sage">
          <ul className="list">{agenda.done.slice(0, 15).map((i) => <Item key={i.reminder.id + i.dueDate} i={i} />)}</ul>
        </RetroWindow>
      )}

      {form && <ReminderForm reminder={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
    </>
  );
}

function ReminderForm({ reminder, onClose }: { reminder?: Reminder; onClose: () => void }) {
  const { ds, today } = useStore();
  const { commit, busy } = useCommit();
  const [name, setName] = useState(reminder?.name ?? '');
  const [kind, setKind] = useState<ReminderKind>(reminder?.kind ?? 'bill');
  const [frequency, setFrequency] = useState<Frequency>(reminder?.frequency ?? 'monthly');
  const [anchorDate, setAnchorDate] = useState(reminder?.anchorDate ?? today);
  const [amount, setAmount] = useState(amountToInput(reminder?.amount));
  const [accountId, setAccountId] = useState(reminder?.accountId ?? ds.accounts.find((a) => !a.archivedAt)?.id ?? '');
  const [categoryId, setCategoryId] = useState(reminder?.categoryId ?? '');
  const [pocketId, setPocketId] = useState(reminder?.pocketId ?? '');
  const [active, setActive] = useState(reminder?.active ?? true);
  const [err, setErr] = useState<string | null>(null);
  const cats = ds.categories.filter((c) => c.kind === (kind === 'income' ? 'income' : 'expense') && (!c.archivedAt || c.id === reminder?.categoryId));
  const day = Number(anchorDate.slice(8, 10));
  const preview = isValidDate(anchorDate) ? dueDatesBetween({ anchorDate, frequency }, anchorDate, addYears(anchorDate)).slice(0, 4) : [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = parseAmountInput(amount);
    if (!amt.ok) return setErr(amt.error);
    try {
      const ok = await commit(
        (d, c) => planSaveReminder(d, { name, kind, frequency, anchorDate, amount: amt.value, accountId, categoryId, pocketId: pocketId || null, active }, c, reminder?.id),
        reminder ? 'Pengingat diperbarui.' : 'Pengingat dibuat.',
      );
      if (ok) onClose();
    } catch (x) {
      setErr(errorMessage(x));
    }
  };
  return (
    <Dialog title={reminder ? 'Edit pengingat' : 'Pengingat baru'} icon="🔔" tone="butter" onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="stack" noValidate>
        {err && <div className="error-summary" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Nama" htmlFor="r-name" className="span-2">
            <input id="r-name" className="input" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} data-autofocus placeholder="mis. Listrik rumah" />
          </Field>
          <Field label="Tipe" htmlFor="r-kind">
            <select id="r-kind" className="select" value={kind} onChange={(e) => { setKind(e.target.value as ReminderKind); setCategoryId(''); }}>
              <option value="bill">Tagihan</option>
              <option value="income">Pemasukan</option>
            </select>
          </Field>
          <Field label="Frekuensi" htmlFor="r-freq">
            <select id="r-freq" className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {(['weekly', 'monthly', 'yearly'] as const).map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
            </select>
          </Field>
          <Field label="Jatuh tempo pertama" htmlFor="r-date" hint={day >= 29 && frequency !== 'weekly' ? `Bulan tanpa tanggal ${day} memakai hari terakhir bulan itu.` : undefined}>
            <input id="r-date" type="date" className="input" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
          </Field>
          <Field label="Nominal perkiraan" htmlFor="r-amt">
            <AmountInput id="r-amt" value={amount} onChange={setAmount} />
          </Field>
          <Field label="Rekening" htmlFor="r-acc">
            <select id="r-acc" className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {ds.accounts.filter((a) => !a.archivedAt || a.id === reminder?.accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Kategori" htmlFor="r-cat">
            <select id="r-cat" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— Pilih kategori —</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </Field>
          {kind === 'bill' && (
            <Field label="Kantong (opsional)" htmlFor="r-pocket">
              <select id="r-pocket" className="select" value={pocketId} onChange={(e) => setPocketId(e.target.value)}>
                <option value="">Dana belum dialokasikan</option>
                {ds.pockets.filter((p) => !p.archivedAt || p.id === reminder?.pocketId).map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
              </select>
            </Field>
          )}
          <label className="checkbox span-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aktif</label>
        </div>
        {preview.length > 0 && <p className="small muted">Jadwal berikutnya: {preview.map((d) => formatDate(d)).join(' · ')}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function addYears(d: string): string {
  return `${Number(d.slice(0, 4)) + 2}${d.slice(4)}`;
}
