import { describe, expect, it } from 'vitest';
import { makeBackup, parseBackup } from '../domain/backup';
import { applyChanges } from '../domain/changes';
import { planSetBudget, planSetOccurrence, planSaveTransaction, planSaveGoal, planVoidTransaction, type Ctx } from '../domain/commands';
import { csvCell, toCsv, transactionsCsv } from '../domain/csv';
import { addMonthsClamped, isValidDate, periodFromPreset, startOfWeek } from '../domain/dates';
import { fixtureSteps, runSteps } from '../domain/demo';
import { budgetRows, filterTransactions, goalStatus, periodSummary, totalBalance, totalsOf, unallocated } from '../domain/ledger';
import { formatRupiah, parseAmountInput, percent } from '../domain/money';
import { dueDatesBetween, reminderAgenda } from '../domain/reminders';
import { buildInsights } from '../domain/insights';
import { emptyDataset } from '../domain/types';

const ctx: Ctx = { today: '2026-10-21', now: '2026-10-21T03:00:00.000Z' };
const full = () => runSteps(fixtureSteps('2026-10'), ctx);

describe('money', () => {
  it('parse input nominal', () => {
    expect(parseAmountInput('1.250.000')).toEqual({ ok: true, value: 1_250_000 });
    expect(parseAmountInput('Rp 5000')).toEqual({ ok: true, value: 5000 });
    for (const bad of ['', '0', '-5', '12,5', 'abc', '99999999999999999', 'NaN']) {
      expect(parseAmountInput(bad).ok).toBe(false);
    }
  });
  it('format & persen aman', () => {
    expect(formatRupiah(2_000_000)).toBe('Rp2.000.000');
    expect(formatRupiah(-2500)).toBe('−Rp2.500');
    expect(percent(5, 0)).toBeNull();
    expect(percent(1, -3)).toBeNull();
  });
});

describe('dates', () => {
  it('akhir bulan & pergantian tahun', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15');
    expect(isValidDate('2026-02-30')).toBe(false);
  });
  it('minggu dimulai Senin; preset periode', () => {
    expect(startOfWeek('2026-10-21')).toBe('2026-10-19'); // Rabu → Senin
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19'); // Minggu → Senin sebelumnya
    expect(periodFromPreset('last-month', '2026-01-10')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('pengingat', () => {
  it('tanggal 31 dijepit ke akhir bulan', () => {
    const r = { anchorDate: '2026-01-31', frequency: 'monthly' as const };
    expect(dueDatesBetween(r, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('mingguan & tahunan', () => {
    expect(dueDatesBetween({ anchorDate: '2026-10-01', frequency: 'weekly' }, '2026-10-10', '2026-10-31')).toEqual(['2026-10-15', '2026-10-22', '2026-10-29']);
    expect(dueDatesBetween({ anchorDate: '2024-02-29', frequency: 'yearly' }, '2025-01-01', '2026-12-31')).toEqual(['2025-02-28', '2026-02-28']);
  });
  it('catat dari pengingat tidak ganda & void membuka kembali', () => {
    let ds = full();
    const bank = ds.accounts.find((a) => a.name === 'Bank')!.id;
    const cat = ds.categories.find((c) => c.name === 'Listrik/air/internet')!.id;
    ds = applyChanges(ds, [{ table: 'reminders', op: 'put', row: { id: 'rem-00001', name: 'Internet', kind: 'bill', frequency: 'monthly', anchorDate: '2026-10-10', amount: 350_000, accountId: bank, categoryId: cat, pocketId: null, active: true, version: 1, createdAt: ctx.now, updatedAt: ctx.now } }]);
    const input = { type: 'expense' as const, date: '2026-10-11', amount: 350_000, accountId: bank, categoryId: cat, occurrence: { reminderId: 'rem-00001', dueDate: '2026-10-10' } };
    const once = applyChanges(ds, planSaveTransaction(ds, input, ctx));
    expect(() => planSaveTransaction(once, input, ctx)).toThrow(/sudah dicatat/);
    expect(reminderAgenda(once, ctx.today).overdue).toHaveLength(0);
    const tx = once.transactions.find((t) => t.amount === 350_000)!;
    const voided = applyChanges(once, planVoidTransaction(once, tx.id, ctx));
    expect(reminderAgenda(voided, ctx.today).overdue.map((i) => i.dueDate)).toEqual(['2026-10-10']);
    const skipped = applyChanges(voided, planSetOccurrence(voided, 'rem-00001', '2026-10-10', 'skipped', ctx));
    expect(reminderAgenda(skipped, ctx.today).overdue).toHaveLength(0);
  });
});

describe('anggaran & tujuan', () => {
  it('anggaran nol, lebih, dan negatif tidak NaN/Infinity', () => {
    let ds = full();
    const makan = ds.categories.find((c) => c.name === 'Makan & minum')!.id;
    const hiburan = ds.categories.find((c) => c.name === 'Hiburan')!.id;
    ds = applyChanges(ds, planSetBudget(ds, { month: '2026-10', categoryId: makan, limitAmount: 60_000 }, ctx));
    ds = applyChanges(ds, planSetBudget(ds, { month: '2026-10', categoryId: hiburan, limitAmount: 0 }, ctx));
    const rows = budgetRows(ds, '2026-10');
    const m = rows.find((r) => r.categoryId === makan)!;
    expect(m.actual).toBe(75_000);
    expect(m.state).toBe('over');
    expect(m.pct).toBe(125);
    expect(m.barPct).toBe(100);
    expect(m.over).toBe(15_000);
    const h = rows.find((r) => r.categoryId === hiburan)!;
    expect(h.state).toBe('none');
    expect(h.pct).toBeNull();
    // Edit anggaran yang sama memperbarui, bukan duplikasi.
    ds = applyChanges(ds, planSetBudget(ds, { month: '2026-10', categoryId: makan, limitAmount: 100_000 }, ctx));
    expect(ds.budgets.filter((b) => b.categoryId === makan)).toHaveLength(1);
  });

  it('tujuan membaca saldo kantong, estimasi per bulan dibulatkan ke atas', () => {
    let ds = full();
    const harian = ds.pockets.find((p) => p.name === 'Harian')!.id;
    ds = applyChanges(ds, planSaveGoal(ds, { name: 'Dana', targetAmount: 1_000_000, deadline: '2026-12-31', icon: '🎯', color: '#fff', pocketId: harian }, ctx));
    const g = goalStatus(ds, ds.goals[0].id, ctx.today)!;
    expect(g.saved).toBe(925_000);
    expect(g.remaining).toBe(75_000);
    expect(g.monthsLeft).toBe(3);
    expect(g.perMonth).toBe(25_000);
    const late = goalStatus(ds, ds.goals[0].id, '2027-01-05')!;
    expect(late.overdue).toBe(true);
    expect(late.perMonth).toBeNull();
    // Saldo total tidak bertambah karena tujuan.
    expect(totalBalance(ds)).toBe(7_422_500);
  });
});

describe('filter, total, CSV', () => {
  it('populasi filter = total = baris CSV', () => {
    const ds = full();
    const list = filterTransactions(ds, { from: '2026-10-01', to: '2026-10-31', types: ['expense', 'refund'] });
    const totals = totalsOf(list);
    expect(totals.netExpense).toBe(periodSummary(ds, '2026-10-01', '2026-10-31').netExpense);
    const csv = transactionsCsv(ds, list, { from: '2026-10-01', to: '2026-10-31' });
    expect(csv.trim().split('\r\n')).toHaveLength(list.length + 1);
  });
  it('sanitasi formula & escape', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell(-2500)).toBe('-2500');
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(toCsv(['x'], [[1]])).toBe('﻿x\r\n1\r\n');
  });
});

describe('backup & restore', () => {
  it('ekspor → impor menghasilkan saldo, relasi, dan jumlah record sama', () => {
    const ds = full();
    const parsed = parseBackup(JSON.stringify(makeBackup(ds, 'personal')));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(totalBalance(parsed.ds)).toBe(totalBalance(ds));
    expect(unallocated(parsed.ds)).toBe(unallocated(ds));
    expect(parsed.ds.transactions).toHaveLength(ds.transactions.length);
    expect(parsed.preview.counts.auditEvents).toBe(ds.auditEvents.length);
  });
  it('JSON rusak, schema baru, dan referensi yatim ditolak', () => {
    expect(parseBackup('{oops').ok).toBe(false);
    const b = makeBackup(full(), 'personal');
    expect(parseBackup(JSON.stringify({ ...b, schemaVersion: 99 })).ok).toBe(false);
    const orphan = structuredClone(b);
    orphan.tables.transactions[0].accountId = 'tidak-ada-123';
    const r = parseBackup(JSON.stringify(orphan));
    expect(r.ok).toBe(false);
  });
});

describe('insight', () => {
  it('data kosong tidak menghasilkan Infinity', () => {
    const ins = buildInsights(emptyDataset(), periodFromPreset('this-month', ctx.today), ctx.today, formatRupiah);
    expect(ins[0].text).toMatch(/Catat beberapa transaksi/);
    const ins2 = buildInsights(full(), periodFromPreset('this-month', ctx.today), ctx.today, formatRupiah);
    expect(ins2.some((i) => /Belum ada pembanding/.test(i.text))).toBe(true);
    expect(ins2.every((i) => !/Infinity|NaN/.test(i.text))).toBe(true);
  });
});
