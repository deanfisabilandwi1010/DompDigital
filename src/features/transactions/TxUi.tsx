// Formulir & detail transaksi dapat dibuka dari mana saja (header, FAB, pengingat, daftar).
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { ID, LocalDate, TxType } from '../../domain/types';
import { TransactionForm } from './TransactionForm';
import { TransactionDetail } from './TransactionDetail';

export interface TxTemplate {
  type?: TxType;
  amount?: number;
  accountId?: ID;
  categoryId?: ID;
  pocketId?: ID | null;
  note?: string;
  date?: LocalDate;
  originalExpenseId?: ID;
  occurrence?: { reminderId: ID; dueDate: LocalDate; label: string };
}

interface TxUiApi {
  openNew: (t?: TxTemplate) => void;
  openEdit: (id: ID) => void;
  openDetail: (id: ID) => void;
}

const Ctx = createContext<TxUiApi | null>(null);

export function useTxUi(): TxUiApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('TxUiProvider hilang');
  return v;
}

type State = { kind: 'new'; template: TxTemplate } | { kind: 'edit'; id: ID } | null;

export function TxUiProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<State>(null);
  const [detail, setDetail] = useState<ID | null>(null);
  const [formKey, setFormKey] = useState(0);

  const openNew = useCallback((t: TxTemplate = {}) => {
    setFormKey((k) => k + 1);
    setForm({ kind: 'new', template: t });
  }, []);
  const openEdit = useCallback((id: ID) => {
    setFormKey((k) => k + 1);
    setDetail(null);
    setForm({ kind: 'edit', id });
  }, []);
  const openDetail = useCallback((id: ID) => setDetail(id), []);

  return (
    <Ctx.Provider value={{ openNew, openEdit, openDetail }}>
      {children}
      {detail && <TransactionDetail key={detail} id={detail} onClose={() => setDetail(null)} />}
      {form && (
        <TransactionForm
          key={formKey}
          editId={form.kind === 'edit' ? form.id : undefined}
          template={form.kind === 'new' ? form.template : undefined}
          onClose={() => setForm(null)}
        />
      )}
    </Ctx.Provider>
  );
}
