import { useStore } from '../../app/store';
import { Amount } from '../../components/ui';
import { formatDate } from '../../domain/dates';
import { TX_TYPE_LABEL } from '../../domain/defaults';
import { signedFlow } from '../../domain/ledger';
import type { Dataset, Transaction } from '../../domain/types';

export function txTitle(ds: Dataset, t: Transaction): string {
  const acc = (id: string | null) => ds.accounts.find((a) => a.id === id)?.name ?? '?';
  if (t.type === 'transfer') return `Transfer ${acc(t.accountId)} → ${acc(t.destinationAccountId)}`;
  const cat = ds.categories.find((c) => c.id === t.categoryId)?.name ?? TX_TYPE_LABEL[t.type];
  if (t.type === 'refund') return `Pengembalian · ${cat}`;
  return cat;
}

export function txIcon(ds: Dataset, t: Transaction): string {
  if (t.type === 'transfer') return '🔁';
  if (t.type === 'refund') return '↩️';
  return ds.categories.find((c) => c.id === t.categoryId)?.icon ?? '•';
}

export function txAmountValue(t: Transaction): number {
  return t.type === 'transfer' ? t.amount : signedFlow(t);
}

export function TxRow({ t, onOpen }: { t: Transaction; onOpen: (id: string) => void }) {
  const { ds } = useStore();
  const acc = ds.accounts.find((a) => a.id === t.accountId)?.name ?? '';
  const pocket = t.pocketId ? ds.pockets.find((p) => p.id === t.pocketId)?.name : null;
  const meta = [formatDate(t.date), acc, pocket ? `Kantong ${pocket}` : null, t.note || null].filter(Boolean).join(' · ');
  const value = txAmountValue(t);
  return (
    <button type="button" className={`tx-row ${t.status === 'voided' ? 'tx-row--void' : ''}`} onClick={() => onOpen(t.id)}>
      <span className="tx-row__icon" aria-hidden="true">{txIcon(ds, t)}</span>
      <span style={{ minWidth: 0 }}>
        <span className="tx-row__title" style={{ display: 'block' }}>
          {txTitle(ds, t)} {t.status === 'voided' && <span className="badge badge--void">Batal</span>}
        </span>
        <span className="tx-row__meta" style={{ display: 'block' }}>{meta}</span>
      </span>
      <span className="tx-row__amount">
        <Amount value={value} sign={t.type !== 'transfer'} />
      </span>
    </button>
  );
}
