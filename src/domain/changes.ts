import { formatRupiah } from './money';
import { accountBalances, pocketBalances, unallocated } from './ledger';
import type { AuditEvent, Change, Dataset, ID, PutRow, TableKey } from './types';

/** Menerapkan change set ke dataset secara imutabel. Dipakai planner, store, dan repository lokal. */
export function applyChanges(ds: Dataset, changes: Change[]): Dataset {
  const next: Dataset = { ...ds };
  const touched = new Set<TableKey>();
  for (const c of changes) {
    if (c.table === 'settings') {
      next.settings = c.row as Dataset['settings'];
      continue;
    }
    const table = c.table as TableKey;
    if (!touched.has(table)) {
      (next as unknown as Record<string, unknown[]>)[table] = [...(ds[table] as unknown[])];
      touched.add(table);
    }
    const rows = next[table] as unknown as { id: ID }[];
    const id = c.op === 'delete' ? c.id : (c.row as { id: ID }).id;
    const idx = rows.findIndex((r) => r.id === id);
    if (c.op === 'delete') {
      if (idx >= 0) rows.splice(idx, 1);
    } else if (idx >= 0) {
      rows[idx] = c.row as { id: ID };
    } else {
      rows.push(c.row as { id: ID });
    }
  }
  return next;
}

export function auditChange(
  entityType: string,
  entityId: ID,
  action: AuditEvent['action'],
  before: unknown,
  after: unknown,
  now: string,
): Change {
  const ev: AuditEvent = { id: crypto.randomUUID(), entityType, entityId, action, before: before ?? null, after: after ?? null, createdAt: now };
  return { table: 'auditEvents', op: 'put', row: ev as unknown as PutRow };
}

export interface Deficit {
  kind: 'account' | 'pocket' | 'unallocated';
  id: ID | null;
  name: string;
  before: number;
  after: number;
}

/** Defisit baru atau memburuk akibat perubahan. Pengeluaran aktual boleh dicatat setelah konfirmasi. */
export function assessDeficits(before: Dataset, after: Dataset): Deficit[] {
  const out: Deficit[] = [];
  const ab = accountBalances(before);
  const aa = accountBalances(after);
  for (const a of after.accounts) {
    const b = ab.get(a.id) ?? 0;
    const x = aa.get(a.id) ?? 0;
    if (x < 0 && x < b) out.push({ kind: 'account', id: a.id, name: a.name, before: b, after: x });
  }
  const pb = pocketBalances(before);
  const pa = pocketBalances(after);
  for (const p of after.pockets) {
    const b = pb.get(p.id) ?? 0;
    const x = pa.get(p.id) ?? 0;
    if (x < 0 && x < b) out.push({ kind: 'pocket', id: p.id, name: p.name, before: b, after: x });
  }
  const ub = unallocated(before);
  const ua = unallocated(after);
  if (ua < 0 && ua < ub) out.push({ kind: 'unallocated', id: null, name: 'Dana belum dialokasikan', before: ub, after: ua });
  return out;
}

export function describeDeficit(d: Deficit): string {
  const label = d.kind === 'account' ? `Rekening ${d.name}` : d.kind === 'pocket' ? `Kantong ${d.name}` : d.name;
  return `${label} akan menjadi ${formatRupiah(d.after)}.`;
}

export class DeficitError extends Error {
  constructor(public deficits: Deficit[]) {
    super('Perubahan ini menimbulkan defisit.');
    this.name = 'DeficitError';
  }
}

/** Edit basi: record sudah diubah di tab/perangkat lain. */
export class ConflictError extends Error {
  constructor(message = 'Data sudah berubah di tab atau perangkat lain. Data dimuat ulang — silakan coba lagi.') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Urutan tampilan deterministik (IndexedDB mengembalikan baris menurut id acak). */
export function sortDataset(ds: Dataset): Dataset {
  const byCreated = <T extends { createdAt: string; id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  return {
    ...ds,
    accounts: byCreated(ds.accounts),
    categories: byCreated(ds.categories),
    pockets: byCreated(ds.pockets),
    goals: byCreated(ds.goals),
    reminders: byCreated(ds.reminders),
    auditEvents: byCreated(ds.auditEvents),
  };
}
