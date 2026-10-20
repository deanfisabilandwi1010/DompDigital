import { BEHAVIOR_LABEL, PRIORITY_LABEL, TX_TYPE_LABEL } from './defaults';
import { signedFlow } from './ledger';
import type { Dataset, LocalDate, Transaction } from './types';

type Cell = string | number | null | undefined;

/** Sel teks yang diawali karakter formula spreadsheet diberi awalan ' agar tidak dieksekusi. */
export function sanitizeText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function csvCell(v: Cell): string {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = sanitizeText(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  // BOM agar Excel membaca UTF-8 dengan benar.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function transactionsCsv(ds: Dataset, list: Transaction[], period: { from?: LocalDate; to?: LocalDate }): string {
  const acc = new Map(ds.accounts.map((a) => [a.id, a.name]));
  const cat = new Map(ds.categories.map((c) => [c.id, c.name]));
  const poc = new Map(ds.pockets.map((p) => [p.id, p.name]));
  const headers = [
    'periode_dari', 'periode_sampai', 'id', 'tanggal', 'jenis', 'status', 'nominal', 'arus_kas',
    'rekening', 'rekening_tujuan', 'kategori', 'kantong', 'prioritas', 'sifat', 'catatan', 'tag',
    'id_pengeluaran_asal', 'id_grup', 'dibuat_utc',
  ];
  const rows = list.map((t) => [
    period.from ?? '',
    period.to ?? '',
    t.id,
    t.date,
    TX_TYPE_LABEL[t.type],
    t.status === 'active' ? 'aktif' : 'dibatalkan',
    t.amount,
    t.status === 'active' ? signedFlow(t) : 0,
    acc.get(t.accountId) ?? '',
    t.destinationAccountId ? (acc.get(t.destinationAccountId) ?? '') : '',
    t.categoryId ? (cat.get(t.categoryId) ?? '') : '',
    t.pocketId ? (poc.get(t.pocketId) ?? '') : t.type === 'expense' ? 'Dana belum dialokasikan' : '',
    t.priority ? PRIORITY_LABEL[t.priority] : '',
    t.behavior ? BEHAVIOR_LABEL[t.behavior] : '',
    t.note,
    t.tags.join(' '),
    t.originalExpenseId ?? '',
    t.groupId ?? '',
    t.createdAt,
  ]);
  return toCsv(headers, rows);
}
