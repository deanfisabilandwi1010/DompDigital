import type { Change, Dataset } from '../domain/types';

export type Planner = (ds: Dataset) => Change[];

/**
 * Abstraksi penyimpanan. UI dan domain tidak tahu apakah data ada di Nhost atau IndexedDB.
 * `apply` harus atomik: seluruh change set tersimpan, atau tidak sama sekali.
 */
export interface Repository {
  readonly kind: 'cloud' | 'local';
  load(): Promise<Dataset>;
  apply(plan: Planner, current: Dataset): Promise<{ changes: Change[]; dataset: Dataset }>;
  /** Restore: mengganti seluruh data secara atomik. */
  replaceAll(ds: Dataset): Promise<void>;
  /** Menghapus seluruh data pada penyimpanan ini. */
  clear(): Promise<void>;
}

/** Kegagalan penyimpanan (jaringan, kuota, server) — input pengguna harus dipertahankan. */
export class StorageError extends Error {
  constructor(message: string, public retryable = true) {
    super(message);
    this.name = 'StorageError';
  }
}
