// Repository lokal (Dexie/IndexedDB) — dipakai mode demo, database terpisah dari data pribadi.
// Planner dijalankan ulang DI DALAM transaksi rw terhadap data segar, sehingga dua tab yang
// mengalokasikan dana bersamaan tidak dapat melewati batas tersedia.

import Dexie, { type Table } from 'dexie';
import { sortDataset } from '../domain/changes';
import { emptySettings, TABLE_KEYS, type Change, type Dataset, type Settings } from '../domain/types';
import { StorageError, type Planner, type Repository } from './repository';

type SettingsRow = Settings & { key: 'settings' };

class KantongDexie extends Dexie {
  settings!: Table<SettingsRow, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      settings: 'key',
      accounts: 'id',
      categories: 'id',
      pockets: 'id',
      transactions: 'id, date',
      allocations: 'id',
      adjustments: 'id',
      budgets: 'id, &[month+categoryId]',
      goals: 'id, &pocketId',
      reminders: 'id',
      occurrences: 'id, &[reminderId+dueDate]',
      auditEvents: 'id',
    });
  }
}

export function storageErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  const inner = (e as { inner?: { name?: string } })?.inner?.name ?? '';
  if (name === 'QuotaExceededError' || inner === 'QuotaExceededError') return 'Penyimpanan browser penuh. Hapus data demo atau kosongkan ruang penyimpanan.';
  if (name === 'MissingAPIError' || name === 'InvalidStateError' || name === 'OpenFailedError') {
    return 'IndexedDB tidak tersedia (mungkin mode privat atau penyimpanan diblokir). Mode demo membutuhkan IndexedDB.';
  }
  if (name === 'ConstraintError' || inner === 'ConstraintError') return 'Data serupa sudah ada (mungkin dibuat di tab lain).';
  return (e as Error)?.message ?? 'Gagal menyimpan ke browser.';
}

export class LocalRepository implements Repository {
  readonly kind = 'local' as const;
  private db: KantongDexie;

  constructor(name = 'kantong-demo') {
    this.db = new KantongDexie(name);
  }

  private tables() {
    return [this.db.settings, ...TABLE_KEYS.map((k) => this.db.table(k))];
  }

  private async read(): Promise<Dataset> {
    const s = await this.db.settings.get('settings');
    const ds = { settings: s ? (({ key: _k, ...rest }) => rest)(s) : emptySettings() } as Dataset;
    for (const k of TABLE_KEYS) (ds as unknown as Record<string, unknown[]>)[k] = await this.db.table(k).toArray();
    return sortDataset(ds);
  }

  private async write(changes: Change[]) {
    for (const c of changes) {
      if (c.table === 'settings') await this.db.settings.put({ ...(c.row as Settings), key: 'settings' });
      else if (c.op === 'delete') await this.db.table(c.table).delete(c.id);
      else await this.db.table(c.table).put(c.row);
    }
  }

  private wrap<T>(p: Promise<T>): Promise<T> {
    return p.catch((e) => {
      if (e instanceof Error && (e.name === 'DomainError' || e.name === 'DeficitError' || e.name === 'ConflictError')) throw e;
      // Dexie membungkus error dari dalam transaksi; teruskan error domain apa adanya.
      const inner = (e as { inner?: Error }).inner;
      if (inner && (inner.name === 'DomainError' || inner.name === 'DeficitError')) throw inner;
      throw new StorageError(storageErrorMessage(e));
    });
  }

  load(): Promise<Dataset> {
    return this.wrap(this.db.transaction('r', this.tables(), () => this.read()));
  }

  /** `current` diabaikan: planner selalu dijalankan terhadap data segar di dalam transaksi. */
  async apply(plan: Planner, _current?: Dataset) {
    let changes: Change[] = [];
    const dataset = await this.wrap(
      this.db.transaction('rw', this.tables(), async () => {
        const fresh = await this.read();
        changes = plan(fresh);
        await this.write(changes);
        return this.read();
      }),
    );
    return { changes, dataset };
  }

  replaceAll(ds: Dataset): Promise<void> {
    return this.wrap(
      this.db.transaction('rw', this.tables(), async () => {
        for (const t of this.tables()) await t.clear();
        await this.db.settings.put({ ...ds.settings, key: 'settings' });
        for (const k of TABLE_KEYS) await this.db.table(k).bulkPut(ds[k] as unknown[]);
      }),
    );
  }

  clear(): Promise<void> {
    return this.wrap(
      this.db.transaction('rw', this.tables(), async () => {
        for (const t of this.tables()) await t.clear();
      }),
    );
  }
}
