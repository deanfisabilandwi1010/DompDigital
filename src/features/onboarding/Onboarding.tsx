import { useState } from 'react';
import { errorMessage, useCommit, useStore } from '../../app/store';
import { AmountInput, Field, Illustration } from '../../components/ui';
import { planOnboarding } from '../../domain/commands';
import { ACCOUNT_TYPE_ICON, ACCOUNT_TYPE_LABEL, POCKET_SUGGESTIONS } from '../../domain/defaults';
import { parseAmountInput } from '../../domain/money';
import type { AccountType } from '../../domain/types';

interface AccDraft {
  key: number;
  name: string;
  type: AccountType;
  opening: string;
  date: string;
}

const ZONES = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'];

/** Onboarding tiga langkah: profil → rekening & saldo awal → kantong (opsional). */
export function Onboarding() {
  const { today, ds } = useStore();
  const { commit, busy } = useCommit();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(ds.settings.displayName);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [tz, setTz] = useState(ZONES.includes(browserTz) ? browserTz : 'Asia/Jakarta');
  const [accounts, setAccounts] = useState<AccDraft[]>([
    { key: 1, name: 'Bank utama', type: 'bank', opening: '', date: today },
    { key: 2, name: 'Uang tunai', type: 'cash', opening: '', date: today },
  ]);
  const [pockets, setPockets] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const update = (key: number, patch: Partial<AccDraft>) => setAccounts((a) => a.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const validateAccounts = (): string | null => {
    if (accounts.length === 0) return 'Tambahkan minimal satu rekening.';
    for (const a of accounts) {
      if (!a.name.trim()) return 'Setiap rekening perlu nama.';
      const r = parseAmountInput(a.opening || '0', { allowZero: true });
      if (!r.ok) return `${a.name}: ${r.error}`;
      if (a.date > today) return `${a.name}: tanggal pembukaan tidak boleh di masa depan.`;
    }
    return null;
  };

  const finish = async (withPockets: boolean) => {
    setError(null);
    try {
      await commit((d, c) =>
        planOnboarding(d, {
          displayName: name,
          timezone: tz,
          accounts: accounts.map((a) => ({ name: a.name, type: a.type, openingBalance: (parseAmountInput(a.opening || '0', { allowZero: true }) as { value: number }).value, openingDate: a.date })),
          pockets: withPockets ? POCKET_SUGGESTIONS.filter((p) => pockets.includes(p.name)) : [],
        }, c),
      'Siap! Catatan Anda sudah dibuat.');
    } catch (x) {
      setError(errorMessage(x));
    }
  };

  return (
    <main className="welcome">
      <section className="window welcome__card" style={{ width: 'min(640px, 100%)' }} aria-labelledby="ob-title">
        <div className="window__bar window__bar--butter">
          <span className="window__dots" aria-hidden="true"><span /><span /></span>
          <span className="window__title">persiapan · langkah {step + 1} dari 3</span>
        </div>
        <div className="window__body stack" style={{ gap: 16 }}>
          <div className="steps" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className={i <= step ? 'on' : ''} />)}</div>
          {error && <div className="error-summary" role="alert">{error}</div>}

          {step === 0 && (
            <>
              <div className="hero-strip">
                <Illustration name="mascot" size={96} />
                <div>
                  <h1 id="ob-title" style={{ fontSize: '1.6rem' }}>Kenalan dulu</h1>
                  <p className="muted small">Semua isian bisa diubah nanti di Pengaturan.</p>
                </div>
              </div>
              <Field label="Nama panggilan (opsional)" htmlFor="ob-name">
                <input id="ob-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
              </Field>
              <Field label="Zona waktu" htmlFor="ob-tz" hint="Dipakai untuk menentukan tanggal hari ini dan periode bulan berjalan.">
                <select id="ob-tz" className="select" value={tz} onChange={(e) => setTz(e.target.value)}>
                  {[...new Set([...ZONES, browserTz])].map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </Field>
              <div className="form-actions"><button className="btn btn--primary" onClick={() => setStep(1)}>Lanjut →</button></div>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <h1 id="ob-title" style={{ fontSize: '1.6rem' }}>Rekening & saldo awal</h1>
                <p className="muted small">Saldo awal adalah posisi pembukaan, bukan pemasukan. Kosongkan bila belum tahu — semua angka mulai dari nol.</p>
              </div>
              {accounts.map((a, i) => (
                <fieldset key={a.key} className="callout" style={{ margin: 0 }}>
                  <legend className="mono">Rekening {i + 1}</legend>
                  <div className="form-grid">
                    <Field label="Nama" htmlFor={`ob-an-${a.key}`}>
                      <input id={`ob-an-${a.key}`} className="input" value={a.name} maxLength={60} onChange={(e) => update(a.key, { name: e.target.value })} />
                    </Field>
                    <Field label="Jenis" htmlFor={`ob-at-${a.key}`}>
                      <select id={`ob-at-${a.key}`} className="select" value={a.type} onChange={(e) => update(a.key, { type: e.target.value as AccountType })}>
                        {(['bank', 'cash', 'ewallet'] as const).map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_ICON[t]} {ACCOUNT_TYPE_LABEL[t]}</option>)}
                      </select>
                    </Field>
                    <Field label="Saldo awal" htmlFor={`ob-ao-${a.key}`}>
                      <AmountInput id={`ob-ao-${a.key}`} value={a.opening} onChange={(v) => update(a.key, { opening: v })} />
                    </Field>
                    <Field label="Per tanggal" htmlFor={`ob-ad-${a.key}`}>
                      <input id={`ob-ad-${a.key}`} type="date" className="input" value={a.date} max={today} onChange={(e) => update(a.key, { date: e.target.value })} />
                    </Field>
                  </div>
                  {accounts.length > 1 && <button type="button" className="btn btn--sm btn--ghost" style={{ marginTop: 8 }} onClick={() => setAccounts((x) => x.filter((y) => y.key !== a.key))}>Hapus rekening ini</button>}
                </fieldset>
              ))}
              <button type="button" className="btn" onClick={() => setAccounts((a) => [...a, { key: Date.now(), name: '', type: 'ewallet', opening: '', date: today }])}>＋ Tambah rekening</button>
              <div className="form-actions">
                <button className="btn" onClick={() => setStep(0)}>← Kembali</button>
                <button className="btn btn--primary" onClick={() => { const e = validateAccounts(); setError(e); if (!e) setStep(2); }}>Lanjut →</button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <h1 id="ob-title" style={{ fontSize: '1.6rem' }}>Kantong awal (opsional)</h1>
                <p className="muted small">Kantong adalah amplop virtual untuk membagi uang. Tidak ada persentase yang dipaksakan — alokasikan dana kapan saja nanti.</p>
              </div>
              <div className="chips" role="group" aria-label="Pilih kantong">
                {POCKET_SUGGESTIONS.map((p) => (
                  <button key={p.name} type="button" className="chip chip--toggle" aria-pressed={pockets.includes(p.name)} onClick={() => setPockets((x) => (x.includes(p.name) ? x.filter((y) => y !== p.name) : [...x, p.name]))}>
                    {p.icon} {p.name}
                  </button>
                ))}
              </div>
              <div className="form-actions">
                <button className="btn" onClick={() => setStep(1)} disabled={busy}>← Kembali</button>
                <button className="btn" onClick={() => finish(false)} disabled={busy}>Lewati</button>
                <button className="btn btn--primary" onClick={() => finish(true)} disabled={busy}>{busy ? 'Menyimpan…' : 'Selesai'}</button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
