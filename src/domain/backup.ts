// Backup JSON & validasi restore: baca → validasi schema dan relasi → preview → konfirmasi → commit atomik.

import { isValidDate } from './dates';
import { totalBalance, unallocated } from './ledger';
import { emptySettings, TABLE_KEYS, type Dataset, type TableKey } from './types';

export const SCHEMA_VERSION = 1;

export interface BackupFile {
  app: 'kantong';
  schemaVersion: number;
  exportedAt: string;
  mode: 'personal' | 'demo';
  notice: string;
  settings: Dataset['settings'];
  tables: Omit<Dataset, 'settings'>;
}

export function makeBackup(ds: Dataset, mode: 'personal' | 'demo', now = new Date().toISOString()): BackupFile {
  const tables = {} as Omit<Dataset, 'settings'>;
  for (const k of TABLE_KEYS) (tables as Record<string, unknown>)[k] = ds[k];
  return {
    app: 'kantong',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    mode,
    notice: 'DATA SENSITIF: berkas ini berisi catatan keuangan tanpa enkripsi. Simpan di tempat aman.',
    settings: ds.settings,
    tables,
  };
}

// ---------- Validator ringan ----------

type Check = (v: unknown) => boolean;
const str: Check = (v) => typeof v === 'string';
const nstr: Check = (v) => v === null || typeof v === 'string';
const int: Check = (v) => typeof v === 'number' && Number.isSafeInteger(v);
const pos: Check = (v) => int(v) && (v as number) > 0;
const nonneg: Check = (v) => int(v) && (v as number) >= 0;
const bool: Check = (v) => typeof v === 'boolean';
const date: Check = (v) => isValidDate(v);
const ndate: Check = (v) => v === null || isValidDate(v);
const iso: Check = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const niso: Check = (v) => v === null || iso(v);
const oneOf = (...xs: unknown[]): Check => (v) => xs.includes(v);
const any: Check = () => true;
const tags: Check = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const id: Check = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 64;
const nid: Check = (v) => v === null || id(v);

const base = { id, version: pos, createdAt: iso, updatedAt: iso };
const status = oneOf('active', 'voided');

const SPECS: Record<TableKey, Record<string, Check>> = {
  accounts: { ...base, name: str, type: oneOf('cash', 'bank', 'ewallet'), openingBalance: nonneg, openingDate: date, archivedAt: niso },
  categories: { ...base, name: str, kind: oneOf('income', 'expense'), grp: str, icon: str, color: str, defaultPriority: oneOf(null, 'need', 'want'), defaultBehavior: oneOf(null, 'fixed', 'variable'), systemKey: nstr, archivedAt: niso },
  pockets: { ...base, name: str, icon: str, color: str, archivedAt: niso },
  transactions: {
    ...base, type: oneOf('income', 'expense', 'transfer', 'refund'), date, amount: pos, accountId: id, destinationAccountId: nid,
    categoryId: nid, pocketId: nid, originalExpenseId: nid, groupId: nid, note: str, tags, priority: oneOf(null, 'need', 'want'),
    behavior: oneOf(null, 'fixed', 'variable'), status,
  },
  allocations: { ...base, date, fromPocketId: nid, toPocketId: nid, amount: pos, note: str, status },
  adjustments: { ...base, accountId: id, date, signedAmount: int, reason: str, status },
  budgets: { ...base, month: (v) => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v), categoryId: id, limitAmount: nonneg },
  goals: { ...base, pocketId: id, name: str, targetAmount: pos, deadline: ndate, icon: str, color: str, celebrationShownAt: niso },
  reminders: { ...base, name: str, kind: oneOf('income', 'bill'), frequency: oneOf('weekly', 'monthly', 'yearly'), anchorDate: date, amount: pos, accountId: id, categoryId: id, pocketId: nid, active: bool },
  occurrences: { ...base, reminderId: id, dueDate: date, linkedTransactionId: nid, status: oneOf('recorded', 'skipped', 'open') },
  auditEvents: { id, entityType: str, entityId: id, action: str, before: any, after: any, createdAt: iso },
};

const SETTINGS_SPEC: Record<string, Check> = {
  displayName: str, timezone: str, reducedMotion: bool, hideAmounts: bool, budgetWarnPct: int, lastBackupAt: niso, onboardedAt: niso, version: nonneg,
};

export interface BackupPreview {
  exportedAt: string;
  mode: 'personal' | 'demo';
  schemaVersion: number;
  counts: Record<TableKey, number>;
  firstDate: string | null;
  lastDate: string | null;
  totalBalance: number;
}

export type ParseBackupResult = { ok: true; ds: Dataset; preview: BackupPreview } | { ok: false; errors: string[] };

export function parseBackup(text: string): ParseBackupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Berkas bukan JSON yang valid.'] };
  }
  const errors: string[] = [];
  const b = raw as Partial<BackupFile>;
  if (!b || typeof b !== 'object' || b.app !== 'kantong') return { ok: false, errors: ['Berkas ini bukan cadangan Kantong.'] };
  if (typeof b.schemaVersion !== 'number') return { ok: false, errors: ['Versi schema tidak ditemukan.'] };
  if (b.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, errors: [`Cadangan memakai schema versi ${b.schemaVersion}, lebih baru dari yang didukung aplikasi ini (${SCHEMA_VERSION}). Perbarui aplikasi dulu.`] };
  }
  if (!b.tables || typeof b.tables !== 'object') return { ok: false, errors: ['Bagian tabel tidak ditemukan.'] };

  const settings = { ...emptySettings(), ...(b.settings ?? {}) };
  for (const [k, check] of Object.entries(SETTINGS_SPEC)) {
    if (!check((settings as Record<string, unknown>)[k])) errors.push(`Pengaturan: field ${k} tidak valid.`);
  }

  const ds = { settings } as Dataset;
  for (const t of TABLE_KEYS) {
    const rows = (b.tables as Record<string, unknown>)[t];
    if (!Array.isArray(rows)) {
      errors.push(`Tabel ${t} tidak ditemukan.`);
      (ds as unknown as Record<string, unknown[]>)[t] = [];
      continue;
    }
    const spec = SPECS[t];
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      if (!row || typeof row !== 'object') return errors.push(`${t}[${i}] bukan objek.`);
      for (const [k, check] of Object.entries(spec)) {
        if (!check((row as Record<string, unknown>)[k])) errors.push(`${t}[${i}].${k} tidak valid.`);
      }
      const rid = (row as { id: string }).id;
      if (seen.has(rid)) errors.push(`${t}: id ganda ${rid}.`);
      seen.add(rid);
    });
    (ds as unknown as Record<string, unknown[]>)[t] = rows.map((r) => pick(r as Record<string, unknown>, Object.keys(spec)));
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 30) };

  // Relasi & batasan unik.
  const ids = (t: TableKey) => new Set((ds[t] as { id: string }[]).map((r) => r.id));
  const acc = ids('accounts');
  const cat = ids('categories');
  const poc = ids('pockets');
  const txs = new Map(ds.transactions.map((t) => [t.id, t]));
  const rem = ids('reminders');
  const ref = (cond: boolean, msg: string) => {
    if (!cond) errors.push(msg);
  };
  for (const t of ds.transactions) {
    ref(acc.has(t.accountId), `Transaksi ${t.id}: rekening yatim.`);
    if (t.destinationAccountId) ref(acc.has(t.destinationAccountId), `Transaksi ${t.id}: rekening tujuan yatim.`);
    if (t.categoryId) ref(cat.has(t.categoryId), `Transaksi ${t.id}: kategori yatim.`);
    if (t.pocketId) ref(poc.has(t.pocketId), `Transaksi ${t.id}: kantong yatim.`);
    if (t.type === 'transfer') ref(!!t.destinationAccountId && t.destinationAccountId !== t.accountId, `Transfer ${t.id}: rekening tujuan tidak valid.`);
    if (t.type === 'income' || t.type === 'expense') ref(!!t.categoryId, `Transaksi ${t.id}: kategori wajib.`);
    if (t.type === 'refund') ref(txs.get(t.originalExpenseId ?? '')?.type === 'expense', `Pengembalian ${t.id}: pengeluaran asal tidak ditemukan.`);
  }
  for (const a of ds.allocations) {
    ref(!!(a.fromPocketId || a.toPocketId) && a.fromPocketId !== a.toPocketId, `Alokasi ${a.id}: sumber/tujuan tidak valid.`);
    if (a.fromPocketId) ref(poc.has(a.fromPocketId), `Alokasi ${a.id}: kantong sumber yatim.`);
    if (a.toPocketId) ref(poc.has(a.toPocketId), `Alokasi ${a.id}: kantong tujuan yatim.`);
  }
  for (const j of ds.adjustments) ref(acc.has(j.accountId), `Penyesuaian ${j.id}: rekening yatim.`);
  const budgetKeys = new Set<string>();
  for (const x of ds.budgets) {
    ref(cat.has(x.categoryId), `Anggaran ${x.id}: kategori yatim.`);
    const k = `${x.month}|${x.categoryId}`;
    ref(!budgetKeys.has(k), `Anggaran ganda untuk ${x.month}.`);
    budgetKeys.add(k);
  }
  const goalPockets = new Set<string>();
  for (const g of ds.goals) {
    ref(poc.has(g.pocketId), `Tujuan ${g.id}: kantong yatim.`);
    ref(!goalPockets.has(g.pocketId), `Dua tujuan memakai kantong yang sama.`);
    goalPockets.add(g.pocketId);
  }
  for (const r of ds.reminders) {
    ref(acc.has(r.accountId), `Pengingat ${r.id}: rekening yatim.`);
    ref(cat.has(r.categoryId), `Pengingat ${r.id}: kategori yatim.`);
    if (r.pocketId) ref(poc.has(r.pocketId), `Pengingat ${r.id}: kantong yatim.`);
  }
  const occKeys = new Set<string>();
  for (const o of ds.occurrences) {
    ref(rem.has(o.reminderId), `Kejadian ${o.id}: pengingat yatim.`);
    if (o.linkedTransactionId) ref(txs.has(o.linkedTransactionId), `Kejadian ${o.id}: transaksi yatim.`);
    const k = `${o.reminderId}|${o.dueDate}`;
    ref(!occKeys.has(k), `Kejadian pengingat ganda (${o.dueDate}).`);
    occKeys.add(k);
  }
  let total = 0;
  try {
    total = totalBalance(ds);
    unallocated(ds);
  } catch {
    errors.push('Total nominal melampaui batas perhitungan aman.');
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 30) };

  const dates = ds.transactions.map((t) => t.date).sort();
  const counts = Object.fromEntries(TABLE_KEYS.map((k) => [k, ds[k].length])) as Record<TableKey, number>;
  return {
    ok: true,
    ds,
    preview: {
      exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
      mode: b.mode === 'demo' ? 'demo' : 'personal',
      schemaVersion: b.schemaVersion,
      counts,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      totalBalance: total,
    },
  };
}

function pick(o: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = o[k];
  return out;
}

/** Daftar field per tabel — sumber tunggal untuk pemetaan kolom database. */
export const TABLE_FIELDS = Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [k, Object.keys(v)])) as Record<TableKey, string[]>;
export const SETTINGS_FIELDS = Object.keys(SETTINGS_SPEC);
