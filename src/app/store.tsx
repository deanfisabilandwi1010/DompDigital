// Sumber data tunggal untuk seluruh halaman. Semua penulisan melewati `run(planner)`:
// planner → cek defisit → repository.apply (atomik) → dataset diperbarui → tab lain diberi tahu.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applyChanges, assessDeficits, ConflictError, DeficitError, describeDeficit } from '../domain/changes';
import type { Ctx } from '../domain/commands';
import { nowIso, periodFromPreset, todayIn, type Period, type PeriodPreset } from '../domain/dates';
import { formatRupiah } from '../domain/money';
import { DomainError, type Dataset, type Money } from '../domain/types';
import type { Planner, Repository } from '../data/repository';
import { useUi } from './ui';

export type Mode = 'personal' | 'demo';

interface StoreApi {
  mode: Mode;
  repo: Repository;
  ds: Dataset;
  today: string;
  ctx: () => Ctx;
  run: (plan: (ds: Dataset, ctx: Ctx) => ReturnType<Planner>, opts?: { allowDeficit?: boolean }) => Promise<Dataset>;
  reload: () => Promise<void>;
  replaceAll: (ds: Dataset) => Promise<void>;
  clearAll: () => Promise<void>;
  period: Period;
  setPeriod: (preset: PeriodPreset, custom?: { from: string; to: string }) => void;
  fmt: (n: Money, opts?: { sign?: boolean }) => string;
  hidden: boolean;
}

const StoreCtx = createContext<StoreApi | null>(null);

export function useStore(): StoreApi {
  const v = useContext(StoreCtx);
  if (!v) throw new Error('DataProvider hilang');
  return v;
}

function useToday(timezone: string): string {
  const [today, setToday] = useState(() => todayIn(timezone));
  useEffect(() => {
    setToday(todayIn(timezone));
    const t = window.setInterval(() => setToday(todayIn(timezone)), 60_000);
    return () => window.clearInterval(t);
  }, [timezone]);
  return today;
}

interface Props {
  mode: Mode;
  repo: Repository;
  initial: Dataset;
  channelName: string;
  children: ReactNode;
}

export function DataProvider({ mode, repo, initial, channelName, children }: Props) {
  const [ds, setDs] = useState<Dataset>(initial);
  const dsRef = useRef(ds);
  dsRef.current = ds;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const channel = useRef<BroadcastChannel | null>(null);
  const today = useToday(ds.settings.timezone);

  const reload = useCallback(async () => {
    const fresh = await repo.load();
    setDs(fresh);
  }, [repo]);

  // Sinkron antar-tab: tab lain memuat ulang setelah commit berhasil.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(channelName);
    ch.onmessage = () => void reload().catch(() => undefined);
    channel.current = ch;
    return () => ch.close();
  }, [channelName, reload]);

  // Data cloud dapat berubah dari perangkat lain: muat ulang saat tab kembali aktif.
  useEffect(() => {
    if (repo.kind !== 'cloud') return;
    let last = Date.now();
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 30_000) {
        last = Date.now();
        void reload().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [repo, reload]);

  const ctx = useCallback((): Ctx => ({ today: todayIn(dsRef.current.settings.timezone), now: nowIso() }), []);

  const run = useCallback<StoreApi['run']>(
    (plan, opts = {}) => {
      // Commit diserialkan per tab; tiap planner berjalan terhadap data terbaru.
      const job = queue.current.then(async () => {
        const c = ctx();
        const current = dsRef.current;
        const changes = plan(current, c);
        if (!opts.allowDeficit) {
          const deficits = assessDeficits(current, applyChanges(current, changes));
          if (deficits.length) throw new DeficitError(deficits);
        }
        try {
          const { dataset } = await repo.apply((fresh) => plan(fresh, c), current);
          dsRef.current = dataset;
          setDs(dataset);
          channel.current?.postMessage('changed');
          return dataset;
        } catch (e) {
          if (e instanceof ConflictError) await reload().catch(() => undefined);
          throw e;
        }
      });
      queue.current = job.catch(() => undefined);
      return job;
    },
    [ctx, repo, reload],
  );

  const replaceAll = useCallback(
    async (next: Dataset) => {
      await repo.replaceAll(next);
      await reload();
      channel.current?.postMessage('changed');
    },
    [repo, reload],
  );

  const clearAll = useCallback(async () => {
    await repo.clear();
    await reload();
    channel.current?.postMessage('changed');
  }, [repo, reload]);

  const [periodState, setPeriodState] = useState<{ preset: PeriodPreset; custom?: { from: string; to: string } }>({ preset: 'this-month' });
  const period = useMemo(() => periodFromPreset(periodState.preset, today, periodState.custom), [periodState, today]);
  const setPeriod = useCallback((preset: PeriodPreset, custom?: { from: string; to: string }) => setPeriodState({ preset, custom }), []);

  const hidden = ds.settings.hideAmounts;
  const fmt = useCallback((n: Money, o?: { sign?: boolean }) => (hidden ? 'Rp•••••' : formatRupiah(n, o)), [hidden]);

  // Kelas gerak dikurangi pada <html>.
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', ds.settings.reducedMotion);
  }, [ds.settings.reducedMotion]);

  const api: StoreApi = { mode, repo, ds, today, ctx, run, reload, replaceAll, clearAll, period, setPeriod, fmt, hidden };
  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}

/**
 * Hook commit untuk formulir & tombol aksi: menangani konfirmasi defisit,
 * toast sukses hanya setelah commit berhasil, dan kunci sinkron anti klik-ganda.
 */
export function useCommit() {
  const { run } = useStore();
  const { confirm, toast } = useUi();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);

  const commit = useCallback(
    async (plan: (ds: Dataset, ctx: Ctx) => ReturnType<Planner>, success?: string): Promise<boolean> => {
      if (lock.current) return false;
      lock.current = true;
      setBusy(true);
      try {
        try {
          await run(plan);
        } catch (e) {
          if (!(e instanceof DeficitError)) throw e;
          const ok = await confirm({
            title: 'Catat walau defisit?',
            confirmLabel: 'Tetap catat',
            body: (
              <div className="stack">
                <p>Perubahan ini membuat saldo berikut negatif. Angka defisit akan tetap ditampilkan apa adanya.</p>
                <ul>{e.deficits.map((d, i) => <li key={i}>{describeDeficit(d)}</li>)}</ul>
              </div>
            ),
          });
          if (!ok) return false;
          await run(plan, { allowDeficit: true });
        }
        if (success) toast(success, 'success');
        return true;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [run, confirm, toast],
  );

  /** Untuk tombol aksi tanpa formulir: error ditampilkan sebagai toast. */
  const act = useCallback(
    async (plan: (ds: Dataset, ctx: Ctx) => ReturnType<Planner>, success?: string) => {
      try {
        return await commit(plan, success);
      } catch (e) {
        toast(errorMessage(e), 'error');
        return false;
      }
    },
    [commit, toast],
  );

  return { commit, act, busy };
}

export function errorMessage(e: unknown): string {
  if (e instanceof DomainError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Terjadi kesalahan yang tidak diketahui.';
}
