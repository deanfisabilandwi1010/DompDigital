import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { makeBackup, parseBackup } from '../domain/backup';
import { planAllocate, planSaveTransfer, type Ctx } from '../domain/commands';
import { fixtureSteps, runSteps } from '../domain/demo';
import { totalBalance, unallocated } from '../domain/ledger';
import { DomainError } from '../domain/types';
import { LocalRepository } from '../data/localRepository';

const ctx: Ctx = { today: '2026-10-21', now: '2026-10-21T03:00:00.000Z' };
let n = 0;
const fresh = () => `test-db-${++n}`;

async function seeded(name: string) {
  const repo = new LocalRepository(name);
  await repo.replaceAll(runSteps(fixtureSteps('2026-10'), ctx));
  return repo;
}

describe('LocalRepository (IndexedDB)', () => {
  it('simpan lalu muat ulang: data sama (persisten antar instance)', async () => {
    const name = fresh();
    await seeded(name);
    const reopened = new LocalRepository(name);
    const ds = await reopened.load();
    expect(totalBalance(ds)).toBe(7_422_500);
    expect(ds.transactions).toHaveLength(5);
  });

  it('planner gagal di tengah transaksi → tidak ada yang tertulis', async () => {
    const repo = await seeded(fresh());
    const before = await repo.load();
    await expect(
      repo.apply((ds) => {
        const ok = planSaveTransfer(ds, { date: '2026-10-10', amount: 1000, fromAccountId: ds.accounts[0].id, toAccountId: ds.accounts[1].id, fee: 0 }, ctx);
        // Simulasi kegagalan setelah sebagian change set siap
        return [...ok, { table: 'transactions', op: 'put', row: { id: 'x' } as never }, ...(() => { throw new DomainError('gagal'); })()];
      }, before),
    ).rejects.toThrow('gagal');
    const after = await repo.load();
    expect(after.transactions).toHaveLength(before.transactions.length);
  });

  it('dua tab mengalokasikan dana bersamaan tidak melewati dana tersedia', async () => {
    const name = fresh();
    await seeded(name);
    const tabA = new LocalRepository(name);
    const tabB = new LocalRepository(name);
    const snapshot = await tabA.load();
    const harian = snapshot.pockets.find((p) => p.name === 'Harian')!.id;
    // Keduanya merencanakan dari snapshot yang sama, masing-masing 4 juta dari 6,4975 juta tersedia.
    const plan = (ds: typeof snapshot) => planAllocate(ds, { date: '2026-10-10', fromPocketId: null, toPocketId: harian, amount: 4_000_000 }, ctx);
    const results = await Promise.allSettled([tabA.apply(plan, snapshot), tabB.apply(plan, snapshot)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const final = await tabA.load();
    expect(unallocated(final)).toBe(2_497_500);
    expect(unallocated(final)).toBeGreaterThanOrEqual(0);
  });

  it('ekspor JSON → restore ke database kosong menghasilkan saldo & jumlah sama', async () => {
    const src = await seeded(fresh());
    const data = await src.load();
    const parsed = parseBackup(JSON.stringify(makeBackup(data, 'demo')));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const dst = new LocalRepository(fresh());
    await dst.replaceAll(parsed.ds);
    const restored = await dst.load();
    expect(totalBalance(restored)).toBe(totalBalance(data));
    expect(unallocated(restored)).toBe(unallocated(data));
    expect(restored.auditEvents).toHaveLength(data.auditEvents.length);
  });

  it('database demo terpisah: reset demo tidak menyentuh database lain', async () => {
    const other = await seeded(fresh());
    const demo = await seeded(fresh());
    await demo.clear();
    expect((await demo.load()).transactions).toHaveLength(0);
    expect((await other.load()).transactions).toHaveLength(5);
  });
});
