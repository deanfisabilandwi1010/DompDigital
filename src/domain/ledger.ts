// Aggregator tunggal: dashboard, laporan, ekspor, dan validasi membaca rumus dari sini.
// Saldo tidak pernah disimpan; selalu dihitung dari record sumber.

import { add, sum } from './money';
import { addDays, addMonthsToMonth, daysBetween, formatMonth, formatShortDay, monthEnd, monthOf, monthStart, startOfWeek } from './dates';
import type {
  Account,
  Behavior,
  Dataset,
  ID,
  LocalDate,
  Money,
  Priority,
  Transaction,
  TxType,
} from './types';

export const isActive = (r: { status: string }) => r.status === 'active';
const inRange = (d: LocalDate, from: LocalDate, to: LocalDate) => d >= from && d <= to;

// ---------------- Efek rekening ----------------

export type AccountEffectKind = 'opening' | 'income' | 'expense' | 'refund' | 'transferIn' | 'transferOut' | 'adjustment';

export interface AccountEffect {
  date: LocalDate;
  accountId: ID;
  kind: AccountEffectKind;
  delta: Money;
  sourceId: ID;
}

/** Seluruh efek terhadap saldo rekening dari record aktif. Transfer menghasilkan dua efek. */
export function accountEffects(ds: Dataset): AccountEffect[] {
  const out: AccountEffect[] = [];
  for (const a of ds.accounts) {
    out.push({ date: a.openingDate, accountId: a.id, kind: 'opening', delta: a.openingBalance, sourceId: a.id });
  }
  for (const t of ds.transactions) {
    if (!isActive(t)) continue;
    switch (t.type) {
      case 'income':
        out.push({ date: t.date, accountId: t.accountId, kind: 'income', delta: t.amount, sourceId: t.id });
        break;
      case 'expense':
        out.push({ date: t.date, accountId: t.accountId, kind: 'expense', delta: -t.amount, sourceId: t.id });
        break;
      case 'refund':
        out.push({ date: t.date, accountId: t.accountId, kind: 'refund', delta: t.amount, sourceId: t.id });
        break;
      case 'transfer':
        out.push({ date: t.date, accountId: t.accountId, kind: 'transferOut', delta: -t.amount, sourceId: t.id });
        if (t.destinationAccountId) {
          out.push({ date: t.date, accountId: t.destinationAccountId, kind: 'transferIn', delta: t.amount, sourceId: t.id });
        }
        break;
    }
  }
  for (const j of ds.adjustments) {
    if (!isActive(j)) continue;
    out.push({ date: j.date, accountId: j.accountId, kind: 'adjustment', delta: j.signedAmount, sourceId: j.id });
  }
  return out;
}

/** Saldo rekening pada akhir tanggal asOf (inklusif). Tanpa asOf: semua record. */
export function accountBalances(ds: Dataset, asOf?: LocalDate): Map<ID, Money> {
  const m = new Map<ID, Money>(ds.accounts.map((a) => [a.id, 0]));
  for (const e of accountEffects(ds)) {
    if (asOf && e.date > asOf) continue;
    m.set(e.accountId, add(m.get(e.accountId) ?? 0, e.delta));
  }
  return m;
}

export function accountBalance(ds: Dataset, accountId: ID, asOf?: LocalDate): Money {
  return accountBalances(ds, asOf).get(accountId) ?? 0;
}

/** Saldo total = jumlah seluruh rekening, termasuk rekening arsip. */
export function totalBalance(ds: Dataset, asOf?: LocalDate): Money {
  return sum(accountBalances(ds, asOf).values());
}

// ---------------- Efek kantong ----------------

export type PocketEffectKind = 'allocIn' | 'allocOut' | 'spent' | 'refunded';

export interface PocketEffect {
  date: LocalDate;
  pocketId: ID;
  kind: PocketEffectKind;
  delta: Money;
  sourceId: ID;
}

export function pocketEffects(ds: Dataset): PocketEffect[] {
  const out: PocketEffect[] = [];
  for (const a of ds.allocations) {
    if (!isActive(a)) continue;
    if (a.toPocketId) out.push({ date: a.date, pocketId: a.toPocketId, kind: 'allocIn', delta: a.amount, sourceId: a.id });
    if (a.fromPocketId) out.push({ date: a.date, pocketId: a.fromPocketId, kind: 'allocOut', delta: -a.amount, sourceId: a.id });
  }
  for (const t of ds.transactions) {
    if (!isActive(t) || !t.pocketId) continue;
    if (t.type === 'expense') out.push({ date: t.date, pocketId: t.pocketId, kind: 'spent', delta: -t.amount, sourceId: t.id });
    if (t.type === 'refund') out.push({ date: t.date, pocketId: t.pocketId, kind: 'refunded', delta: t.amount, sourceId: t.id });
  }
  return out;
}

export function pocketBalances(ds: Dataset, asOf?: LocalDate): Map<ID, Money> {
  const m = new Map<ID, Money>(ds.pockets.map((p) => [p.id, 0]));
  for (const e of pocketEffects(ds)) {
    if (asOf && e.date > asOf) continue;
    m.set(e.pocketId, add(m.get(e.pocketId) ?? 0, e.delta));
  }
  return m;
}

export function pocketBalance(ds: Dataset, pocketId: ID, asOf?: LocalDate): Money {
  return pocketBalances(ds, asOf).get(pocketId) ?? 0;
}

/** Dana belum dialokasikan = saldo total − jumlah saldo semua kantong (termasuk arsip). */
export function unallocated(ds: Dataset, asOf?: LocalDate): Money {
  return totalBalance(ds, asOf) - sum(pocketBalances(ds, asOf).values());
}

// ---------------- Ringkasan periode ----------------

export interface PeriodSummary {
  from: LocalDate;
  to: LocalDate;
  income: Money;
  grossExpense: Money;
  refunds: Money;
  netExpense: Money;
  diff: Money;
  startBalance: Money;
  openings: Money;
  adjustments: Money;
  endBalance: Money;
  txCount: number;
}

export function periodSummary(ds: Dataset, from: LocalDate, to: LocalDate): PeriodSummary {
  let income = 0;
  let gross = 0;
  let refunds = 0;
  let txCount = 0;
  for (const t of ds.transactions) {
    if (!isActive(t) || !inRange(t.date, from, to)) continue;
    txCount++;
    if (t.type === 'income') income = add(income, t.amount);
    else if (t.type === 'expense') gross = add(gross, t.amount);
    else if (t.type === 'refund') refunds = add(refunds, t.amount);
  }
  const openings = sum(ds.accounts.filter((a) => inRange(a.openingDate, from, to)).map((a) => a.openingBalance));
  const adjustments = sum(ds.adjustments.filter((j) => isActive(j) && inRange(j.date, from, to)).map((j) => j.signedAmount));
  const netExpense = gross - refunds;
  return {
    from,
    to,
    income,
    grossExpense: gross,
    refunds,
    netExpense,
    diff: income - netExpense,
    startBalance: totalBalance(ds, addDays(from, -1)),
    openings,
    adjustments,
    endBalance: totalBalance(ds, to),
    txCount,
  };
}

// ---------------- Kategori ----------------

export interface CategoryRow {
  categoryId: ID;
  gross: Money;
  refunds: Money;
  net: Money;
  count: number;
}

/** Pengeluaran bersih per kategori dalam periode. Refund mengikuti kategori transaksi asal. */
export function expenseByCategory(ds: Dataset, from: LocalDate, to: LocalDate): CategoryRow[] {
  const m = new Map<ID, CategoryRow>();
  for (const t of ds.transactions) {
    if (!isActive(t) || !inRange(t.date, from, to) || !t.categoryId) continue;
    if (t.type !== 'expense' && t.type !== 'refund') continue;
    const row = m.get(t.categoryId) ?? { categoryId: t.categoryId, gross: 0, refunds: 0, net: 0, count: 0 };
    if (t.type === 'expense') row.gross = add(row.gross, t.amount);
    else row.refunds = add(row.refunds, t.amount);
    row.net = row.gross - row.refunds;
    row.count++;
    m.set(t.categoryId, row);
  }
  return [...m.values()].sort((a, b) => b.net - a.net);
}

export function incomeByCategory(ds: Dataset, from: LocalDate, to: LocalDate): CategoryRow[] {
  const m = new Map<ID, CategoryRow>();
  for (const t of ds.transactions) {
    if (!isActive(t) || t.type !== 'income' || !inRange(t.date, from, to) || !t.categoryId) continue;
    const row = m.get(t.categoryId) ?? { categoryId: t.categoryId, gross: 0, refunds: 0, net: 0, count: 0 };
    row.gross = add(row.gross, t.amount);
    row.net = row.gross;
    row.count++;
    m.set(t.categoryId, row);
  }
  return [...m.values()].sort((a, b) => b.net - a.net);
}

export interface SplitRow<K extends string> {
  key: K | 'none';
  net: Money;
}

/** Pengeluaran bersih menurut prioritas (kebutuhan/keinginan) atau sifat (tetap/variabel). */
export function expenseSplit<K extends 'priority' | 'behavior'>(
  ds: Dataset,
  from: LocalDate,
  to: LocalDate,
  dim: K,
): SplitRow<K extends 'priority' ? Priority : Behavior>[] {
  const m = new Map<string, Money>();
  for (const t of ds.transactions) {
    if (!isActive(t) || !inRange(t.date, from, to)) continue;
    if (t.type !== 'expense' && t.type !== 'refund') continue;
    const k = (t[dim] as string | null) ?? 'none';
    m.set(k, add(m.get(k) ?? 0, t.type === 'expense' ? t.amount : -t.amount));
  }
  return [...m.entries()].map(([key, net]) => ({ key, net })) as SplitRow<K extends 'priority' ? Priority : Behavior>[];
}

// ---------------- Seri waktu ----------------

export type Granularity = 'day' | 'week' | 'month';

export interface SeriesBucket {
  key: string;
  label: string;
  from: LocalDate;
  to: LocalDate;
  income: Money;
  netExpense: Money;
}

export function granularityFor(from: LocalDate, to: LocalDate): Granularity {
  const days = daysBetween(from, to) + 1;
  if (days <= 31) return 'day';
  if (days <= 26 * 7) return 'week';
  return 'month';
}

export function cashflowSeries(ds: Dataset, from: LocalDate, to: LocalDate, g: Granularity = granularityFor(from, to)): SeriesBucket[] {
  const buckets: SeriesBucket[] = [];
  if (g === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) buckets.push({ key: d, label: formatShortDay(d), from: d, to: d, income: 0, netExpense: 0 });
  } else if (g === 'week') {
    for (let d = startOfWeek(from); d <= to; d = addDays(d, 7)) {
      const bf = d < from ? from : d;
      const bt = addDays(d, 6) > to ? to : addDays(d, 6);
      buckets.push({ key: d, label: `Mg ${formatShortDay(bf)}`, from: bf, to: bt, income: 0, netExpense: 0 });
    }
  } else {
    for (let m = monthOf(from); m <= monthOf(to); m = addMonthsToMonth(m, 1)) {
      const bf = monthStart(m) < from ? from : monthStart(m);
      const bt = monthEnd(m) > to ? to : monthEnd(m);
      buckets.push({ key: m, label: formatMonth(m).replace(/^(\w{3})\w*/, '$1'), from: bf, to: bt, income: 0, netExpense: 0 });
    }
  }
  const find = (d: LocalDate) => buckets.find((b) => d >= b.from && d <= b.to);
  for (const t of ds.transactions) {
    if (!isActive(t) || !inRange(t.date, from, to)) continue;
    const b = find(t.date);
    if (!b) continue;
    if (t.type === 'income') b.income = add(b.income, t.amount);
    else if (t.type === 'expense') b.netExpense = add(b.netExpense, t.amount);
    else if (t.type === 'refund') b.netExpense = add(b.netExpense, -t.amount);
  }
  return buckets;
}

// ---------------- Anggaran ----------------

export type BudgetState = 'none' | 'ok' | 'warn' | 'over';

export interface BudgetRow {
  budgetId: ID;
  categoryId: ID;
  limit: Money;
  actual: Money;
  pct: number | null;
  /** Lebar bar visual 0–100. */
  barPct: number;
  over: Money;
  remaining: Money;
  state: BudgetState;
}

export function budgetRows(ds: Dataset, month: string): BudgetRow[] {
  const actuals = new Map(expenseByCategory(ds, monthStart(month), monthEnd(month)).map((r) => [r.categoryId, r.net]));
  const warn = ds.settings.budgetWarnPct;
  return ds.budgets
    .filter((b) => b.month === month)
    .map((b) => {
      const actual = actuals.get(b.categoryId) ?? 0;
      if (b.limitAmount <= 0) {
        return { budgetId: b.id, categoryId: b.categoryId, limit: 0, actual, pct: null, barPct: 0, over: 0, remaining: 0, state: 'none' as const };
      }
      const raw = (actual / b.limitAmount) * 100;
      const pct = Math.round(raw);
      const state: BudgetState = actual > b.limitAmount ? 'over' : raw >= warn ? 'warn' : 'ok';
      return {
        budgetId: b.id,
        categoryId: b.categoryId,
        limit: b.limitAmount,
        actual,
        pct,
        barPct: Math.max(0, Math.min(100, raw)),
        over: Math.max(0, actual - b.limitAmount),
        remaining: b.limitAmount - actual,
        state,
      };
    });
}

// ---------------- Tujuan ----------------

export interface GoalStatus {
  saved: Money;
  remaining: Money;
  pct: number;
  barPct: number;
  reached: boolean;
  overdue: boolean;
  /** Jumlah bulan kalender dari bulan ini sampai bulan tenggat, termasuk keduanya. */
  monthsLeft: number | null;
  perMonth: Money | null;
}

export function goalStatus(ds: Dataset, goalId: ID, today: LocalDate): GoalStatus | null {
  const g = ds.goals.find((x) => x.id === goalId);
  if (!g) return null;
  const saved = pocketBalance(ds, g.pocketId);
  const remaining = Math.max(0, g.targetAmount - saved);
  const raw = (saved / g.targetAmount) * 100;
  const reached = saved >= g.targetAmount;
  let monthsLeft: number | null = null;
  let perMonth: Money | null = null;
  let overdue = false;
  if (g.deadline) {
    if (g.deadline < today) {
      overdue = !reached;
    } else {
      const [ty, tm] = monthOf(today).split('-').map(Number);
      const [dy, dm] = monthOf(g.deadline).split('-').map(Number);
      monthsLeft = (dy - ty) * 12 + (dm - tm) + 1;
      perMonth = remaining > 0 ? Math.ceil(remaining / monthsLeft) : 0;
    }
  }
  return { saved, remaining, pct: Math.floor(raw), barPct: Math.max(0, Math.min(100, raw)), reached, overdue, monthsLeft, perMonth };
}

// ---------------- Laporan rekening & kantong ----------------

export interface AccountReportRow {
  account: Account;
  start: Money;
  opening: Money;
  inflow: Money;
  outflow: Money;
  transferIn: Money;
  transferOut: Money;
  adjustments: Money;
  end: Money;
}

export function accountReport(ds: Dataset, from: LocalDate, to: LocalDate): AccountReportRow[] {
  const startMap = accountBalances(ds, addDays(from, -1));
  const endMap = accountBalances(ds, to);
  const rows = new Map<ID, AccountReportRow>(
    ds.accounts.map((a) => [
      a.id,
      { account: a, start: startMap.get(a.id) ?? 0, opening: 0, inflow: 0, outflow: 0, transferIn: 0, transferOut: 0, adjustments: 0, end: endMap.get(a.id) ?? 0 },
    ]),
  );
  for (const e of accountEffects(ds)) {
    if (!inRange(e.date, from, to)) continue;
    const r = rows.get(e.accountId);
    if (!r) continue;
    switch (e.kind) {
      case 'opening': r.opening = add(r.opening, e.delta); break;
      case 'income': case 'refund': r.inflow = add(r.inflow, e.delta); break;
      case 'expense': r.outflow = add(r.outflow, -e.delta); break;
      case 'transferIn': r.transferIn = add(r.transferIn, e.delta); break;
      case 'transferOut': r.transferOut = add(r.transferOut, -e.delta); break;
      case 'adjustment': r.adjustments = add(r.adjustments, e.delta); break;
    }
  }
  return [...rows.values()];
}

export interface PocketReportRow {
  pocketId: ID;
  start: Money;
  allocIn: Money;
  allocOut: Money;
  spent: Money;
  refunded: Money;
  end: Money;
}

export function pocketReport(ds: Dataset, from: LocalDate, to: LocalDate): PocketReportRow[] {
  const startMap = pocketBalances(ds, addDays(from, -1));
  const endMap = pocketBalances(ds, to);
  const rows = new Map<ID, PocketReportRow>(
    ds.pockets.map((p) => [p.id, { pocketId: p.id, start: startMap.get(p.id) ?? 0, allocIn: 0, allocOut: 0, spent: 0, refunded: 0, end: endMap.get(p.id) ?? 0 }]),
  );
  for (const e of pocketEffects(ds)) {
    if (!inRange(e.date, from, to)) continue;
    const r = rows.get(e.pocketId);
    if (!r) continue;
    if (e.kind === 'allocIn') r.allocIn = add(r.allocIn, e.delta);
    else if (e.kind === 'allocOut') r.allocOut = add(r.allocOut, -e.delta);
    else if (e.kind === 'spent') r.spent = add(r.spent, -e.delta);
    else r.refunded = add(r.refunded, e.delta);
  }
  return [...rows.values()];
}

// ---------------- Refund ----------------

export function refundedAmount(ds: Dataset, expenseId: ID, excludeId?: ID): Money {
  return sum(
    ds.transactions
      .filter((t) => t.type === 'refund' && isActive(t) && t.originalExpenseId === expenseId && t.id !== excludeId)
      .map((t) => t.amount),
  );
}

export function hasActiveRefunds(ds: Dataset, expenseId: ID): boolean {
  return ds.transactions.some((t) => t.type === 'refund' && isActive(t) && t.originalExpenseId === expenseId);
}

// ---------------- Buku transaksi: filter ----------------

export interface TxFilter {
  from?: LocalDate;
  to?: LocalDate;
  types?: TxType[];
  categoryIds?: ID[];
  accountIds?: ID[];
  /** 'none' = tanpa kantong (dana belum dialokasikan). */
  pocketIds?: (ID | 'none')[];
  q?: string;
  min?: Money;
  max?: Money;
  priorities?: (Priority | 'none')[];
  behaviors?: (Behavior | 'none')[];
  status?: 'active' | 'voided' | 'all';
}

/** Kombinasi antarfield = AND; pilihan dalam field yang sama = OR. */
export function filterTransactions(ds: Dataset, f: TxFilter): Transaction[] {
  const q = f.q?.trim().toLowerCase();
  const status = f.status ?? 'active';
  return ds.transactions
    .filter((t) => {
      if (status !== 'all' && t.status !== status) return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.types?.length && !f.types.includes(t.type)) return false;
      if (f.categoryIds?.length && (!t.categoryId || !f.categoryIds.includes(t.categoryId))) return false;
      if (f.accountIds?.length && !f.accountIds.includes(t.accountId) && !(t.destinationAccountId && f.accountIds.includes(t.destinationAccountId))) return false;
      if (f.pocketIds?.length && !f.pocketIds.includes(t.pocketId ?? 'none')) return false;
      if (f.min != null && t.amount < f.min) return false;
      if (f.max != null && t.amount > f.max) return false;
      if (f.priorities?.length && !f.priorities.includes(t.priority ?? 'none')) return false;
      if (f.behaviors?.length && !f.behaviors.includes(t.behavior ?? 'none')) return false;
      if (q && !t.note.toLowerCase().includes(q) && !t.tags.some((tag) => tag.toLowerCase().includes(q))) return false;
      return true;
    })
    .sort(compareTxDesc);
}

export function compareTxDesc(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export interface TxTotals {
  count: number;
  income: Money;
  grossExpense: Money;
  refunds: Money;
  netExpense: Money;
  transfers: Money;
}

/** Total dari seluruh hasil terfilter (bukan hanya halaman yang tampak). */
export function totalsOf(list: Transaction[]): TxTotals {
  const t: TxTotals = { count: 0, income: 0, grossExpense: 0, refunds: 0, netExpense: 0, transfers: 0 };
  for (const x of list) {
    t.count++;
    if (x.status !== 'active') continue;
    if (x.type === 'income') t.income = add(t.income, x.amount);
    else if (x.type === 'expense') t.grossExpense = add(t.grossExpense, x.amount);
    else if (x.type === 'refund') t.refunds = add(t.refunds, x.amount);
    else t.transfers = add(t.transfers, x.amount);
  }
  t.netExpense = t.grossExpense - t.refunds;
  return t;
}

/** Nilai bertanda transaksi dari sudut pandang arus kas (transfer = 0). */
export function signedFlow(t: Transaction): Money {
  if (t.type === 'income' || t.type === 'refund') return t.amount;
  if (t.type === 'expense') return -t.amount;
  return 0;
}
