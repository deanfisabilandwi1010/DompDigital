// Repository Nhost: Hasura GraphQL. Satu request mutation berisi beberapa root field dijalankan
// Hasura secara berurutan dalam SATU transaksi database — itulah dasar atomisitas change set.

import { SETTINGS_FIELDS, TABLE_FIELDS } from '../domain/backup';
import { applyChanges, ConflictError, sortDataset } from '../domain/changes';
import { DomainError, emptySettings, TABLE_KEYS, type Change, type Dataset, type Settings, type TableKey } from '../domain/types';
import { formatRupiah } from '../domain/money';
import { auth, AuthError } from './auth';
import { NHOST } from './config';
import { StorageError, type Planner, type Repository } from './repository';

type AnyTable = TableKey | 'settings';

const DB_NAME: Record<AnyTable, string> = {
  settings: 'settings',
  accounts: 'accounts',
  categories: 'categories',
  pockets: 'pockets',
  transactions: 'transactions',
  allocations: 'allocations',
  adjustments: 'adjustments',
  budgets: 'budgets',
  goals: 'goals',
  reminders: 'reminders',
  occurrences: 'occurrences',
  auditEvents: 'audit_events',
};

/** Urutan tulis: induk sebelum anak; transaksi sebelum alokasi (trigger dana tersedia membaca transaksi). */
const WRITE_ORDER: AnyTable[] = ['settings', 'accounts', 'categories', 'pockets', 'transactions', 'adjustments', 'allocations', 'budgets', 'goals', 'reminders', 'occurrences', 'auditEvents'];

const NUMERIC = new Set(['openingBalance', 'amount', 'signedAmount', 'limitAmount', 'targetAmount', 'version', 'budgetWarnPct']);

const snake = (s: string) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const fieldsOf = (t: AnyTable) => (t === 'settings' ? SETTINGS_FIELDS : TABLE_FIELDS[t]);

function toDb(t: AnyTable, row: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fieldsOf(t)) out[snake(f)] = row[f] === undefined ? null : row[f];
  return { ...out, ...extra };
}

function fromDb(t: AnyTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fieldsOf(t)) {
    let v = row[snake(f)];
    if (v != null && NUMERIC.has(f)) v = Number(v);
    if (v != null && f.endsWith('At') && typeof v === 'string') v = new Date(v).toISOString();
    out[f] = v ?? null;
  }
  return out;
}

// ---------------- GraphQL ----------------

interface GqlError {
  message: string;
  extensions?: { code?: string };
}

async function request<T>(query: string, variables: Record<string, unknown> = {}, retried = false): Promise<T> {
  const token = await auth.getAccessToken();
  let res: Response;
  try {
    res = await fetch(NHOST.graphqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new StorageError('Tidak dapat menghubungi server Nhost. Periksa koneksi lalu coba lagi.');
  }
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: GqlError[] };
  if (json.errors?.length) {
    const e = json.errors[0];
    if (!retried && (e.extensions?.code === 'invalid-jwt' || /JWT/i.test(e.message))) {
      await auth.getAccessToken(true);
      return request<T>(query, variables, true);
    }
    throw translate(e);
  }
  if (!res.ok || !json.data) throw new StorageError(`Server mengembalikan status ${res.status}.`);
  return json.data;
}

function translate(e: GqlError): Error {
  const m = e.message ?? '';
  if (m.includes('KANTONG_CONFLICT')) return new ConflictError();
  const funds = /KANTONG_INSUFFICIENT_FUNDS: dana tersedia (-?\d+)/.exec(m);
  if (funds) return new DomainError(`Dana tersedia hanya ${formatRupiah(Number(funds[1]))} (diperiksa server). Mungkin sudah dialokasikan dari tab lain.`, 'amount');
  if (/Uniqueness violation/i.test(m)) return new ConflictError('Data serupa sudah ada (mungkin dibuat dari tab lain). Data dimuat ulang — silakan periksa.');
  if (/Foreign key violation/i.test(m)) return new DomainError('Relasi data tidak valid (data terkait mungkin sudah berubah). Muat ulang lalu coba lagi.');
  if (/not found in type|no such type|field .* not found/i.test(m)) {
    return new StorageError('Schema database Kantong belum dipasang di Nhost. Jalankan `npm run setup:nhost` (lihat README).', false);
  }
  if (/Check constraint violation/i.test(m)) return new DomainError('Data ditolak validasi server.');
  if (e.extensions?.code === 'access-denied' || /permission/i.test(m)) return new AuthError('Akses ditolak. Silakan masuk ulang.', 'access-denied');
  return new StorageError(`Gagal menyimpan ke server: ${m}`);
}

// ---------------- Repository ----------------

function loadQuery(): string {
  const parts = WRITE_ORDER.map((t) => {
    const cols = fieldsOf(t).map(snake).join(' ');
    const order = t === 'settings' ? '' : '(order_by: {created_at: asc})';
    return `${t}: ${DB_NAME[t]}${order} { ${cols} }`;
  });
  return `query KantongLoad { ${parts.join('\n')} }`;
}

function updateColumns(t: AnyTable): string {
  return fieldsOf(t).map(snake).filter((c) => c !== 'id').join(', ');
}

interface Built {
  query: string;
  variables: Record<string, unknown>;
}

function buildMutation(changes: Change[]): Built {
  const deletes = new Map<AnyTable, Set<string>>();
  const puts = new Map<AnyTable, Map<string, Record<string, unknown>>>();
  for (const c of changes) {
    if (c.op === 'delete') {
      if (!deletes.has(c.table)) deletes.set(c.table, new Set());
      deletes.get(c.table)!.add(c.id);
      puts.get(c.table)?.delete(c.id);
    } else {
      const key = c.table === 'settings' ? 'settings' : (c.row as { id: string }).id;
      if (!puts.has(c.table)) puts.set(c.table, new Map());
      puts.get(c.table)!.set(key, c.row as Record<string, unknown>);
    }
  }
  const defs: string[] = [];
  const fields: string[] = [];
  const variables: Record<string, unknown> = {};
  for (const t of [...WRITE_ORDER].reverse()) {
    const ids = deletes.get(t);
    if (!ids?.size) continue;
    defs.push(`$d_${t}: [uuid!]!`);
    fields.push(`d_${t}: delete_${DB_NAME[t]}(where: {id: {_in: $d_${t}}}) { affected_rows }`);
    variables[`d_${t}`] = [...ids];
  }
  for (const t of WRITE_ORDER) {
    const rows = puts.get(t);
    if (!rows?.size) continue;
    const name = DB_NAME[t];
    defs.push(`$p_${t}: [${name}_insert_input!]!`);
    const conflict = t === 'auditEvents' ? '' : `, on_conflict: {constraint: ${name}_pkey, update_columns: [${updateColumns(t)}]}`;
    fields.push(`p_${t}: insert_${name}(objects: $p_${t}${conflict}) { affected_rows }`);
    variables[`p_${t}`] = [...rows.values()].map((r) => toDb(t, r));
  }
  return { query: `mutation KantongCommit(${defs.join(', ')}) { ${fields.join('\n')} }`, variables };
}

export class NhostRepository implements Repository {
  readonly kind = 'cloud' as const;

  async load(): Promise<Dataset> {
    const data = await request<Record<AnyTable, Record<string, unknown>[]>>(loadQuery());
    const settingsRow = data.settings[0];
    const ds = { settings: settingsRow ? ({ ...emptySettings(), ...fromDb('settings', settingsRow) } as Settings) : emptySettings() } as Dataset;
    for (const t of TABLE_KEYS) (ds as unknown as Record<string, unknown[]>)[t] = data[t].map((r) => fromDb(t, r));
    return sortDataset(ds);
  }

  async apply(plan: Planner, current: Dataset) {
    const changes = plan(current);
    if (changes.length === 0) return { changes, dataset: current };
    const { query, variables } = buildMutation(changes);
    await request(query, variables);
    return { changes, dataset: applyChanges(current, changes) };
  }

  async replaceAll(ds: Dataset): Promise<void> {
    const defs: string[] = [];
    const fields: string[] = [];
    const variables: Record<string, unknown> = {};
    for (const t of [...WRITE_ORDER].reverse()) fields.push(`x_${t}: delete_${DB_NAME[t]}(where: {}) { affected_rows }`);
    for (const t of WRITE_ORDER) {
      const rows = t === 'settings' ? [ds.settings] : (ds[t] as unknown as Record<string, unknown>[]);
      if (!rows.length) continue;
      defs.push(`$p_${t}: [${DB_NAME[t]}_insert_input!]!`);
      fields.push(`p_${t}: insert_${DB_NAME[t]}(objects: $p_${t}) { affected_rows }`);
      // enforce_funds=false: alokasi historis tidak diperiksa ulang terhadap urutan sisip restore.
      variables[`p_${t}`] = rows.map((r) => toDb(t, r as Record<string, unknown>, t === 'allocations' ? { enforce_funds: false } : {}));
    }
    const sig = defs.length ? `(${defs.join(', ')})` : '';
    await request(`mutation KantongRestore${sig} { ${fields.join('\n')} }`, variables);
  }

  async clear(): Promise<void> {
    const fields = [...WRITE_ORDER].reverse().map((t) => `x_${t}: delete_${DB_NAME[t]}(where: {}) { affected_rows }`);
    await request(`mutation KantongClear { ${fields.join('\n')} }`);
  }
}
