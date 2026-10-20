import { DomainError, type Money } from './types';

/** Penjumlahan integer yang menolak hasil di luar safe integer (tanpa floating point). */
export function add(a: Money, b: Money): Money {
  const r = a + b;
  if (!Number.isSafeInteger(r)) throw new DomainError('Nominal terlalu besar untuk dihitung dengan aman.');
  return r;
}

export function sub(a: Money, b: Money): Money {
  return add(a, -b);
}

export function sum(values: Iterable<Money>): Money {
  let t = 0;
  for (const v of values) t = add(t, v);
  return t;
}

export type ParseResult = { ok: true; value: Money } | { ok: false; error: string };

/**
 * Mengurai input nominal Rupiah dari pengguna. Pemisah ribuan '.' dan spasi diabaikan.
 * Ditolak: kosong, negatif, nol, pecahan (koma), non-angka, di luar safe integer.
 */
export function parseAmountInput(raw: string, opts: { allowZero?: boolean } = {}): ParseResult {
  const s = raw.trim().replace(/^rp\.?\s*/i, '');
  if (s === '') return { ok: false, error: 'Nominal wajib diisi.' };
  if (s.startsWith('-')) return { ok: false, error: 'Nominal tidak boleh negatif.' };
  if (/,\d/.test(s)) return { ok: false, error: 'Rupiah tidak memakai pecahan.' };
  const digits = s.replace(/[.\s]/g, '');
  if (!/^\d+$/.test(digits)) return { ok: false, error: 'Nominal hanya boleh berisi angka.' };
  if (digits.length > 16) return { ok: false, error: 'Nominal terlalu besar.' };
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) return { ok: false, error: 'Nominal terlalu besar.' };
  if (value === 0 && !opts.allowZero) return { ok: false, error: 'Nominal harus lebih dari nol.' };
  return { ok: true, value };
}

export function assertAmount(value: unknown, label = 'Nominal'): Money {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new DomainError(`${label} harus bilangan bulat Rupiah lebih dari nol.`);
  }
  return value;
}

export function groupDigits(n: number): string {
  const s = Math.abs(n).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Rp1.234.567 / −Rp1.234.567 */
export function formatRupiah(n: Money, opts: { sign?: boolean } = {}): string {
  const body = 'Rp' + groupDigits(n);
  if (n < 0) return '−' + body;
  if (opts.sign && n > 0) return '+' + body;
  return body;
}

/** Format ringkas untuk sumbu grafik: 1,2 jt / 350 rb */
export function formatCompact(n: Money): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1_000_000_000) return `${sign}${trim1(a / 1_000_000_000)} M`;
  if (a >= 1_000_000) return `${sign}${trim1(a / 1_000_000)} jt`;
  if (a >= 1_000) return `${sign}${trim1(a / 1_000)} rb`;
  return `${sign}${a}`;
}

function trim1(x: number): string {
  return (Math.round(x * 10) / 10).toString().replace('.', ',');
}

/** Persentase bulat; null bila penyebut tidak valid (nol/negatif) — jangan pernah Infinity/NaN. */
export function percent(part: Money, whole: Money): number | null {
  if (!(whole > 0)) return null;
  return Math.round((part / whole) * 100);
}

/** Pembagian dibulatkan ke atas untuk integer positif. */
export function ceilDiv(a: Money, b: number): Money {
  if (b <= 0) throw new DomainError('Pembagi harus positif.');
  return Math.ceil(a / b);
}
