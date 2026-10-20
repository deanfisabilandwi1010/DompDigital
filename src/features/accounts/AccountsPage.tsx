import { useMemo, useState, type FormEvent } from 'react';
import { href } from '../../app/router';
import { errorMessage, useCommit, useStore } from '../../app/store';
import { useUi } from '../../app/ui';
import { Dialog } from '../../components/Dialog';
import { Amount, AmountInput, amountToInput, EmptyState, Field, RetroWindow } from '../../components/ui';
import { planArchiveAccount, planReconcile, planSaveAccount, planVoidAdjustment } from '../../domain/commands';
import { formatDate } from '../../domain/dates';
import { ACCOUNT_TYPE_ICON, ACCOUNT_TYPE_LABEL } from '../../domain/defaults';
import { accountBalance, accountBalances } from '../../domain/ledger';
import { parseAmountInput } from '../../domain/money';
import { DomainError, type Account, type AccountType, type ID } from '../../domain/types';

export function AccountsPage() {
  const { ds, fmt } = useStore();
  const { act } = useCommit();
  const { confirm } = useUi();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [reconcile, setReconcile] = useState<ID | null>(null);
  const bal = useMemo(() => accountBalances(ds), [ds]);
  const active = ds.accounts.filter((a) => !a.archivedAt);
  const archived = ds.accounts.filter((a) => a.archivedAt);
  const total = [...bal.values()].reduce((a, b) => a + b, 0);
  const adjustments = [...ds.adjustments].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Rekening</h1>
          <p className="muted">Tempat uang dicatat: bank, tunai, dan e-wallet. Aplikasi hanya mencatat — tidak memindahkan uang sungguhan.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={() => setEditing('new')}>＋ Tambah rekening</button>
        </div>
      </div>

      <div className="money-card money-card--butter" style={{ maxWidth: 420 }}>
        <span className="money-card__label">Saldo tercatat sekarang</span>
        <span className="money-card__value"><Amount value={total} colored /></span>
        <span className="money-card__sub">jumlah seluruh rekening, termasuk arsip</span>
      </div>

      {active.length === 0 ? (
        <EmptyState title="Belum ada rekening" action={<button className="btn btn--primary" onClick={() => setEditing('new')}>Tambah rekening</button>}>Tambahkan rekening bank, dompet tunai, atau e-wallet.</EmptyState>
      ) : (
        <div className="grid grid--3">
          {active.map((a) => (
            <RetroWindow
              key={a.id}
              title={a.name}
              icon={ACCOUNT_TYPE_ICON[a.type]}
              tone={a.type === 'bank' ? 'blue' : a.type === 'cash' ? 'sage' : 'lilac'}
              actions={<button className="btn btn--icon" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}>✏️</button>}
            >
              <div className="stack">
                <span className="mono muted">{ACCOUNT_TYPE_LABEL[a.type]}</span>
                <span className="money-card__value"><Amount value={bal.get(a.id) ?? 0} colored /></span>
                <span className="small muted">Saldo pembukaan {fmt(a.openingBalance)} pada {formatDate(a.openingDate)}</span>
                <div className="row">
                  <a className="btn btn--sm" href={href('/transaksi', { acc: a.id, ref: 'Rekening' })}>Transaksi</a>
                  <button className="btn btn--sm" onClick={() => setReconcile(a.id)}>Rekonsiliasi</button>
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={async () => {
                      if (await confirm({ title: `Arsipkan ${a.name}?`, body: 'Rekening arsip disembunyikan dari formulir baru, tetapi riwayatnya tetap dihitung. Hanya rekening bersaldo Rp0 yang dapat diarsipkan.', confirmLabel: 'Arsipkan' })) {
                        await act((d, c) => planArchiveAccount(d, a.id, true, c), `${a.name} diarsipkan.`);
                      }
                    }}
                  >
                    Arsipkan
                  </button>
                </div>
              </div>
            </RetroWindow>
          ))}
        </div>
      )}

      <RetroWindow title="Penyesuaian rekonsiliasi" icon="⚖️" tone="paper">
        {adjustments.length === 0 ? (
          <p className="muted small">Belum ada penyesuaian. Gunakan Rekonsiliasi bila saldo aktual di bank/dompet berbeda dengan catatan. Selisih dicatat sebagai penyesuaian — bukan pemasukan — dan memengaruhi dana belum dialokasikan.</p>
        ) : (
          <ul className="list">
            {adjustments.map((j) => (
              <li key={j.id} className="spread" style={{ padding: '10px 0' }}>
                <span>
                  <strong>{ds.accounts.find((a) => a.id === j.accountId)?.name}</strong> · {formatDate(j.date)} · {j.reason}
                  {j.status === 'voided' && <> <span className="badge badge--void">Batal</span></>}
                </span>
                <span className="row">
                  <strong><Amount value={j.signedAmount} sign colored /></strong>
                  {j.status === 'active' && (
                    <button className="btn btn--sm btn--ghost" onClick={async () => {
                      if (await confirm({ title: 'Batalkan penyesuaian?', body: `Penyesuaian ${fmt(j.signedAmount, { sign: true })} pada ${formatDate(j.date)} akan dibatalkan.`, danger: true, confirmLabel: 'Batalkan' })) {
                        await act((d, c) => planVoidAdjustment(d, j.id, c), 'Penyesuaian dibatalkan.');
                      }
                    }}>Batalkan</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </RetroWindow>

      {archived.length > 0 && (
        <RetroWindow title="Rekening arsip" icon="🗄️" tone="paper">
          <ul className="list">
            {archived.map((a) => (
              <li key={a.id} className="spread" style={{ padding: '10px 0' }}>
                <span>{ACCOUNT_TYPE_ICON[a.type]} {a.name} · <Amount value={bal.get(a.id) ?? 0} /></span>
                <button className="btn btn--sm" onClick={() => act((d, c) => planArchiveAccount(d, a.id, false, c), `${a.name} aktif kembali.`)}>Aktifkan</button>
              </li>
            ))}
          </ul>
        </RetroWindow>
      )}

      {editing && <AccountForm account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {reconcile && <ReconcileForm accountId={reconcile} onClose={() => setReconcile(null)} />}
    </>
  );
}

function AccountForm({ account, onClose }: { account?: Account; onClose: () => void }) {
  const { today } = useStore();
  const { commit, busy } = useCommit();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'bank');
  const [opening, setOpening] = useState(amountToInput(account?.openingBalance ?? 0));
  const [date, setDate] = useState(account?.openingDate ?? today);
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = parseAmountInput(opening || '0', { allowZero: true });
    if (!amt.ok) return setErr({ field: 'openingBalance', msg: amt.error });
    try {
      const ok = await commit((d, c) => planSaveAccount(d, { name, type, openingBalance: amt.value, openingDate: date }, c, account?.id), account ? 'Rekening diperbarui.' : 'Rekening ditambahkan.');
      if (ok) onClose();
    } catch (x) {
      setErr({ field: x instanceof DomainError ? x.field : undefined, msg: errorMessage(x) });
    }
  };
  return (
    <Dialog title={account ? 'Edit rekening' : 'Tambah rekening'} icon="🏦" tone="blue" onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="stack" noValidate>
        {err && !err.field && <div className="error-summary" role="alert">{err.msg}</div>}
        <div className="form-grid">
          <Field label="Nama rekening" htmlFor="acc-name" error={err?.field === 'name' ? err.msg : undefined} className="span-2">
            <input id="acc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-autofocus placeholder="mis. Bank utama" />
          </Field>
          <Field label="Jenis" htmlFor="acc-type">
            <select id="acc-type" className="select" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {(['bank', 'cash', 'ewallet'] as const).map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_ICON[t]} {ACCOUNT_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Tanggal pembukaan" htmlFor="acc-date" error={err?.field === 'openingDate' ? err.msg : undefined} hint="Transaksi sebelum tanggal ini ditolak.">
            <input id="acc-date" type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Saldo pembukaan" htmlFor="acc-open" error={err?.field === 'openingBalance' ? err.msg : undefined} className="span-2" hint="Posisi awal — bukan pemasukan.">
            <AmountInput id="acc-open" value={opening} onChange={setOpening} />
          </Field>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ReconcileForm({ accountId, onClose }: { accountId: ID; onClose: () => void }) {
  const { ds, today, fmt } = useStore();
  const { commit, busy } = useCommit();
  const acc = ds.accounts.find((a) => a.id === accountId)!;
  const [date, setDate] = useState(today);
  const [actual, setActual] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const recorded = accountBalance(ds, accountId, date);
  const parsed = parseAmountInput(actual.replace(/^-/, ''), { allowZero: true });
  const actualVal = parsed.ok ? (actual.startsWith('-') ? -parsed.value : parsed.value) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (actualVal == null) return setErr(parsed.ok ? 'Isi saldo aktual.' : parsed.error);
    try {
      const ok = await commit((d, c) => planReconcile(d, { accountId, date, actualBalance: actualVal, reason }, c), 'Penyesuaian tercatat. Saldo sudah diperbarui.');
      if (ok) onClose();
    } catch (x) {
      setErr(errorMessage(x));
    }
  };
  return (
    <Dialog title={`Rekonsiliasi ${acc.name}`} icon="⚖️" tone="butter" onClose={onClose} busy={busy} description="Cocokkan catatan dengan saldo aktual. Selisih dicatat sebagai penyesuaian beralasan, bukan mengedit angka.">
      <form onSubmit={submit} className="stack" noValidate>
        {err && <div className="error-summary" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Per tanggal" htmlFor="rc-date">
            <input id="rc-date" type="date" className="input" value={date} min={acc.openingDate} max={today} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="field">
            <span className="field__label">Saldo tercatat</span>
            <span className="money-card__value" style={{ fontSize: '1.3rem' }}><Amount value={recorded} colored /></span>
          </div>
          <Field label="Saldo aktual" htmlFor="rc-actual" className="span-2">
            <AmountInput id="rc-actual" value={actual} onChange={setActual} allowNegative autoFocus />
          </Field>
          <Field label="Alasan" htmlFor="rc-reason" className="span-2" hint="mis. bunga bank, selisih uang kembalian, biaya tak tercatat">
            <input id="rc-reason" className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        {actualVal != null && (
          <p className="callout small">Penyesuaian yang akan dicatat: <strong>{fmt(actualVal - recorded, { sign: true })}</strong></p>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Catat penyesuaian'}</button>
        </div>
      </form>
    </Dialog>
  );
}
