import { describe, expect, it } from 'vitest';
import { applyChanges, assessDeficits } from '../domain/changes';
import {
  planAllocate,
  planSaveTransaction,
  planSaveTransfer,
  planUnvoidTransaction,
  planVoidTransaction,
  type Ctx,
} from '../domain/commands';
import { fixtureSteps, runSteps } from '../domain/demo';
import {
  accountBalance,
  expenseByCategory,
  periodSummary,
  pocketBalance,
  totalBalance,
  unallocated,
} from '../domain/ledger';
import { emptyDataset, type Dataset } from '../domain/types';

const MONTH = '2026-10';
const ctx: Ctx = { today: '2026-10-21', now: '2026-10-21T03:00:00.000Z' };
const id = (ds: Dataset, table: 'accounts' | 'pockets' | 'categories', name: string) => ds[table].find((r) => r.name === name)!.id;

function stepState(n: number): Dataset {
  return runSteps(fixtureSteps(MONTH).slice(0, n), ctx, emptyDataset());
}

describe('fixture acceptance (spesifikasi §17)', () => {
  it('1. buka Bank Rp2.000.000 dan Tunai Rp500.000', () => {
    const ds = stepState(1);
    expect(totalBalance(ds)).toBe(2_500_000);
    expect(periodSummary(ds, `${MONTH}-01`, `${MONTH}-31`).income).toBe(0);
  });

  it('2. pemasukan Rp5.000.000 ke Bank', () => {
    const ds = stepState(2);
    expect(totalBalance(ds)).toBe(7_500_000);
    expect(periodSummary(ds, `${MONTH}-01`, `${MONTH}-31`).income).toBe(5_000_000);
  });

  it('3. alokasi Rp1.000.000 ke Harian', () => {
    const ds = stepState(3);
    expect(pocketBalance(ds, id(ds, 'pockets', 'Harian'))).toBe(1_000_000);
    expect(unallocated(ds)).toBe(6_500_000);
    expect(totalBalance(ds)).toBe(7_500_000);
  });

  it('4. belanja Rp100.000 dari Tunai + Harian', () => {
    const ds = stepState(4);
    expect(accountBalance(ds, id(ds, 'accounts', 'Tunai'))).toBe(400_000);
    expect(pocketBalance(ds, id(ds, 'pockets', 'Harian'))).toBe(900_000);
    expect(totalBalance(ds)).toBe(7_400_000);
  });

  it('5. transfer Bank→Tunai Rp200.000 biaya Rp2.500', () => {
    const ds = stepState(5);
    expect(accountBalance(ds, id(ds, 'accounts', 'Bank'))).toBe(6_797_500);
    expect(accountBalance(ds, id(ds, 'accounts', 'Tunai'))).toBe(600_000);
    expect(totalBalance(ds)).toBe(7_397_500);
  });

  it('6. refund Rp25.000 ke Tunai', () => {
    const ds = stepState(6);
    expect(accountBalance(ds, id(ds, 'accounts', 'Tunai'))).toBe(625_000);
    expect(pocketBalance(ds, id(ds, 'pockets', 'Harian'))).toBe(925_000);
    expect(totalBalance(ds)).toBe(7_422_500);
  });

  it('7. laporan periode', () => {
    const s = periodSummary(stepState(6), `${MONTH}-01`, `${MONTH}-31`);
    expect(s.income).toBe(5_000_000);
    expect(s.grossExpense).toBe(102_500);
    expect(s.refunds).toBe(25_000);
    expect(s.netExpense).toBe(77_500);
    expect(s.diff).toBe(4_922_500);
    // Saldo akhir = saldo awal + selisih + pembukaan baru + penyesuaian
    expect(s.endBalance).toBe(s.startBalance + s.diff + s.openings + s.adjustments);
  });

  it('8. invariant kantong + belum dialokasikan = total', () => {
    const ds = stepState(6);
    const pockets = pocketBalance(ds, id(ds, 'pockets', 'Harian'));
    expect(pockets).toBe(925_000);
    expect(unallocated(ds)).toBe(6_497_500);
    expect(pockets + unallocated(ds)).toBe(totalBalance(ds));
  });
});

describe('aturan tambahan', () => {
  const full = () => stepState(6);

  it('transfer tidak menaikkan pemasukan/pengeluaran selain biaya', () => {
    const before = stepState(4);
    const after = stepState(5);
    const a = periodSummary(before, `${MONTH}-01`, `${MONTH}-31`);
    const b = periodSummary(after, `${MONTH}-01`, `${MONTH}-31`);
    expect(b.income).toBe(a.income);
    expect(b.grossExpense - a.grossExpense).toBe(2_500);
  });

  it('void transfer + biaya atomik, lalu unvoid memulihkan keduanya', () => {
    const ds = full();
    const transfer = ds.transactions.find((t) => t.type === 'transfer')!;
    const voided = applyChanges(ds, planVoidTransaction(ds, transfer.id, ctx));
    const group = voided.transactions.filter((t) => t.groupId === transfer.groupId);
    expect(group).toHaveLength(2);
    expect(group.every((t) => t.status === 'voided')).toBe(true);
    expect(totalBalance(voided)).toBe(7_425_000);
    const restored = applyChanges(voided, planUnvoidTransaction(voided, transfer.id, ctx));
    expect(totalBalance(restored)).toBe(7_422_500);
  });

  it('edit transfer menghapus biaya tanpa ikut dipulihkan', () => {
    const ds = full();
    const transfer = ds.transactions.find((t) => t.type === 'transfer')!;
    const edited = applyChanges(ds, planSaveTransfer(ds, { id: transfer.id, date: transfer.date, amount: 200_000, fromAccountId: transfer.accountId, toAccountId: transfer.destinationAccountId!, fee: 0 }, ctx));
    expect(totalBalance(edited)).toBe(7_425_000);
    const v = applyChanges(edited, planVoidTransaction(edited, transfer.id, ctx));
    const u = applyChanges(v, planUnvoidTransaction(v, transfer.id, ctx));
    expect(totalBalance(u)).toBe(7_425_000);
  });

  it('refund melebihi pengeluaran asal ditolak', () => {
    const ds = full();
    const orig = ds.transactions.find((t) => t.type === 'expense' && t.amount === 100_000)!;
    expect(() => planSaveTransaction(ds, { type: 'refund', date: `${MONTH}-06`, amount: 75_001, accountId: orig.accountId, originalExpenseId: orig.id }, ctx)).toThrow(/melebihi/);
    expect(() => planSaveTransaction(ds, { type: 'refund', date: `${MONTH}-06`, amount: 75_000, accountId: orig.accountId, originalExpenseId: orig.id }, ctx)).not.toThrow();
  });

  it('pengeluaran dengan refund tidak dapat diedit/dibatalkan', () => {
    const ds = full();
    const orig = ds.transactions.find((t) => t.type === 'expense' && t.amount === 100_000)!;
    expect(() => planVoidTransaction(ds, orig.id, ctx)).toThrow(/pengembalian/);
    expect(() => planSaveTransaction(ds, { ...orig, type: 'expense', amount: 90_000 }, ctx)).toThrow(/pengembalian/);
  });

  it('refund lintas bulan masuk bulan penerimaan', () => {
    const ds = full();
    const orig = ds.transactions.find((t) => t.type === 'expense' && t.amount === 100_000)!;
    const later: Ctx = { today: '2026-11-15', now: '2026-11-15T00:00:00.000Z' };
    const next = applyChanges(ds, planSaveTransaction(ds, { type: 'refund', date: '2026-11-02', amount: 50_000, accountId: orig.accountId, originalExpenseId: orig.id }, later));
    const oct = periodSummary(next, '2026-10-01', '2026-10-31');
    const nov = periodSummary(next, '2026-11-01', '2026-11-30');
    expect(oct.refunds).toBe(25_000);
    expect(nov.refunds).toBe(50_000);
    expect(nov.netExpense).toBe(-50_000);
    const cats = expenseByCategory(next, '2026-11-01', '2026-11-30');
    expect(cats[0].net).toBe(-50_000);
  });

  it('transaksi sebelum tanggal pembukaan ditolak; tanggal masa depan ditolak', () => {
    const ds = full();
    const bank = id(ds, 'accounts', 'Bank');
    const gaji = id(ds, 'categories', 'Gaji');
    expect(() => planSaveTransaction(ds, { type: 'income', date: '2026-09-30', amount: 1, accountId: bank, categoryId: gaji }, ctx)).toThrow(/pembukaan/);
    expect(() => planSaveTransaction(ds, { type: 'income', date: '2026-10-22', amount: 1, accountId: bank, categoryId: gaji }, ctx)).toThrow(/masa depan/);
  });

  it('alokasi melebihi dana tersedia ditolak', () => {
    const ds = full();
    const harian = id(ds, 'pockets', 'Harian');
    expect(() => planAllocate(ds, { date: `${MONTH}-10`, fromPocketId: null, toPocketId: harian, amount: 6_497_501 }, ctx)).toThrow(/Dana tersedia/);
    expect(() => planAllocate(ds, { date: `${MONTH}-10`, fromPocketId: harian, toPocketId: null, amount: 925_001 }, ctx)).toThrow(/Dana tersedia/);
  });

  it('pengeluaran yang membuat kantong negatif terdeteksi sebagai defisit', () => {
    const ds = full();
    const after = applyChanges(ds, planSaveTransaction(ds, {
      type: 'expense', date: `${MONTH}-10`, amount: 1_000_000, accountId: id(ds, 'accounts', 'Bank'),
      categoryId: id(ds, 'categories', 'Hiburan'), pocketId: id(ds, 'pockets', 'Harian'),
    }, ctx));
    const d = assessDeficits(ds, after);
    expect(d.map((x) => x.kind)).toEqual(['pocket']);
    expect(d[0].after).toBe(-75_000);
  });
});
