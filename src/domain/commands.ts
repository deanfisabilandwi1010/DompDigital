// Planner: fungsi murni yang memvalidasi input terhadap dataset dan menghasilkan change set atomik.
// Tidak ada side effect; repository yang menulis change set dalam satu transaksi database.

import { auditChange } from './changes';
import { isValidDate } from './dates';
import { adminFeeCategorySeed, defaultCategories } from './defaults';
import { accountBalance, hasActiveRefunds, isActive, pocketBalance, refundedAmount, unallocated } from './ledger';
import { assertAmount, formatRupiah } from './money';
import { dueDatesBetween } from './reminders';
import {
  DomainError,
  type Account,
  type AccountType,
  type Adjustment,
  type Allocation,
  type Behavior,
  type Budget,
  type Category,
  type CategoryKind,
  type Change,
  type Dataset,
  type Frequency,
  type Goal,
  type ID,
  type IsoTime,
  type LocalDate,
  type Money,
  type Occurrence,
  type Pocket,
  type Priority,
  type PutRow,
  type Reminder,
  type ReminderKind,
  type Settings,
  type TableKey,
  type Transaction,
} from './types';

export interface Ctx {
  today: LocalDate;
  now: IsoTime;
}

const uid = () => crypto.randomUUID();
const put = (table: TableKey, row: object): Change => ({ table, op: 'put', row: row as PutRow });

function bump<T extends { version: number; updatedAt: IsoTime }>(old: T, patch: Partial<T>, now: IsoTime): T {
  return { ...old, ...patch, version: old.version + 1, updatedAt: now };
}

function fresh(now: IsoTime) {
  return { id: uid(), version: 1, createdAt: now, updatedAt: now };
}

function cleanName(name: string, label: string, max = 60): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) throw new DomainError(`${label} wajib diisi.`, 'name');
  if (n.length > max) throw new DomainError(`${label} maksimal ${max} karakter.`, 'name');
  return n;
}

function cleanNote(note: string | undefined): string {
  const n = (note ?? '').trim();
  if (n.length > 500) throw new DomainError('Catatan maksimal 500 karakter.', 'note');
  return n;
}

export function cleanTags(tags: string[] | string | undefined): string[] {
  const list = Array.isArray(tags) ? tags : (tags ?? '').split(',');
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.trim().replace(/^#/, '').toLowerCase();
    if (!t) continue;
    if (t.length > 30) throw new DomainError('Tag maksimal 30 karakter.', 'tags');
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > 10) throw new DomainError('Maksimal 10 tag.', 'tags');
  return out;
}

function checkDate(date: LocalDate, ctx: Ctx, field = 'date'): void {
  if (!isValidDate(date)) throw new DomainError('Tanggal tidak valid.', field);
  if (date > ctx.today) {
    throw new DomainError('Tanggal di masa depan belum bisa menjadi saldo aktual. Buat pengingat untuk jadwal nanti.', field);
  }
}

function getAccount(ds: Dataset, id: ID | null | undefined, field = 'accountId'): Account {
  const a = ds.accounts.find((x) => x.id === id);
  if (!a) throw new DomainError('Rekening wajib dipilih.', field);
  return a;
}

function usableAccount(ds: Dataset, id: ID | null | undefined, date: LocalDate, previous?: ID | null, field = 'accountId'): Account {
  const a = getAccount(ds, id, field);
  if (a.archivedAt && a.id !== previous) throw new DomainError(`Rekening ${a.name} sudah diarsipkan.`, field);
  if (date < a.openingDate) {
    throw new DomainError(`Tanggal sebelum pembukaan rekening ${a.name} (${a.openingDate}).`, 'date');
  }
  return a;
}

function usableCategory(ds: Dataset, id: ID | null | undefined, kind: CategoryKind, previous?: ID | null): Category {
  const c = ds.categories.find((x) => x.id === id);
  if (!c) throw new DomainError('Kategori wajib dipilih.', 'categoryId');
  if (c.kind !== kind) throw new DomainError('Kategori tidak sesuai jenis transaksi.', 'categoryId');
  if (c.archivedAt && c.id !== previous) throw new DomainError(`Kategori ${c.name} sudah diarsipkan.`, 'categoryId');
  return c;
}

function usablePocket(ds: Dataset, id: ID | null | undefined, previous?: ID | null): Pocket | null {
  if (!id) return null;
  const p = ds.pockets.find((x) => x.id === id);
  if (!p) throw new DomainError('Kantong tidak ditemukan.', 'pocketId');
  if (p.archivedAt && p.id !== previous) throw new DomainError(`Kantong ${p.name} sudah diarsipkan.`, 'pocketId');
  return p;
}

function ensureAdminFeeCategory(ds: Dataset, ctx: Ctx, changes: Change[]): Category {
  const existing = ds.categories.find((c) => c.systemKey === 'admin_fee' && !c.archivedAt) ?? ds.categories.find((c) => c.systemKey === 'admin_fee');
  if (existing) return existing;
  const c = { ...adminFeeCategorySeed(ctx.now), id: uid() };
  changes.push(put('categories', c));
  return c;
}

// ======================= Onboarding =======================

export interface OnboardingInput {
  displayName: string;
  timezone: string;
  accounts: { name: string; type: AccountType; openingBalance: Money; openingDate: LocalDate }[];
  pockets: { name: string; icon: string; color: string }[];
}

export function planOnboarding(ds: Dataset, input: OnboardingInput, ctx: Ctx): Change[] {
  if (ds.settings.onboardedAt) throw new DomainError('Onboarding sudah selesai.');
  if (input.accounts.length === 0) throw new DomainError('Tambahkan minimal satu rekening.', 'accounts');
  const changes: Change[] = [];
  const settings: Settings = {
    ...ds.settings,
    displayName: input.displayName.trim().slice(0, 40),
    timezone: input.timezone,
    onboardedAt: ctx.now,
    version: ds.settings.version + 1,
  };
  changes.push({ table: 'settings', op: 'put', row: settings });
  if (ds.categories.length === 0) for (const c of defaultCategories(ctx.now)) changes.push(put('categories', c));
  const names = new Set<string>();
  let seq = 0;
  // createdAt berurutan per ms agar urutan input dipertahankan.
  const at = () => new Date(Date.parse(ctx.now) + seq++).toISOString();
  for (const a of input.accounts) {
    const name = cleanName(a.name, 'Nama rekening');
    if (names.has(name.toLowerCase())) throw new DomainError(`Nama rekening "${name}" ganda.`, 'accounts');
    names.add(name.toLowerCase());
    if (!Number.isSafeInteger(a.openingBalance) || a.openingBalance < 0) throw new DomainError('Saldo awal harus 0 atau lebih.', 'accounts');
    checkDate(a.openingDate, ctx, 'accounts');
    const row: Account = { ...fresh(ctx.now), createdAt: at(), name, type: a.type, openingBalance: a.openingBalance, openingDate: a.openingDate, archivedAt: null };
    changes.push(put('accounts', row), auditChange('account', row.id, 'create', null, row, ctx.now));
  }
  const pnames = new Set<string>();
  for (const p of input.pockets) {
    const name = cleanName(p.name, 'Nama kantong');
    if (pnames.has(name.toLowerCase())) continue;
    pnames.add(name.toLowerCase());
    const row: Pocket = { ...fresh(ctx.now), createdAt: at(), name, icon: p.icon, color: p.color, archivedAt: null };
    changes.push(put('pockets', row));
  }
  return changes;
}

// ======================= Pengaturan =======================

export function planSettings(ds: Dataset, patch: Partial<Omit<Settings, 'version'>>): Change[] {
  const next: Settings = { ...ds.settings, ...patch, version: ds.settings.version + 1 };
  if (next.budgetWarnPct < 50 || next.budgetWarnPct > 100 || !Number.isInteger(next.budgetWarnPct)) {
    throw new DomainError('Batas peringatan anggaran harus 50–100%.', 'budgetWarnPct');
  }
  next.displayName = next.displayName.trim().slice(0, 40);
  return [{ table: 'settings', op: 'put', row: next }];
}

// ======================= Transaksi =======================

export interface TxInput {
  id?: ID;
  type: 'income' | 'expense' | 'refund';
  date: LocalDate;
  amount: Money;
  accountId: ID;
  categoryId?: ID | null;
  pocketId?: ID | null;
  originalExpenseId?: ID | null;
  note?: string;
  tags?: string[] | string;
  priority?: Priority | null;
  behavior?: Behavior | null;
  /** Diisi saat mencatat dari pengingat. */
  occurrence?: { reminderId: ID; dueDate: LocalDate };
}

export function planSaveTransaction(ds: Dataset, input: TxInput, ctx: Ctx): Change[] {
  const changes: Change[] = [];
  const existing = input.id ? ds.transactions.find((t) => t.id === input.id) : undefined;
  if (input.id && !existing) throw new DomainError('Transaksi tidak ditemukan.');
  if (existing) {
    if (existing.status !== 'active') throw new DomainError('Transaksi yang dibatalkan tidak dapat diedit. Pulihkan dulu.');
    if (existing.type !== input.type) throw new DomainError('Jenis transaksi tidak dapat diubah. Batalkan lalu catat ulang.');
    if (existing.groupId) throw new DomainError('Biaya transfer diedit melalui transaksi transfernya.');
    if (existing.type === 'expense' && hasActiveRefunds(ds, existing.id)) {
      throw new DomainError('Transaksi ini memiliki pengembalian dana. Batalkan pengembalian dananya dulu sebelum mengedit.');
    }
  }
  const amount = assertAmount(input.amount);
  checkDate(input.date, ctx);
  const prev = existing;
  const account = usableAccount(ds, input.accountId, input.date, prev?.accountId);
  const note = cleanNote(input.note);
  const tags = cleanTags(input.tags);

  let categoryId: ID | null = null;
  let pocketId: ID | null = null;
  let originalExpenseId: ID | null = null;
  let priority: Priority | null = null;
  let behavior: Behavior | null = null;

  if (input.type === 'income') {
    categoryId = usableCategory(ds, input.categoryId, 'income', prev?.categoryId).id;
  } else if (input.type === 'expense') {
    const c = usableCategory(ds, input.categoryId, 'expense', prev?.categoryId);
    categoryId = c.id;
    pocketId = usablePocket(ds, input.pocketId, prev?.pocketId)?.id ?? null;
    priority = input.priority === undefined ? c.defaultPriority : input.priority;
    behavior = input.behavior === undefined ? c.defaultBehavior : input.behavior;
  } else {
    const orig = ds.transactions.find((t) => t.id === input.originalExpenseId);
    if (!orig || orig.type !== 'expense') throw new DomainError('Pilih transaksi pengeluaran asal.', 'originalExpenseId');
    if (orig.status !== 'active') throw new DomainError('Pengeluaran asal sudah dibatalkan.', 'originalExpenseId');
    if (input.date < orig.date) throw new DomainError('Tanggal pengembalian tidak boleh sebelum tanggal pengeluaran asal.', 'date');
    const already = refundedAmount(ds, orig.id, existing?.id);
    if (already + amount > orig.amount) {
      throw new DomainError(`Pengembalian melebihi pengeluaran asal. Sisa yang bisa dikembalikan ${formatRupiah(orig.amount - already)}.`, 'amount');
    }
    originalExpenseId = orig.id;
    categoryId = orig.categoryId;
    pocketId = orig.pocketId;
    priority = orig.priority;
    behavior = orig.behavior;
  }

  const fields = {
    type: input.type,
    date: input.date,
    amount,
    accountId: account.id,
    destinationAccountId: null,
    categoryId,
    pocketId,
    originalExpenseId,
    groupId: null,
    note,
    tags,
    priority,
    behavior,
    status: 'active' as const,
  };
  let row: Transaction;
  if (existing) {
    row = bump(existing, fields, ctx.now);
    changes.push(put('transactions', row), auditChange('transaction', row.id, 'update', existing, row, ctx.now));
  } else {
    row = { ...fresh(ctx.now), ...fields };
    changes.push(put('transactions', row), auditChange('transaction', row.id, 'create', null, row, ctx.now));
  }

  if (input.occurrence && !existing) changes.push(...occurrenceRecorded(ds, input.occurrence, row.id, ctx));
  return changes;
}

function occurrenceRecorded(ds: Dataset, occ: { reminderId: ID; dueDate: LocalDate }, txId: ID, ctx: Ctx): Change[] {
  const rem = ds.reminders.find((r) => r.id === occ.reminderId);
  if (!rem) throw new DomainError('Pengingat tidak ditemukan.');
  const ex = ds.occurrences.find((o) => o.reminderId === occ.reminderId && o.dueDate === occ.dueDate);
  if (ex?.status === 'recorded') throw new DomainError('Kejadian pengingat ini sudah dicatat.');
  const row: Occurrence = ex
    ? bump(ex, { status: 'recorded', linkedTransactionId: txId }, ctx.now)
    : { ...fresh(ctx.now), reminderId: occ.reminderId, dueDate: occ.dueDate, linkedTransactionId: txId, status: 'recorded' };
  return [put('occurrences', row)];
}

export interface TransferInput {
  /** id transaksi transfer saat mengedit. */
  id?: ID;
  date: LocalDate;
  amount: Money;
  fromAccountId: ID;
  toAccountId: ID;
  fee: Money;
  note?: string;
  tags?: string[] | string;
}

export function planSaveTransfer(ds: Dataset, input: TransferInput, ctx: Ctx): Change[] {
  const changes: Change[] = [];
  const existing = input.id ? ds.transactions.find((t) => t.id === input.id) : undefined;
  if (input.id && (!existing || existing.type !== 'transfer')) throw new DomainError('Transfer tidak ditemukan.');
  if (existing && existing.status !== 'active') throw new DomainError('Transfer yang dibatalkan tidak dapat diedit.');
  const amount = assertAmount(input.amount);
  if (!Number.isSafeInteger(input.fee) || input.fee < 0) throw new DomainError('Biaya harus 0 atau bilangan bulat positif.', 'fee');
  checkDate(input.date, ctx);
  if (input.fromAccountId === input.toAccountId) throw new DomainError('Rekening sumber dan tujuan harus berbeda.', 'toAccountId');
  const from = usableAccount(ds, input.fromAccountId, input.date, existing?.accountId, 'fromAccountId');
  const to = usableAccount(ds, input.toAccountId, input.date, existing?.destinationAccountId, 'toAccountId');
  const note = cleanNote(input.note);
  const tags = cleanTags(input.tags);
  const groupId = existing?.groupId ?? uid();

  const fields = {
    type: 'transfer' as const,
    date: input.date,
    amount,
    accountId: from.id,
    destinationAccountId: to.id,
    categoryId: null,
    pocketId: null,
    originalExpenseId: null,
    groupId,
    note,
    tags,
    priority: null,
    behavior: null,
    status: 'active' as const,
  };
  const transfer: Transaction = existing ? bump(existing, fields, ctx.now) : { ...fresh(ctx.now), ...fields };
  changes.push(put('transactions', transfer), auditChange('transaction', transfer.id, existing ? 'update' : 'create', existing ?? null, transfer, ctx.now));

  const oldFee = existing ? ds.transactions.find((t) => t.groupId === groupId && t.type === 'expense' && isActive(t)) : undefined;
  if (input.fee > 0) {
    const cat = ensureAdminFeeCategory(ds, ctx, changes);
    const feeFields = {
      type: 'expense' as const,
      date: input.date,
      amount: input.fee,
      accountId: from.id,
      destinationAccountId: null,
      categoryId: oldFee?.categoryId ?? cat.id,
      pocketId: null,
      originalExpenseId: null,
      groupId,
      note: 'Biaya transfer',
      tags,
      priority: cat.defaultPriority ?? 'need',
      behavior: cat.defaultBehavior ?? 'variable',
      status: 'active' as const,
    };
    if (oldFee && hasActiveRefunds(ds, oldFee.id)) throw new DomainError('Biaya transfer ini memiliki pengembalian dana; batalkan pengembaliannya dulu.');
    const fee: Transaction = oldFee ? bump(oldFee, feeFields, ctx.now) : { ...fresh(ctx.now), ...feeFields };
    changes.push(put('transactions', fee), auditChange('transaction', fee.id, oldFee ? 'update' : 'create', oldFee ?? null, fee, ctx.now));
  } else if (oldFee) {
    if (hasActiveRefunds(ds, oldFee.id)) throw new DomainError('Biaya transfer ini memiliki pengembalian dana; batalkan pengembaliannya dulu.');
    // Biaya dihapus saat edit: dibatalkan dan dilepas dari grup agar tidak ikut dipulihkan.
    const fee = bump(oldFee, { status: 'voided', groupId: null, note: 'Biaya transfer (dihapus saat edit)' }, ctx.now);
    changes.push(put('transactions', fee), auditChange('transaction', fee.id, 'void', oldFee, fee, ctx.now));
  }
  return changes;
}

/** Membatalkan transaksi (beserta seluruh kelompoknya, mis. transfer + biaya) secara atomik. */
export function planVoidTransaction(ds: Dataset, id: ID, ctx: Ctx): Change[] {
  const tx = ds.transactions.find((t) => t.id === id);
  if (!tx) throw new DomainError('Transaksi tidak ditemukan.');
  if (tx.status !== 'active') throw new DomainError('Transaksi sudah dibatalkan.');
  const group = tx.groupId ? ds.transactions.filter((t) => t.groupId === tx.groupId && isActive(t)) : [tx];
  const changes: Change[] = [];
  for (const t of group) {
    if (t.type === 'expense' && hasActiveRefunds(ds, t.id)) {
      throw new DomainError('Transaksi ini memiliki pengembalian dana aktif. Batalkan pengembalian dananya dulu.');
    }
    const v = bump(t, { status: 'voided' }, ctx.now);
    changes.push(put('transactions', v), auditChange('transaction', t.id, 'void', t, v, ctx.now));
    for (const o of ds.occurrences.filter((x) => x.linkedTransactionId === t.id && x.status === 'recorded')) {
      changes.push(put('occurrences', bump(o, { status: 'open' }, ctx.now)));
    }
  }
  return changes;
}

/** Memulihkan transaksi yang dibatalkan, dengan validasi ulang. */
export function planUnvoidTransaction(ds: Dataset, id: ID, ctx: Ctx): Change[] {
  const tx = ds.transactions.find((t) => t.id === id);
  if (!tx) throw new DomainError('Transaksi tidak ditemukan.');
  if (tx.status !== 'voided') throw new DomainError('Transaksi masih aktif.');
  const group = tx.groupId ? ds.transactions.filter((t) => t.groupId === tx.groupId && t.status === 'voided') : [tx];
  const changes: Change[] = [];
  for (const t of group) {
    for (const accId of [t.accountId, t.destinationAccountId]) {
      if (!accId) continue;
      const a = getAccount(ds, accId);
      if (a.archivedAt) throw new DomainError(`Rekening ${a.name} diarsipkan. Aktifkan kembali dulu.`);
      if (t.date < a.openingDate) throw new DomainError(`Tanggal transaksi sebelum pembukaan rekening ${a.name}.`);
    }
    if (t.type === 'refund') {
      const orig = ds.transactions.find((x) => x.id === t.originalExpenseId);
      if (!orig || orig.status !== 'active') throw new DomainError('Pengeluaran asal pengembalian ini sudah dibatalkan.');
      if (refundedAmount(ds, orig.id) + t.amount > orig.amount) throw new DomainError('Pengembalian akan melebihi pengeluaran asal.');
    }
    const occ = ds.occurrences.find((o) => o.linkedTransactionId === t.id && o.status === 'open');
    if (occ) changes.push(put('occurrences', bump(occ, { status: 'recorded' }, ctx.now)));
    const v = bump(t, { status: 'active' }, ctx.now);
    changes.push(put('transactions', v), auditChange('transaction', t.id, 'unvoid', t, v, ctx.now));
  }
  return changes;
}

// ======================= Alokasi kantong =======================

export interface AllocationInput {
  date: LocalDate;
  fromPocketId: ID | null;
  toPocketId: ID | null;
  amount: Money;
  note?: string;
}

function availableFor(ds: Dataset, fromPocketId: ID | null): Money {
  return fromPocketId ? pocketBalance(ds, fromPocketId) : unallocated(ds);
}

export function planAllocate(ds: Dataset, input: AllocationInput, ctx: Ctx): Change[] {
  const amount = assertAmount(input.amount);
  checkDate(input.date, ctx);
  if (!input.fromPocketId && !input.toPocketId) throw new DomainError('Pilih kantong sumber atau tujuan.');
  if (input.fromPocketId === input.toPocketId) throw new DomainError('Kantong sumber dan tujuan harus berbeda.', 'toPocketId');
  if (input.fromPocketId && !ds.pockets.some((p) => p.id === input.fromPocketId)) throw new DomainError('Kantong sumber tidak ditemukan.');
  usablePocket(ds, input.toPocketId);
  const available = availableFor(ds, input.fromPocketId);
  if (amount > available) {
    throw new DomainError(`Dana tersedia hanya ${formatRupiah(Math.max(0, available))}.`, 'amount');
  }
  const row: Allocation = { ...fresh(ctx.now), date: input.date, fromPocketId: input.fromPocketId, toPocketId: input.toPocketId, amount, note: cleanNote(input.note), status: 'active' };
  return [put('allocations', row), auditChange('allocation', row.id, 'create', null, row, ctx.now)];
}

export function planVoidAllocation(ds: Dataset, id: ID, ctx: Ctx): Change[] {
  const a = ds.allocations.find((x) => x.id === id);
  if (!a || a.status !== 'active') throw new DomainError('Alokasi tidak ditemukan atau sudah dibatalkan.');
  const v = bump(a, { status: 'voided' }, ctx.now);
  return [put('allocations', v), auditChange('allocation', id, 'void', a, v, ctx.now)];
}

export function planUnvoidAllocation(ds: Dataset, id: ID, ctx: Ctx): Change[] {
  const a = ds.allocations.find((x) => x.id === id);
  if (!a || a.status !== 'voided') throw new DomainError('Alokasi tidak ditemukan atau masih aktif.');
  if (a.amount > availableFor(ds, a.fromPocketId)) throw new DomainError('Dana sumber tidak lagi cukup untuk memulihkan alokasi ini.');
  const v = bump(a, { status: 'active' }, ctx.now);
  return [put('allocations', v), auditChange('allocation', id, 'unvoid', a, v, ctx.now)];
}

// ======================= Rekonsiliasi =======================

export function planReconcile(ds: Dataset, input: { accountId: ID; date: LocalDate; actualBalance: Money; reason: string }, ctx: Ctx): Change[] {
  checkDate(input.date, ctx);
  const acc = usableAccount(ds, input.accountId, input.date);
  if (!Number.isSafeInteger(input.actualBalance)) throw new DomainError('Saldo aktual tidak valid.', 'actualBalance');
  const reason = input.reason.trim();
  if (!reason) throw new DomainError('Alasan penyesuaian wajib diisi.', 'reason');
  if (reason.length > 200) throw new DomainError('Alasan maksimal 200 karakter.', 'reason');
  const recorded = accountBalance(ds, acc.id, input.date);
  const signedAmount = input.actualBalance - recorded;
  if (signedAmount === 0) throw new DomainError('Saldo tercatat sudah sama dengan saldo aktual.', 'actualBalance');
  const row: Adjustment = { ...fresh(ctx.now), accountId: acc.id, date: input.date, signedAmount, reason, status: 'active' };
  return [put('adjustments', row), auditChange('adjustment', row.id, 'create', null, row, ctx.now)];
}

export function planVoidAdjustment(ds: Dataset, id: ID, ctx: Ctx): Change[] {
  const j = ds.adjustments.find((x) => x.id === id);
  if (!j || j.status !== 'active') throw new DomainError('Penyesuaian tidak ditemukan atau sudah dibatalkan.');
  const v = bump(j, { status: 'voided' }, ctx.now);
  return [put('adjustments', v), auditChange('adjustment', id, 'void', j, v, ctx.now)];
}

// ======================= Rekening =======================

export interface AccountInput {
  name: string;
  type: AccountType;
  openingBalance: Money;
  openingDate: LocalDate;
}

export function planSaveAccount(ds: Dataset, input: AccountInput, ctx: Ctx, id?: ID): Change[] {
  const name = cleanName(input.name, 'Nama rekening');
  if (!['cash', 'bank', 'ewallet'].includes(input.type)) throw new DomainError('Jenis rekening tidak valid.', 'type');
  if (!Number.isSafeInteger(input.openingBalance) || input.openingBalance < 0) throw new DomainError('Saldo awal harus 0 atau lebih.', 'openingBalance');
  checkDate(input.openingDate, ctx, 'openingDate');
  if (ds.accounts.some((a) => a.id !== id && !a.archivedAt && a.name.toLowerCase() === name.toLowerCase())) {
    throw new DomainError(`Rekening "${name}" sudah ada.`, 'name');
  }
  if (id) {
    const old = ds.accounts.find((a) => a.id === id);
    if (!old) throw new DomainError('Rekening tidak ditemukan.');
    const earlier =
      ds.transactions.some((t) => isActive(t) && (t.accountId === id || t.destinationAccountId === id) && t.date < input.openingDate) ||
      ds.adjustments.some((j) => isActive(j) && j.accountId === id && j.date < input.openingDate);
    if (earlier) throw new DomainError('Ada transaksi sebelum tanggal pembukaan baru. Pilih tanggal yang lebih awal.', 'openingDate');
    const row = bump(old, { name, type: input.type, openingBalance: input.openingBalance, openingDate: input.openingDate }, ctx.now);
    return [put('accounts', row), auditChange('account', id, 'update', old, row, ctx.now)];
  }
  const row: Account = { ...fresh(ctx.now), name, type: input.type, openingBalance: input.openingBalance, openingDate: input.openingDate, archivedAt: null };
  return [put('accounts', row), auditChange('account', row.id, 'create', null, row, ctx.now)];
}

export function planArchiveAccount(ds: Dataset, id: ID, archive: boolean, ctx: Ctx): Change[] {
  const old = ds.accounts.find((a) => a.id === id);
  if (!old) throw new DomainError('Rekening tidak ditemukan.');
  if (archive) {
    const bal = accountBalance(ds, id);
    if (bal !== 0) {
      throw new DomainError(`Saldo rekening masih ${formatRupiah(bal)}. Catat transfer atau rekonsiliasi hingga Rp0 sebelum mengarsipkan.`);
    }
  }
  const row = bump(old, { archivedAt: archive ? ctx.now : null }, ctx.now);
  return [put('accounts', row), auditChange('account', id, archive ? 'archive' : 'unarchive', old, row, ctx.now)];
}

// ======================= Kategori =======================

export interface CategoryInput {
  name: string;
  kind: CategoryKind;
  grp: string;
  icon: string;
  color: string;
  defaultPriority: Priority | null;
  defaultBehavior: Behavior | null;
}

export function planSaveCategory(ds: Dataset, input: CategoryInput, ctx: Ctx, id?: ID): Change[] {
  const name = cleanName(input.name, 'Nama kategori', 40);
  if (ds.categories.some((c) => c.id !== id && c.kind === input.kind && !c.archivedAt && c.name.toLowerCase() === name.toLowerCase())) {
    throw new DomainError(`Kategori "${name}" sudah ada.`, 'name');
  }
  const fields = {
    name,
    kind: input.kind,
    grp: input.grp.trim() || 'Lainnya',
    icon: input.icon.trim().slice(0, 8) || '•',
    color: input.color,
    defaultPriority: input.kind === 'expense' ? input.defaultPriority : null,
    defaultBehavior: input.kind === 'expense' ? input.defaultBehavior : null,
  };
  if (id) {
    const old = ds.categories.find((c) => c.id === id);
    if (!old) throw new DomainError('Kategori tidak ditemukan.');
    if (old.kind !== input.kind && ds.transactions.some((t) => t.categoryId === id)) {
      throw new DomainError('Jenis kategori yang sudah dipakai tidak dapat diubah.', 'kind');
    }
    const row = bump(old, fields, ctx.now);
    return [put('categories', row), auditChange('category', id, 'update', old, row, ctx.now)];
  }
  const row: Category = { ...fresh(ctx.now), ...fields, systemKey: null, archivedAt: null };
  return [put('categories', row), auditChange('category', row.id, 'create', null, row, ctx.now)];
}

export function planArchiveCategory(ds: Dataset, id: ID, archive: boolean, ctx: Ctx): Change[] {
  const old = ds.categories.find((c) => c.id === id);
  if (!old) throw new DomainError('Kategori tidak ditemukan.');
  const row = bump(old, { archivedAt: archive ? ctx.now : null }, ctx.now);
  return [put('categories', row), auditChange('category', id, archive ? 'archive' : 'unarchive', old, row, ctx.now)];
}

// ======================= Kantong =======================

export function planSavePocket(ds: Dataset, input: { name: string; icon: string; color: string }, ctx: Ctx, id?: ID): Change[] {
  const name = cleanName(input.name, 'Nama kantong', 40);
  if (ds.pockets.some((p) => p.id !== id && !p.archivedAt && p.name.toLowerCase() === name.toLowerCase())) {
    throw new DomainError(`Kantong "${name}" sudah ada.`, 'name');
  }
  const fields = { name, icon: input.icon.trim().slice(0, 8) || '✉️', color: input.color };
  if (id) {
    const old = ds.pockets.find((p) => p.id === id);
    if (!old) throw new DomainError('Kantong tidak ditemukan.');
    const row = bump(old, fields, ctx.now);
    return [put('pockets', row), auditChange('pocket', id, 'update', old, row, ctx.now)];
  }
  const row: Pocket = { ...fresh(ctx.now), ...fields, archivedAt: null };
  return [put('pockets', row), auditChange('pocket', row.id, 'create', null, row, ctx.now)];
}

export function planArchivePocket(ds: Dataset, id: ID, archive: boolean, ctx: Ctx): Change[] {
  const old = ds.pockets.find((p) => p.id === id);
  if (!old) throw new DomainError('Kantong tidak ditemukan.');
  if (archive) {
    const bal = pocketBalance(ds, id);
    if (bal !== 0) throw new DomainError(`Saldo kantong masih ${formatRupiah(bal)}. Pindahkan dananya dulu sebelum mengarsipkan.`);
  }
  const row = bump(old, { archivedAt: archive ? ctx.now : null }, ctx.now);
  return [put('pockets', row), auditChange('pocket', id, archive ? 'archive' : 'unarchive', old, row, ctx.now)];
}

// ======================= Anggaran =======================

export function planSetBudget(ds: Dataset, input: { month: string; categoryId: ID; limitAmount: Money }, ctx: Ctx): Change[] {
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new DomainError('Bulan tidak valid.');
  const cat = ds.categories.find((c) => c.id === input.categoryId);
  if (!cat || cat.kind !== 'expense') throw new DomainError('Pilih kategori pengeluaran.', 'categoryId');
  if (!Number.isSafeInteger(input.limitAmount) || input.limitAmount < 0) throw new DomainError('Batas anggaran harus 0 atau lebih.', 'limitAmount');
  const old = ds.budgets.find((b) => b.month === input.month && b.categoryId === input.categoryId);
  if (old) {
    const row = bump(old, { limitAmount: input.limitAmount }, ctx.now);
    return [put('budgets', row), auditChange('budget', old.id, 'update', old, row, ctx.now)];
  }
  if (cat.archivedAt) throw new DomainError(`Kategori ${cat.name} sudah diarsipkan.`, 'categoryId');
  const row: Budget = { ...fresh(ctx.now), month: input.month, categoryId: input.categoryId, limitAmount: input.limitAmount };
  return [put('budgets', row), auditChange('budget', row.id, 'create', null, row, ctx.now)];
}

export function planDeleteBudget(ds: Dataset, id: ID, ctx: Ctx): Change[] {
  const old = ds.budgets.find((b) => b.id === id);
  if (!old) throw new DomainError('Anggaran tidak ditemukan.');
  return [{ table: 'budgets', op: 'delete', id }, auditChange('budget', id, 'delete', old, null, ctx.now)];
}

/** Menyalin batas (bukan realisasi) dari bulan sebelumnya untuk kategori yang belum punya anggaran. */
export function planCopyBudgets(ds: Dataset, fromMonth: string, toMonth: string, ctx: Ctx): Change[] {
  const changes: Change[] = [];
  for (const b of ds.budgets.filter((x) => x.month === fromMonth)) {
    if (ds.budgets.some((x) => x.month === toMonth && x.categoryId === b.categoryId)) continue;
    const cat = ds.categories.find((c) => c.id === b.categoryId);
    if (!cat || cat.archivedAt) continue;
    const row: Budget = { ...fresh(ctx.now), month: toMonth, categoryId: b.categoryId, limitAmount: b.limitAmount };
    changes.push(put('budgets', row));
  }
  if (changes.length === 0) throw new DomainError('Tidak ada batas yang bisa disalin dari bulan sebelumnya.');
  return changes;
}

// ======================= Tujuan =======================

export interface GoalInput {
  name: string;
  targetAmount: Money;
  deadline: LocalDate | null;
  icon: string;
  color: string;
  pocketId: ID | null;
  newPocketName?: string;
}

export function planSaveGoal(ds: Dataset, input: GoalInput, ctx: Ctx, id?: ID): Change[] {
  const name = cleanName(input.name, 'Nama tujuan', 50);
  const target = assertAmount(input.targetAmount, 'Target');
  if (input.deadline && !isValidDate(input.deadline)) throw new DomainError('Tenggat tidak valid.', 'deadline');
  const changes: Change[] = [];
  let pocketId = input.pocketId;
  if (!pocketId) {
    const pc = planSavePocket(ds, { name: input.newPocketName?.trim() || name, icon: input.icon, color: input.color }, ctx);
    changes.push(...pc);
    pocketId = (pc[0] as { row: { id: ID } }).row.id;
  } else {
    const p = ds.pockets.find((x) => x.id === pocketId);
    if (!p) throw new DomainError('Kantong tidak ditemukan.', 'pocketId');
    if (ds.goals.some((g) => g.pocketId === pocketId && g.id !== id)) throw new DomainError('Kantong ini sudah dipakai tujuan lain.', 'pocketId');
  }
  const fields = { name, targetAmount: target, deadline: input.deadline, icon: input.icon || '🎯', color: input.color, pocketId };
  if (id) {
    const old = ds.goals.find((g) => g.id === id);
    if (!old) throw new DomainError('Tujuan tidak ditemukan.');
    const resetCelebration = target !== old.targetAmount ? { celebrationShownAt: null } : {};
    const row = bump(old, { ...fields, ...resetCelebration }, ctx.now);
    changes.push(put('goals', row), auditChange('goal', id, 'update', old, row, ctx.now));
  } else {
    const row: Goal = { ...fresh(ctx.now), ...fields, celebrationShownAt: null };
    changes.push(put('goals', row), auditChange('goal', row.id, 'create', null, row, ctx.now));
  }
  return changes;
}

export function planDeleteGoal(ds: Dataset, id: ID, ctx: Ctx): Change[] {
  const old = ds.goals.find((g) => g.id === id);
  if (!old) throw new DomainError('Tujuan tidak ditemukan.');
  return [{ table: 'goals', op: 'delete', id }, auditChange('goal', id, 'delete', old, null, ctx.now)];
}

export function planGoalCelebrated(ds: Dataset, id: ID, ctx: Ctx): Change[] {
  const old = ds.goals.find((g) => g.id === id);
  if (!old || old.celebrationShownAt) return [];
  return [put('goals', bump(old, { celebrationShownAt: ctx.now }, ctx.now))];
}

// ======================= Pengingat =======================

export interface ReminderInput {
  name: string;
  kind: ReminderKind;
  frequency: Frequency;
  anchorDate: LocalDate;
  amount: Money;
  accountId: ID;
  categoryId: ID;
  pocketId: ID | null;
  active: boolean;
}

export function planSaveReminder(ds: Dataset, input: ReminderInput, ctx: Ctx, id?: ID): Change[] {
  const name = cleanName(input.name, 'Nama pengingat', 50);
  const amount = assertAmount(input.amount);
  if (!isValidDate(input.anchorDate)) throw new DomainError('Tanggal jatuh tempo tidak valid.', 'anchorDate');
  if (!['weekly', 'monthly', 'yearly'].includes(input.frequency)) throw new DomainError('Frekuensi tidak valid.');
  const old = id ? ds.reminders.find((r) => r.id === id) : undefined;
  const acc = getAccount(ds, input.accountId);
  if (acc.archivedAt && acc.id !== old?.accountId) throw new DomainError(`Rekening ${acc.name} sudah diarsipkan.`, 'accountId');
  usableCategory(ds, input.categoryId, input.kind === 'income' ? 'income' : 'expense', old?.categoryId);
  const pocketId = input.kind === 'bill' ? (usablePocket(ds, input.pocketId, old?.pocketId)?.id ?? null) : null;
  const fields = { name, kind: input.kind, frequency: input.frequency, anchorDate: input.anchorDate, amount, accountId: acc.id, categoryId: input.categoryId, pocketId, active: input.active };
  if (id) {
    if (!old) throw new DomainError('Pengingat tidak ditemukan.');
    const row = bump(old, fields, ctx.now);
    return [put('reminders', row), auditChange('reminder', id, 'update', old, row, ctx.now)];
  }
  const row: Reminder = { ...fresh(ctx.now), ...fields };
  return [put('reminders', row), auditChange('reminder', row.id, 'create', null, row, ctx.now)];
}

export function planSetOccurrence(ds: Dataset, reminderId: ID, dueDate: LocalDate, status: 'skipped' | 'open', ctx: Ctx): Change[] {
  const rem = ds.reminders.find((r) => r.id === reminderId);
  if (!rem) throw new DomainError('Pengingat tidak ditemukan.');
  if (!dueDatesBetween(rem, dueDate, dueDate).includes(dueDate)) throw new DomainError('Tanggal bukan jadwal pengingat ini.');
  const ex = ds.occurrences.find((o) => o.reminderId === reminderId && o.dueDate === dueDate);
  if (ex?.status === 'recorded') throw new DomainError('Kejadian ini sudah dicatat sebagai transaksi.');
  const row: Occurrence = ex
    ? bump(ex, { status, linkedTransactionId: null }, ctx.now)
    : { ...fresh(ctx.now), reminderId, dueDate, linkedTransactionId: null, status };
  return [put('occurrences', row)];
}

// ======================= Utilitas =======================

/** Helper untuk merangkai beberapa planner secara berurutan pada dataset yang terus diperbarui. */
export function sequence(ds: Dataset, steps: ((d: Dataset) => Change[])[], apply: (d: Dataset, c: Change[]) => Dataset): { ds: Dataset; changes: Change[] } {
  let cur = ds;
  const all: Change[] = [];
  for (const s of steps) {
    const c = s(cur);
    all.push(...c);
    cur = apply(cur, c);
  }
  return { ds: cur, changes: all };
}

