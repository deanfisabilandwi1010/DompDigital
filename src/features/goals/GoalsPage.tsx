import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { errorMessage, useCommit, useStore } from '../../app/store';
import { useUi } from '../../app/ui';
import { Dialog } from '../../components/Dialog';
import { Amount, AmountInput, amountToInput, EmptyState, Field, Illustration, Meter, RetroWindow } from '../../components/ui';
import { planDeleteGoal, planGoalCelebrated, planSaveGoal } from '../../domain/commands';
import { formatDate } from '../../domain/dates';
import { PALETTE } from '../../domain/defaults';
import { goalStatus, pocketBalances } from '../../domain/ledger';
import { parseAmountInput } from '../../domain/money';
import type { Goal } from '../../domain/types';
import { AllocateForm, ColorPicker } from '../pockets/PocketsPage';

export function GoalsPage() {
  const { ds, today, fmt, run } = useStore();
  const { act } = useCommit();
  const { confirm } = useUi();
  const [form, setForm] = useState<Goal | 'new' | null>(null);
  const [alloc, setAlloc] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(false);
  const items = useMemo(() => ds.goals.map((g) => ({ g, s: goalStatus(ds, g.id, today)! })), [ds, today]);
  const celebrating = useRef(false);

  // Confetti sekali per tujuan tercapai; dicatat agar tidak muncul lagi setiap refresh.
  useEffect(() => {
    const fresh = items.find((i) => i.s.reached && !i.g.celebrationShownAt);
    if (!fresh || celebrating.current) return;
    celebrating.current = true;
    setConfetti(true);
    const t = window.setTimeout(() => setConfetti(false), 1600);
    void run((d, c) => planGoalCelebrated(d, fresh.g.id, c), { allowDeficit: true }).catch(() => undefined).finally(() => (celebrating.current = false));
    return () => window.clearTimeout(t);
  }, [items, run]);

  return (
    <>
      <div className="page-head">
        <div className="hero-strip">
          <Illustration name="jar" size={96} />
          <div>
            <h1>Tujuan tabungan</h1>
            <p className="muted">Setiap tujuan mengamati satu kantong khusus. Progres = saldo kantong itu; tidak ada saldo tujuan terpisah.</p>
          </div>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={() => setForm('new')}>＋ Tujuan baru</button>
        </div>
      </div>

      {items.length === 0 ? (
        <RetroWindow title="Tujuan" icon="🌱" tone="lilac">
          <EmptyState art="jar" title="Belum ada tujuan" action={<button className="btn btn--primary" onClick={() => setForm('new')}>Buat tujuan</button>}>
            Misalnya laptop baru, dana darurat 3 bulan, atau liburan akhir tahun.
          </EmptyState>
        </RetroWindow>
      ) : (
        <div className="grid grid--2">
          {items.map(({ g, s }) => {
            const pocket = ds.pockets.find((p) => p.id === g.pocketId);
            return (
              <RetroWindow key={g.id} title={g.name} icon={g.icon} tone="lilac" actions={<button className="btn btn--icon" aria-label={`Edit ${g.name}`} onClick={() => setForm(g)}>✏️</button>}>
                <div className="stack">
                  <div className="spread">
                    <span className="money-card__value"><Amount value={s.saved} colored /></span>
                    {s.reached ? <span className="badge badge--income">Tercapai 🎉</span> : s.overdue ? <span className="badge badge--over">Lewat tenggat</span> : <span className="badge">{s.pct}%</span>}
                  </div>
                  <Meter pct={s.barPct} tone="lilac" label={`Progres ${g.name}: ${s.pct}%`} />
                  <dl className="kv small">
                    <dt>Target</dt><dd>{fmt(g.targetAmount)}</dd>
                    <dt>Kekurangan</dt><dd>{fmt(s.remaining)}</dd>
                    <dt>Kantong</dt><dd>{pocket?.icon} {pocket?.name}{pocket?.archivedAt ? ' (arsip)' : ''}</dd>
                    <dt>Tenggat</dt><dd>{g.deadline ? formatDate(g.deadline) : 'Tidak ada'}</dd>
                    {s.perMonth != null && !s.reached && (
                      <><dt>Perlu dialokasikan</dt><dd>±{fmt(s.perMonth)}/bulan selama {s.monthsLeft} bulan</dd></>
                    )}
                  </dl>
                  {s.perMonth != null && !s.reached && <p className="small muted">Estimasi: kekurangan dibagi jumlah bulan kalender tersisa (termasuk bulan ini dan bulan tenggat), dibulatkan ke atas. Bukan jaminan atau saran investasi.</p>}
                  {s.overdue && <p className="small muted">Tenggat sudah lewat. Ubah tenggat atau lanjutkan alokasi sesuai kemampuan.</p>}
                  <div className="row">
                    <button className="btn btn--sm btn--butter" onClick={() => setAlloc(g.pocketId)} disabled={!!pocket?.archivedAt}>Alokasikan dana</button>
                    <button className="btn btn--sm btn--ghost" onClick={async () => {
                      if (await confirm({ title: `Hapus tujuan ${g.name}?`, body: `Tujuan dihapus, tetapi kantong ${pocket?.name} dan saldonya tetap ada.`, confirmLabel: 'Hapus tujuan', danger: true })) {
                        await act((d, c) => planDeleteGoal(d, g.id, c), 'Tujuan dihapus. Kantong tetap tersimpan.');
                      }
                    }}>Hapus</button>
                  </div>
                </div>
              </RetroWindow>
            );
          })}
        </div>
      )}

      {form && <GoalForm goal={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
      {alloc && <AllocateForm initial={{ from: null, to: alloc }} onClose={() => setAlloc(null)} />}
      {confetti && <Confetti />}
    </>
  );
}

function Confetti() {
  const colors = [PALETTE.butter, PALETTE.sage, PALETTE.coral, PALETTE.blue, PALETTE.lilac];
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, background: colors[i % colors.length], animationDelay: `${(i % 9) * 60}ms` }} />
      ))}
    </div>
  );
}

function GoalForm({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const { ds, fmt } = useStore();
  const { commit, busy } = useCommit();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(amountToInput(goal?.targetAmount));
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [icon, setIcon] = useState(goal?.icon ?? '🎯');
  const [color, setColor] = useState(goal?.color ?? PALETTE.lilac);
  const [pocketId, setPocketId] = useState(goal?.pocketId ?? 'new');
  const [newPocket, setNewPocket] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const bal = pocketBalances(ds);
  const usable = ds.pockets.filter((p) => !p.archivedAt && (!ds.goals.some((g) => g.pocketId === p.id) || p.id === goal?.pocketId));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = parseAmountInput(target);
    if (!amt.ok) return setErr(`Target: ${amt.error}`);
    try {
      const ok = await commit(
        (d, c) => planSaveGoal(d, { name, targetAmount: amt.value, deadline: deadline || null, icon, color, pocketId: pocketId === 'new' ? null : pocketId, newPocketName: newPocket }, c, goal?.id),
        goal ? 'Tujuan diperbarui.' : 'Tujuan dibuat.',
      );
      if (ok) onClose();
    } catch (x) {
      setErr(errorMessage(x));
    }
  };
  return (
    <Dialog title={goal ? 'Edit tujuan' : 'Tujuan baru'} icon="🌱" tone="lilac" onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="stack" noValidate>
        {err && <div className="error-summary" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Nama tujuan" htmlFor="g-name" className="span-2">
            <input id="g-name" className="input" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} data-autofocus placeholder="mis. Laptop baru" />
          </Field>
          <Field label="Target" htmlFor="g-target" className="span-2">
            <AmountInput id="g-target" value={target} onChange={setTarget} />
          </Field>
          <Field label="Tenggat (opsional)" htmlFor="g-deadline">
            <input id="g-deadline" type="date" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
          <Field label="Ikon (emoji)" htmlFor="g-icon">
            <input id="g-icon" className="input" value={icon} maxLength={8} onChange={(e) => setIcon(e.target.value)} />
          </Field>
          <Field label="Kantong khusus" htmlFor="g-pocket" className="span-2" hint="Satu tujuan terhubung ke satu kantong; progres dibaca dari saldo kantong.">
            <select id="g-pocket" className="select" value={pocketId} onChange={(e) => setPocketId(e.target.value)}>
              <option value="new">＋ Buat kantong baru</option>
              {usable.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name} · {fmt(bal.get(p.id) ?? 0)}</option>)}
            </select>
          </Field>
          {pocketId === 'new' && (
            <Field label="Nama kantong baru" htmlFor="g-newp" className="span-2" hint="Kosongkan untuk memakai nama tujuan.">
              <input id="g-newp" className="input" value={newPocket} maxLength={40} onChange={(e) => setNewPocket(e.target.value)} />
            </Field>
          )}
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </Dialog>
  );
}
