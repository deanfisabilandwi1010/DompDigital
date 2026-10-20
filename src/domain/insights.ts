// Catatan singkat berbasis aturan dan data — bukan nasihat yang dibuat-buat, tanpa skor kesehatan.

import { addDays, addMonthsClamped, addMonthsToMonth, daysBetween, formatRange, monthEnd, monthOf, monthStart } from './dates';
import { budgetRows, expenseByCategory, expenseSplit, isActive, periodSummary, unallocated } from './ledger';
import { percent } from './money';
import type { Period } from './dates';
import type { Dataset, LocalDate, Money } from './types';

export interface Insight {
  id: string;
  tone: 'info' | 'warn' | 'good';
  text: string;
  link?: { path: string; query: Record<string, string> };
}

export function buildInsights(ds: Dataset, period: Period, today: LocalDate, fmt: (n: Money) => string): Insight[] {
  const activeCount = ds.transactions.filter(isActive).length;
  if (activeCount < 3) {
    return [{ id: 'not-enough', tone: 'info', text: 'Catat beberapa transaksi untuk melihat pola.' }];
  }
  const out: Insight[] = [];
  const cats = new Map(ds.categories.map((c) => [c.id, c]));

  // 1. Anggaran bulan berjalan yang paling dekat/melewati batas.
  const month = monthOf(today);
  const rows = budgetRows(ds, month).filter((r) => r.state === 'warn' || r.state === 'over').sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  for (const r of rows.slice(0, 2)) {
    const name = cats.get(r.categoryId)?.name ?? 'Kategori';
    out.push({
      id: `budget-${r.budgetId}`,
      tone: 'warn',
      text:
        r.state === 'over'
          ? `${name} melewati anggaran bulan ini sebesar ${fmt(r.over)} (${r.pct}% dari ${fmt(r.limit)}).`
          : `${name} memakai ${r.pct}% anggaran bulan ini (${fmt(r.actual)} dari ${fmt(r.limit)}).`,
      link: { path: '/transaksi', query: { from: `${month}-01`, to: today, cat: r.categoryId, type: 'expense,refund' } },
    });
  }

  // 2. Pembanding pengeluaran dengan rentang setara.
  let curFrom = period.from;
  let curTo = period.to < today ? period.to : today;
  let prevFrom: LocalDate;
  let prevTo: LocalDate;
  if (curTo < curFrom) curTo = curFrom;
  if (period.preset === 'this-month') {
    // Bulan berjalan dibandingkan dengan tanggal setara di bulan sebelumnya.
    prevFrom = addMonthsClamped(curFrom, -1);
    prevTo = addMonthsClamped(curTo, -1);
  } else if (period.preset === 'last-month') {
    const m = addMonthsToMonth(monthOf(curFrom), -1);
    prevFrom = monthStart(m);
    prevTo = monthEnd(m);
  } else {
    const len = daysBetween(curFrom, curTo) + 1;
    prevTo = addDays(curFrom, -1);
    prevFrom = addDays(prevTo, -(len - 1));
  }
  const cur = periodSummary(ds, curFrom, curTo);
  const prev = periodSummary(ds, prevFrom, prevTo);
  if (prev.netExpense <= 0) {
    out.push({ id: 'compare', tone: 'info', text: `Pengeluaran bersih ${formatRange(curFrom, curTo)}: ${fmt(cur.netExpense)}. Belum ada pembanding untuk ${formatRange(prevFrom, prevTo)}.` });
  } else {
    const change = Math.round(((cur.netExpense - prev.netExpense) / prev.netExpense) * 100);
    const word = change > 0 ? `naik ${change}%` : change < 0 ? `turun ${Math.abs(change)}%` : 'sama';
    out.push({
      id: 'compare',
      tone: change > 15 ? 'warn' : change < 0 ? 'good' : 'info',
      text: `Pengeluaran bersih ${formatRange(curFrom, curTo)}: ${fmt(cur.netExpense)}, ${word} dibanding ${formatRange(prevFrom, prevTo)} (${fmt(prev.netExpense)}).`,
      link: { path: '/transaksi', query: { from: curFrom, to: curTo, type: 'expense,refund' } },
    });
  }

  // 3. Kategori dengan porsi terbesar dalam periode.
  const byCat = expenseByCategory(ds, period.from, period.to);
  const net = periodSummary(ds, period.from, period.to).netExpense;
  const top = byCat[0];
  const share = top ? percent(top.net, net) : null;
  if (top && top.net > 0 && share != null) {
    out.push({
      id: 'top-cat',
      tone: 'info',
      text: `Porsi terbesar periode ini: ${cats.get(top.categoryId)?.name ?? 'Kategori'} ${fmt(top.net)} (${share}% dari pengeluaran bersih).`,
      link: { path: '/transaksi', query: { from: period.from, to: period.to, cat: top.categoryId, type: 'expense,refund' } },
    });
  }

  // 4. Kebutuhan vs keinginan.
  const want = expenseSplit(ds, period.from, period.to, 'priority').find((r) => r.key === 'want')?.net ?? 0;
  const wantPct = percent(want, net);
  if (wantPct != null && want > 0) {
    out.push({
      id: 'want',
      tone: 'info',
      text: `Belanja bertanda keinginan: ${fmt(want)} (${wantPct}% dari pengeluaran bersih periode ini).`,
      link: { path: '/transaksi', query: { from: period.from, to: period.to, prio: 'want' } },
    });
  }

  // 5. Defisit dana belum dialokasikan.
  const un = unallocated(ds);
  if (un < 0) {
    out.push({ id: 'unalloc', tone: 'warn', text: `Dana belum dialokasikan defisit ${fmt(un)}. Kurangi alokasi kantong atau catat pemasukan yang belum tercatat.`, link: { path: '/kantong', query: {} } });
  }
  return out;
}
