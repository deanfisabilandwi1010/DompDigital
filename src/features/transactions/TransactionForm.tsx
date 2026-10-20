import { useMemo, useRef, useState, type FormEvent } from 'react';
import { errorMessage, useCommit, useStore } from '../../app/store';
import { Dialog } from '../../components/Dialog';
import { AmountInput, amountToInput, Field } from '../../components/ui';
import { planSaveTransaction, planSaveTransfer } from '../../domain/commands';
import { formatDate } from '../../domain/dates';
import { BEHAVIOR_LABEL, PRIORITY_LABEL, TX_TYPE_LABEL } from '../../domain/defaults';
import { accountBalances, isActive, pocketBalances, refundedAmount } from '../../domain/ledger';
import { parseAmountInput } from '../../domain/money';
import { DomainError, type Behavior, type Category, type ID, type Priority, type TxType } from '../../domain/types';
import type { TxTemplate } from './TxUi';

const LAST_ACCOUNT_KEY = 'kantong.lastAccount';
function rememberAccount(mode: string, id: string) {
  try {
    localStorage.setItem(`${LAST_ACCOUNT_KEY}.${mode}`, id);
  } catch {
    /* abaikan */
  }
}
function lastAccount(mode: string): string | null {
  try {
    return localStorage.getItem(`${LAST_ACCOUNT_KEY}.${mode}`);
  } catch {
    return null;
  }
}

const TYPES: TxType[] = ['expense', 'income', 'transfer', 'refund'];

export function TransactionForm({ editId, template = {}, onClose }: { editId?: ID; template?: TxTemplate; onClose: () => void }) {
  const { ds, today, fmt, mode } = useStore();
  const { commit, busy } = useCommit();
  const editing = editId ? ds.transactions.find((t) => t.id === editId) : undefined;
  const fee = editing?.type === 'transfer' ? ds.transactions.find((t) => t.groupId === editing.groupId && t.type === 'expense' && isActive(t)) : undefined;

  const activeAccounts = ds.accounts.filter((a) => !a.archivedAt || a.id === editing?.accountId || a.id === editing?.destinationAccountId);
  const defaultAccount = template.accountId ?? lastAccount(mode) ?? '';
  const initialAccount = editing?.accountId ?? (activeAccounts.some((a) => a.id === defaultAccount) ? defaultAccount : (activeAccounts.find((a) => !a.archivedAt)?.id ?? ''));

  const [type, setType] = useState<TxType>(editing?.type ?? template.type ?? 'expense');
  const [amount, setAmount] = useState(amountToInput(editing?.amount ?? template.amount));
  const [date, setDate] = useState(editing?.date ?? template.date ?? today);
  const [accountId, setAccountId] = useState(initialAccount);
  const [toAccountId, setToAccountId] = useState(editing?.destinationAccountId ?? '');
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? template.categoryId ?? '');
  const [pocketId, setPocketId] = useState(editing?.pocketId ?? template.pocketId ?? '');
  const [originalId, setOriginalId] = useState(editing?.originalExpenseId ?? template.originalExpenseId ?? '');
  const [note, setNote] = useState(editing?.note ?? template.note ?? '');
  const [tags, setTags] = useState(editing?.tags.join(', ') ?? '');
  const [feeStr, setFeeStr] = useState(amountToInput(fee?.amount));
  const [priority, setPriority] = useState<Priority | null | undefined>(editing ? editing.priority : undefined);
  const [behavior, setBehavior] = useState<Behavior | null | undefined>(editing ? editing.behavior : undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const cats = useMemo(() => {
    const kind = type === 'income' ? 'income' : 'expense';
    return ds.categories.filter((c) => c.kind === kind && (!c.archivedAt || c.id === editing?.categoryId));
  }, [ds.categories, type, editing]);
  const groups = useMemo(() => {
    const m = new Map<string, Category[]>();
    for (const c of cats) m.set(c.grp, [...(m.get(c.grp) ?? []), c]);
    return [...m.entries()];
  }, [cats]);
  const selectedCat = ds.categories.find((c) => c.id === categoryId);
  const effPriority = priority === undefined ? (selectedCat?.defaultPriority ?? null) : priority;
  const effBehavior = behavior === undefined ? (selectedCat?.defaultBehavior ?? null) : behavior;

  const accBal = useMemo(() => accountBalances(ds), [ds]);
  const pocBal = useMemo(() => pocketBalances(ds), [ds]);
  const pockets = ds.pockets.filter((p) => !p.archivedAt || p.id === editing?.pocketId);

  const refundable = useMemo(
    () =>
      ds.transactions
        .filter((t) => t.type === 'expense' && isActive(t) && !t.groupId)
        .map((t) => ({ t, left: t.amount - refundedAmount(ds, t.id, editing?.id) }))
        .filter((x) => x.left > 0 || x.t.id === originalId)
        .sort((a, b) => (a.t.date < b.t.date ? 1 : -1))
        .slice(0, 200),
    [ds, editing, originalId],
  );
  const catName = (id: ID | null) => ds.categories.find((c) => c.id === id)?.name ?? '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs: Record<string, string> = {};
    const amt = parseAmountInput(amount);
    if (!amt.ok) errs.amount = amt.error;
    let feeVal = 0;
    if (type === 'transfer' && feeStr.trim()) {
      const f = parseAmountInput(feeStr, { allowZero: true });
      if (!f.ok) errs.fee = f.error;
      else feeVal = f.value;
    }
    if (!accountId) errs.accountId = 'Pilih rekening.';
    if ((type === 'income' || type === 'expense') && !categoryId) errs.categoryId = 'Pilih kategori.';
    if (type === 'transfer' && !toAccountId) errs.toAccountId = 'Pilih rekening tujuan.';
    if (type === 'refund' && !originalId) errs.originalExpenseId = 'Pilih pengeluaran asal.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length || !amt.ok) {
      requestAnimationFrame(() => (summaryRef.current ?? document.querySelector<HTMLElement>('dialog [aria-invalid="true"]'))?.focus());
      return;
    }
    try {
      const ok = await commit((d, c) => {
        if (type === 'transfer') {
          return planSaveTransfer(d, { id: editing?.id, date, amount: amt.value, fromAccountId: accountId, toAccountId, fee: feeVal, note, tags }, c);
        }
        return planSaveTransaction(
          d,
          {
            id: editing?.id,
            type,
            date,
            amount: amt.value,
            accountId,
            categoryId: categoryId || null,
            pocketId: type === 'expense' ? pocketId || null : null,
            originalExpenseId: type === 'refund' ? originalId : null,
            note,
            tags,
            priority: type === 'expense' ? effPriority : null,
            behavior: type === 'expense' ? effBehavior : null,
            occurrence: template.occurrence ? { reminderId: template.occurrence.reminderId, dueDate: template.occurrence.dueDate } : undefined,
          },
          c,
        );
      }, editing ? 'Perubahan tersimpan. Saldo sudah diperbarui.' : 'Tercatat. Saldo sudah diperbarui.');
      if (ok) {
        rememberAccount(mode, accountId);
        onClose();
      }
    } catch (err) {
      if (err instanceof DomainError && err.field) setErrors({ [err.field]: err.message });
      setFormError(errorMessage(err));
      requestAnimationFrame(() => (summaryRef.current ?? document.querySelector<HTMLElement>('dialog [aria-invalid="true"]'))?.focus());
    }
  };

  const errList = Object.values(errors);
  const accountLabel = (id: ID) => {
    const a = ds.accounts.find((x) => x.id === id)!;
    return `${a.name}${a.archivedAt ? ' (arsip)' : ''} · ${fmt(accBal.get(id) ?? 0)}`;
  };

  return (
    <Dialog
      title={editing ? `Edit ${TX_TYPE_LABEL[type].toLowerCase()}` : 'Catat transaksi'}
      icon="✏️"
      tone={type === 'income' ? 'sage' : type === 'expense' ? 'coral' : type === 'transfer' ? 'blue' : 'butter'}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit} noValidate className="stack">
        {template.occurrence && (
          <div className="callout">
            🔔 Mencatat pengingat <strong>{template.occurrence.label}</strong> (jatuh tempo {formatDate(template.occurrence.dueDate)}). Periksa nominal dan tanggal aktualnya.
          </div>
        )}
        {(formError || errList.length > 1) && (
          <div className="error-summary" tabIndex={-1} ref={summaryRef} role="alert">
            {formError && errList.length <= 1 ? formError : `Ada ${errList.length} isian yang perlu diperbaiki:`}
            {errList.length > 1 && <ul>{errList.map((m, i) => <li key={i}>{m}</li>)}</ul>}
            {formError && <div className="small" style={{ marginTop: 6 }}>Isian Anda tetap tersimpan di formulir. Perbaiki lalu tekan Simpan untuk mencoba lagi.</div>}
          </div>
        )}
        {!editing ? (
          <div className="segmented" role="tablist" aria-label="Jenis transaksi">
            {TYPES.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={type === t} className={`seg-${t}`} onClick={() => { setType(t); setErrors({}); setCategoryId(''); setPriority(undefined); setBehavior(undefined); }}>
                {TX_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted small">Jenis transaksi tidak dapat diubah. Batalkan lalu catat ulang bila perlu.</p>
        )}

        <div className="form-grid">
          <Field label="Nominal" htmlFor="tx-amount" error={errors.amount} className="span-2">
            <AmountInput id="tx-amount" value={amount} onChange={setAmount} invalid={!!errors.amount} autoFocus />
          </Field>

          {type === 'refund' && (
            <Field label="Pengeluaran asal" htmlFor="tx-orig" error={errors.originalExpenseId} className="span-2" hint="Kategori dan kantong mengikuti transaksi asal.">
              <select id="tx-orig" className="select" value={originalId} onChange={(e) => setOriginalId(e.target.value)} aria-invalid={!!errors.originalExpenseId || undefined} disabled={!!editing}>
                <option value="">— Pilih pengeluaran —</option>
                {refundable.map(({ t, left }) => (
                  <option key={t.id} value={t.id}>
                    {formatDate(t.date)} · {catName(t.categoryId)} · {fmt(t.amount)}{t.note ? ` · ${t.note.slice(0, 30)}` : ''} (sisa {fmt(left)})
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Tanggal" htmlFor="tx-date" error={errors.date} hint="Jadwal ke depan dibuat lewat Pengingat.">
            <input id="tx-date" type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errors.date || undefined} required />
          </Field>

          <Field label={type === 'transfer' ? 'Dari rekening' : type === 'refund' ? 'Rekening penerima' : 'Rekening'} htmlFor="tx-acc" error={errors.accountId ?? errors.fromAccountId}>
            <select id="tx-acc" className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-invalid={!!errors.accountId || undefined}>
              <option value="">— Pilih rekening —</option>
              {activeAccounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a.id)}</option>)}
            </select>
          </Field>

          {type === 'transfer' && (
            <>
              <Field label="Ke rekening" htmlFor="tx-to" error={errors.toAccountId}>
                <select id="tx-to" className="select" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} aria-invalid={!!errors.toAccountId || undefined}>
                  <option value="">— Pilih rekening tujuan —</option>
                  {activeAccounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{accountLabel(a.id)}</option>)}
                </select>
              </Field>
              <Field label="Biaya transfer (opsional)" htmlFor="tx-fee" error={errors.fee} hint="Dicatat sebagai pengeluaran Biaya administrasi dari rekening sumber.">
                <AmountInput id="tx-fee" value={feeStr} onChange={setFeeStr} invalid={!!errors.fee} />
              </Field>
            </>
          )}

          {(type === 'income' || type === 'expense') && (
            <Field label="Kategori" htmlFor="tx-cat" error={errors.categoryId}>
              <select id="tx-cat" className="select" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPriority(undefined); setBehavior(undefined); }} aria-invalid={!!errors.categoryId || undefined}>
                <option value="">— Pilih kategori —</option>
                {groups.map(([g, list]) => (
                  <optgroup key={g} label={g}>
                    {list.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}{c.archivedAt ? ' (arsip)' : ''}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
          )}

          {type === 'expense' && (
            <Field label="Ambil dari kantong" htmlFor="tx-pocket" error={errors.pocketId} hint="Tanpa pilihan = dana belum dialokasikan.">
              <select id="tx-pocket" className="select" value={pocketId ?? ''} onChange={(e) => setPocketId(e.target.value)}>
                <option value="">Dana belum dialokasikan</option>
                {pockets.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name} · {fmt(pocBal.get(p.id) ?? 0)}</option>)}
              </select>
            </Field>
          )}

          {type === 'income' && (
            <p className="span-2 small muted">Pemasukan masuk ke dana belum dialokasikan. Alokasikan ke kantong kapan saja dari halaman Kantong.</p>
          )}

          {type === 'expense' && (
            <>
              <div className="field">
                <span className="field__label" id="prio-l">Prioritas</span>
                <div className="segmented" role="group" aria-labelledby="prio-l">
                  {(['need', 'want'] as const).map((p) => (
                    <button key={p} type="button" aria-pressed={effPriority === p} onClick={() => setPriority(effPriority === p ? null : p)}>{PRIORITY_LABEL[p]}</button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field__label" id="beh-l">Sifat belanja</span>
                <div className="segmented" role="group" aria-labelledby="beh-l">
                  {(['fixed', 'variable'] as const).map((b) => (
                    <button key={b} type="button" aria-pressed={effBehavior === b} onClick={() => setBehavior(effBehavior === b ? null : b)}>{BEHAVIOR_LABEL[b]}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          <Field label="Catatan (opsional)" htmlFor="tx-note" error={errors.note} className="span-2">
            <input id="tx-note" className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="mis. makan siang kantor" />
          </Field>
          <Field label="Tag (opsional)" htmlFor="tx-tags" error={errors.tags} className="span-2" hint="Pisahkan dengan koma, mis. kantor, mingguan">
            <input id="tx-tags" className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
        </div>

        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            {busy ? 'Menyimpan…' : formError ? 'Coba lagi' : editing ? 'Simpan perubahan' : 'Simpan'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
