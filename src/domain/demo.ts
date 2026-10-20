// Data demo fiktif = fixture uji deterministik (lihat src/tests/fixture.test.ts).
// Angka pada tabel acceptance test dapat dicek langsung di mode demo.

import { applyChanges } from './changes';
import {
  planAllocate,
  planOnboarding,
  planSaveGoal,
  planSaveReminder,
  planSaveTransaction,
  planSaveTransfer,
  planSetBudget,
  type Ctx,
} from './commands';
import { addMonthsToMonth, monthOf } from './dates';
import { PALETTE } from './defaults';
import { emptyDataset, type Change, type Dataset } from './types';

export interface FixtureStep {
  label: string;
  run: (ds: Dataset, ctx: Ctx) => Change[];
}

const byName = <T extends { name: string; id: string }>(rows: T[], name: string) => {
  const r = rows.find((x) => x.name === name);
  if (!r) throw new Error(`fixture: ${name} tidak ditemukan`);
  return r.id;
};

/** Bulan demo: bulan berjalan bila sudah lewat tanggal 6, selain itu bulan sebelumnya. */
export function demoMonth(today: string): string {
  return Number(today.slice(8, 10)) >= 6 ? monthOf(today) : addMonthsToMonth(monthOf(today), -1);
}

export function fixtureSteps(month: string): FixtureStep[] {
  const d = (day: number) => `${month}-${String(day).padStart(2, '0')}`;
  return [
    {
      label: 'Buka Bank Rp2.000.000 dan Tunai Rp500.000',
      run: (ds, ctx) =>
        planOnboarding(ds, {
          displayName: 'Demo',
          timezone: 'Asia/Jakarta',
          accounts: [
            { name: 'Bank', type: 'bank', openingBalance: 2_000_000, openingDate: d(1) },
            { name: 'Tunai', type: 'cash', openingBalance: 500_000, openingDate: d(1) },
          ],
          pockets: [{ name: 'Harian', icon: '☕', color: PALETTE.butter }],
        }, ctx),
    },
    {
      label: 'Pemasukan Rp5.000.000 ke Bank',
      run: (ds, ctx) =>
        planSaveTransaction(ds, { type: 'income', date: d(2), amount: 5_000_000, accountId: byName(ds.accounts, 'Bank'), categoryId: byName(ds.categories, 'Gaji'), note: 'Gaji bulan ini' }, ctx),
    },
    {
      label: 'Alokasikan Rp1.000.000 ke Harian',
      run: (ds, ctx) => planAllocate(ds, { date: d(2), fromPocketId: null, toPocketId: byName(ds.pockets, 'Harian'), amount: 1_000_000 }, ctx),
    },
    {
      label: 'Belanja makanan Rp100.000 dari Tunai dan kantong Harian',
      run: (ds, ctx) =>
        planSaveTransaction(ds, {
          type: 'expense', date: d(3), amount: 100_000, accountId: byName(ds.accounts, 'Tunai'),
          categoryId: byName(ds.categories, 'Makan & minum'), pocketId: byName(ds.pockets, 'Harian'), note: 'Belanja makanan mingguan', tags: ['pasar'],
        }, ctx),
    },
    {
      label: 'Transfer Bank ke Tunai Rp200.000, biaya Rp2.500',
      run: (ds, ctx) =>
        planSaveTransfer(ds, { date: d(4), amount: 200_000, fromAccountId: byName(ds.accounts, 'Bank'), toAccountId: byName(ds.accounts, 'Tunai'), fee: 2_500, note: 'Tarik tunai' }, ctx),
    },
    {
      label: 'Refund belanja Rp25.000 ke Tunai',
      run: (ds, ctx) => {
        const orig = ds.transactions.find((t) => t.type === 'expense' && t.amount === 100_000)!;
        return planSaveTransaction(ds, { type: 'refund', date: d(5), amount: 25_000, accountId: byName(ds.accounts, 'Tunai'), originalExpenseId: orig.id, note: 'Barang tidak tersedia' }, ctx);
      },
    },
  ];
}

/** Rencana tambahan non-transaksi agar fitur anggaran, tujuan, dan pengingat bisa dicoba. */
function demoExtras(month: string): FixtureStep[] {
  return [
    { label: 'Anggaran makan', run: (ds, ctx) => planSetBudget(ds, { month, categoryId: byName(ds.categories, 'Makan & minum'), limitAmount: 1_200_000 }, ctx) },
    { label: 'Anggaran transportasi', run: (ds, ctx) => planSetBudget(ds, { month, categoryId: byName(ds.categories, 'Transportasi'), limitAmount: 400_000 }, ctx) },
    {
      label: 'Tujuan laptop',
      run: (ds, ctx) =>
        planSaveGoal(ds, { name: 'Laptop baru', targetAmount: 12_000_000, deadline: `${addMonthsToMonth(month, 8)}-28`, icon: '💻', color: PALETTE.lilac, pocketId: null, newPocketName: 'Laptop' }, ctx),
    },
    {
      label: 'Pengingat internet',
      run: (ds, ctx) =>
        planSaveReminder(ds, {
          name: 'Internet rumah', kind: 'bill', frequency: 'monthly', anchorDate: `${month}-10`, amount: 350_000,
          accountId: byName(ds.accounts, 'Bank'), categoryId: byName(ds.categories, 'Listrik/air/internet'), pocketId: null, active: true,
        }, ctx),
    },
  ];
}

export function runSteps(steps: FixtureStep[], ctx: Ctx, start: Dataset = emptyDataset()): Dataset {
  return steps.reduce((ds, s) => applyChanges(ds, s.run(ds, ctx)), start);
}

export function buildDemoDataset(ctx: Ctx): Dataset {
  const month = demoMonth(ctx.today);
  return runSteps([...fixtureSteps(month), ...demoExtras(month)], ctx);
}
