import { addDays, addMonthsClamped, daysBetween, maxDate, toUtc } from './dates';
import type { Dataset, LocalDate, Occurrence, Reminder } from './types';

/**
 * Jadwal jatuh tempo dalam [from, to]. Untuk tanggal 29–31 yang tidak ada di bulan tertentu,
 * dipakai hari terakhir bulan itu (31 Jan → 28/29 Feb → 31 Mar).
 */
export function dueDatesBetween(rem: Pick<Reminder, 'anchorDate' | 'frequency'>, from: LocalDate, to: LocalDate): LocalDate[] {
  const start = maxDate(from, rem.anchorDate);
  if (to < start) return [];
  const out: LocalDate[] = [];
  if (rem.frequency === 'weekly') {
    const k0 = Math.ceil(daysBetween(rem.anchorDate, start) / 7);
    for (let d = addDays(rem.anchorDate, k0 * 7); d <= to; d = addDays(d, 7)) out.push(d);
    return out;
  }
  const step = rem.frequency === 'monthly' ? 1 : 12;
  const anchor = toUtc(rem.anchorDate);
  const s = toUtc(start);
  const monthsApart = (s.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (s.getUTCMonth() - anchor.getUTCMonth());
  let i = Math.max(0, Math.floor(monthsApart / step) - 1);
  const anchorDay = anchor.getUTCDate();
  for (;;) {
    const d = addMonthsClamped(rem.anchorDate, i * step, anchorDay);
    if (d > to) break;
    if (d >= start) out.push(d);
    i++;
  }
  return out;
}

export interface AgendaItem {
  reminder: Reminder;
  dueDate: LocalDate;
  occurrence: Occurrence | null;
  status: 'open' | 'recorded' | 'skipped';
  overdue: boolean;
}

/** Daftar "Terlewat" dan "Mendatang", dihitung saat aplikasi dibuka — bukan notifikasi latar belakang. */
export function reminderAgenda(ds: Dataset, today: LocalDate, opts: { lookbackDays?: number; aheadDays?: number } = {}) {
  const lookback = opts.lookbackDays ?? 90;
  const ahead = opts.aheadDays ?? 30;
  const overdue: AgendaItem[] = [];
  const upcoming: AgendaItem[] = [];
  const done: AgendaItem[] = [];
  for (const r of ds.reminders) {
    if (!r.active) continue;
    for (const d of dueDatesBetween(r, addDays(today, -lookback), addDays(today, ahead))) {
      const occ = ds.occurrences.find((o) => o.reminderId === r.id && o.dueDate === d) ?? null;
      const status = occ?.status ?? 'open';
      const item: AgendaItem = { reminder: r, dueDate: d, occurrence: occ, status, overdue: d < today && status === 'open' };
      if (status !== 'open') done.push(item);
      else if (d < today) overdue.push(item);
      else upcoming.push(item);
    }
  }
  const byDate = (a: AgendaItem, b: AgendaItem) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0);
  return { overdue: overdue.sort(byDate), upcoming: upcoming.sort(byDate), done: done.sort(byDate).reverse() };
}
