import { useStore, useCommit } from '../../app/store';
import { useUi } from '../../app/ui';
import { Dialog } from '../../components/Dialog';
import { Amount } from '../../components/ui';
import { planUnvoidTransaction, planVoidTransaction } from '../../domain/commands';
import { formatDate } from '../../domain/dates';
import { BEHAVIOR_LABEL, PRIORITY_LABEL, TX_TYPE_LABEL } from '../../domain/defaults';
import { isActive, refundedAmount } from '../../domain/ledger';
import { formatRupiah } from '../../domain/money';
import type { ID } from '../../domain/types';
import { txTitle } from './TxRow';
import { useTxUi } from './TxUi';

const ACTION_LABEL: Record<string, string> = { create: 'Dibuat', update: 'Diubah', void: 'Dibatalkan', unvoid: 'Dipulihkan' };

export function TransactionDetail({ id, onClose }: { id: ID; onClose: () => void }) {
  const { ds, fmt, hidden } = useStore();
  const { act, busy } = useCommit();
  const { confirm } = useUi();
  const { openEdit, openNew, openDetail } = useTxUi();
  const t = ds.transactions.find((x) => x.id === id);
  if (!t) return null;

  const name = (rows: { id: string; name: string }[], rid: string | null) => rows.find((r) => r.id === rid)?.name ?? '—';
  const group = t.groupId ? ds.transactions.filter((x) => x.groupId === t.groupId && x.id !== t.id) : [];
  const transferOfFee = t.groupId && t.type === 'expense' ? ds.transactions.find((x) => x.groupId === t.groupId && x.type === 'transfer') : undefined;
  const refunds = t.type === 'expense' ? ds.transactions.filter((x) => x.type === 'refund' && x.originalExpenseId === t.id) : [];
  const activeRefunds = refunds.filter(isActive);
  const refunded = t.type === 'expense' ? refundedAmount(ds, t.id) : 0;
  const original = t.originalExpenseId ? ds.transactions.find((x) => x.id === t.originalExpenseId) : undefined;
  const history = ds.auditEvents.filter((e) => e.entityId === t.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const occurrence = ds.occurrences.find((o) => o.linkedTransactionId === t.id);
  const reminder = occurrence ? ds.reminders.find((r) => r.id === occurrence.reminderId) : undefined;
  const editTarget = transferOfFee ?? t;
  const blockedByRefund = activeRefunds.length > 0;

  const doVoid = async () => {
    const all = [t, ...group.filter(isActive)];
    const ok = await confirm({
      title: 'Batalkan transaksi?',
      danger: true,
      confirmLabel: 'Ya, batalkan',
      body: (
        <div className="stack">
          <p>
            {txTitle(ds, t)} sebesar <strong>{hidden ? 'Rp•••••' : formatRupiah(t.amount)}</strong> pada <strong>{formatDate(t.date)}</strong> akan dibatalkan
            {all.length > 1 ? ` bersama ${all.length - 1} transaksi terkait (biaya transfer)` : ''}.
          </p>
          <p className="muted small">Record tetap disimpan untuk audit dan dapat dipulihkan.</p>
        </div>
      ),
    });
    if (ok) await act((d, c) => planVoidTransaction(d, t.id, c), 'Transaksi dibatalkan. Saldo sudah diperbarui.');
  };

  return (
    <Dialog title="Detail transaksi" icon="🧾" variant="drawer" tone="paper" onClose={onClose} busy={busy}>
      <div className="stack">
        <div className="receipt stack">
          <div className="spread">
            <span className={`badge badge--${t.type}`}>{TX_TYPE_LABEL[t.type]}</span>
            {t.status === 'voided' && <span className="badge badge--void">Dibatalkan</span>}
          </div>
          <strong style={{ fontFamily: 'var(--font-body)', fontSize: '1.1rem' }}>{txTitle(ds, t)}</strong>
          <span style={{ fontSize: '1.8rem', fontWeight: 750, fontFamily: 'var(--font-body)' }}>
            <Amount value={t.amount} />
          </span>
          <dl className="kv">
            <dt>Tanggal</dt><dd>{formatDate(t.date, { weekday: true })}</dd>
            <dt>{t.type === 'transfer' ? 'Dari' : 'Rekening'}</dt><dd>{name(ds.accounts, t.accountId)}</dd>
            {t.type === 'transfer' && (<><dt>Ke</dt><dd>{name(ds.accounts, t.destinationAccountId)}</dd></>)}
            {t.categoryId && (<><dt>Kategori</dt><dd>{name(ds.categories, t.categoryId)}</dd></>)}
            {(t.type === 'expense' || t.type === 'refund') && (<><dt>Kantong</dt><dd>{t.pocketId ? name(ds.pockets, t.pocketId) : 'Dana belum dialokasikan'}</dd></>)}
            {t.priority && (<><dt>Prioritas</dt><dd>{PRIORITY_LABEL[t.priority]}</dd></>)}
            {t.behavior && (<><dt>Sifat</dt><dd>{BEHAVIOR_LABEL[t.behavior]}</dd></>)}
            {t.note && (<><dt>Catatan</dt><dd>{t.note}</dd></>)}
            {t.tags.length > 0 && (<><dt>Tag</dt><dd>{t.tags.map((x) => `#${x}`).join(' ')}</dd></>)}
            {reminder && (<><dt>Pengingat</dt><dd>{reminder.name} ({formatDate(occurrence!.dueDate)})</dd></>)}
          </dl>
        </div>

        {group.length > 0 && (
          <div className="callout small">
            Bagian dari satu kelompok transfer:
            <ul>
              {group.map((g) => (
                <li key={g.id}>
                  <button className="link-btn" onClick={() => openDetail(g.id)}>{txTitle(ds, g)} · {fmt(g.amount)}{g.status === 'voided' ? ' (batal)' : ''}</button>
                </li>
              ))}
            </ul>
            Edit dan pembatalan berlaku untuk seluruh kelompok.
          </div>
        )}

        {original && (
          <div className="callout small">
            Pengembalian untuk: <button className="link-btn" onClick={() => openDetail(original.id)}>{txTitle(ds, original)} · {fmt(original.amount)} ({formatDate(original.date)})</button>
          </div>
        )}

        {t.type === 'expense' && !t.groupId && (
          <div className="stack">
            <div className="spread">
              <strong>Pengembalian dana</strong>
              <span className="small muted">Dikembalikan {fmt(refunded)} dari {fmt(t.amount)}</span>
            </div>
            {refunds.length > 0 && (
              <ul className="list">
                {refunds.map((r) => (
                  <li key={r.id}>
                    <button className="link-btn" onClick={() => openDetail(r.id)}>{formatDate(r.date)} · {fmt(r.amount)}{r.status === 'voided' ? ' (batal)' : ''}</button>
                  </li>
                ))}
              </ul>
            )}
            {t.status === 'active' && refunded < t.amount && (
              <button className="btn btn--sm btn--butter" onClick={() => { onClose(); openNew({ type: 'refund', originalExpenseId: t.id, accountId: t.accountId }); }}>
                ↩️ Catat pengembalian dana
              </button>
            )}
          </div>
        )}

        {blockedByRefund && t.status === 'active' && (
          <p className="callout callout--warn small">Transaksi ini memiliki pengembalian dana aktif, sehingga tidak dapat diedit atau dibatalkan. Batalkan pengembalian dananya terlebih dulu.</p>
        )}

        <div className="row">
          {t.status === 'active' ? (
            <>
              <button className="btn btn--primary" disabled={blockedByRefund || busy} onClick={() => openEdit(editTarget.id)}>✏️ Edit{transferOfFee ? ' transfer' : ''}</button>
              <button className="btn btn--danger" disabled={blockedByRefund || busy} onClick={doVoid}>Batalkan</button>
            </>
          ) : (
            <button className="btn btn--primary" disabled={busy} onClick={() => act((d, c) => planUnvoidTransaction(d, t.id, c), 'Transaksi dipulihkan. Saldo sudah diperbarui.')}>
              ↺ Pulihkan transaksi
            </button>
          )}
        </div>

        <details>
          <summary className="mono" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Riwayat perubahan ({history.length})</summary>
          <ul className="list small">
            {history.map((h) => (
              <li key={h.id} style={{ padding: '6px 0' }}>
                <strong>{ACTION_LABEL[h.action] ?? h.action}</strong> · {new Date(h.createdAt).toLocaleString('id-ID', { timeZone: ds.settings.timezone })}
                {h.action === 'update' && <ChangeSummary before={h.before} after={h.after} />}
              </li>
            ))}
          </ul>
          <p className="small muted">Dibuat {new Date(t.createdAt).toLocaleString('id-ID', { timeZone: ds.settings.timezone })} · ID {t.id.slice(0, 8)}</p>
        </details>
      </div>
    </Dialog>
  );
}

const FIELD_LABEL: Record<string, string> = {
  amount: 'nominal', date: 'tanggal', accountId: 'rekening', destinationAccountId: 'rekening tujuan', categoryId: 'kategori', pocketId: 'kantong',
  note: 'catatan', tags: 'tag', priority: 'prioritas', behavior: 'sifat',
};

function ChangeSummary({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const changed = Object.keys(FIELD_LABEL).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  if (!changed.length) return null;
  return <span className="muted"> — mengubah {changed.map((k) => FIELD_LABEL[k]).join(', ')}</span>;
}
