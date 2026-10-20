import type { LocalDate } from './types';

// Semua aritmetika tanggal dilakukan pada tanggal kalender (UTC tengah malam) agar
// tidak terpengaruh zona waktu perangkat. Zona waktu pengguna hanya dipakai untuk "hari ini".

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s: unknown): s is LocalDate {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function toUtc(d: LocalDate): Date {
  const m = DATE_RE.exec(d);
  if (!m) throw new Error(`Tanggal tidak valid: ${d}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

export function fromUtc(dt: Date): LocalDate {
  return dt.toISOString().slice(0, 10);
}

export function todayIn(timezone: string, now: Date = new Date()): LocalDate {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const t = toUtc(d);
  t.setUTCDate(t.getUTCDate() + n);
  return fromUtc(t);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Tambah bulan dengan menjepit hari ke hari terakhir bulan tujuan (31 Jan + 1 bulan = 28/29 Feb). */
export function addMonthsClamped(d: LocalDate, n: number, anchorDay?: number): LocalDate {
  const t = toUtc(d);
  const day = anchorDay ?? t.getUTCDate();
  const total = t.getUTCFullYear() * 12 + t.getUTCMonth() + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  const dd = Math.min(day, daysInMonth(y, m + 1));
  return fromUtc(new Date(Date.UTC(y, m, dd)));
}

export function monthOf(d: LocalDate): string {
  return d.slice(0, 7);
}

export function monthStart(month: string): LocalDate {
  return `${month}-01`;
}

export function monthEnd(month: string): LocalDate {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

export function addMonthsToMonth(month: string, n: number): string {
  return monthOf(addMonthsClamped(monthStart(month), n));
}

/** Senin sebagai awal minggu. */
export function startOfWeek(d: LocalDate): LocalDate {
  const dow = toUtc(d).getUTCDay(); // 0 = Minggu
  return addDays(d, -((dow + 6) % 7));
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a > b ? a : b;
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a < b ? a : b;
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function formatDate(d: LocalDate, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const t = toUtc(d);
  const base = `${t.getUTCDate()} ${MONTHS_SHORT[t.getUTCMonth()]}`;
  const withYear = opts.year === false ? base : `${base} ${t.getUTCFullYear()}`;
  return opts.weekday ? `${DAYS[t.getUTCDay()]}, ${withYear}` : withYear;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatShortDay(d: LocalDate): string {
  const t = toUtc(d);
  return `${t.getUTCDate()} ${MONTHS_SHORT[t.getUTCMonth()]}`;
}

export function formatRange(from: LocalDate, to: LocalDate): string {
  if (from === to) return formatDate(from);
  if (from.slice(0, 4) === to.slice(0, 4)) return `${formatDate(from, { year: false })} – ${formatDate(to)}`;
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------- Periode ----------

export type PeriodPreset = 'this-week' | 'this-month' | 'last-month' | 'custom';

export interface Period {
  preset: PeriodPreset;
  from: LocalDate;
  to: LocalDate;
}

export function periodFromPreset(preset: PeriodPreset, today: LocalDate, custom?: { from: LocalDate; to: LocalDate }): Period {
  switch (preset) {
    case 'this-week':
      return { preset, from: startOfWeek(today), to: addDays(startOfWeek(today), 6) };
    case 'this-month':
      return { preset, from: monthStart(monthOf(today)), to: monthEnd(monthOf(today)) };
    case 'last-month': {
      const m = addMonthsToMonth(monthOf(today), -1);
      return { preset, from: monthStart(m), to: monthEnd(m) };
    }
    case 'custom': {
      const from = custom?.from ?? today;
      const to = custom?.to ?? today;
      return from <= to ? { preset, from, to } : { preset, from: to, to: from };
    }
  }
}

export function periodLabel(p: Period): string {
  switch (p.preset) {
    case 'this-week':
      return `Minggu ini · ${formatRange(p.from, p.to)}`;
    case 'this-month':
      return `Bulan ini · ${formatMonth(monthOf(p.from))}`;
    case 'last-month':
      return `Bulan lalu · ${formatMonth(monthOf(p.from))}`;
    case 'custom':
      return formatRange(p.from, p.to);
  }
}
