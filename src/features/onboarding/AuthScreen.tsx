import { useState, type FormEvent } from 'react';
import { Field, Illustration } from '../../components/ui';
import { auth } from '../../data/auth';

export function AuthScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setInfo(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Masukkan email yang valid.');
    if (password.length < 9 && tab === 'up') return setError('Kata sandi minimal 9 karakter.');
    setBusy(true);
    try {
      if (tab === 'in') {
        await auth.signIn(email.trim(), password);
      } else {
        const user = await auth.signUp(email.trim(), password, name.trim());
        if (!user) {
          setInfo('Akun dibuat. Buka email verifikasi dari Nhost, klik tautannya, lalu kembali ke sini untuk masuk.');
          setTab('in');
        }
      }
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Isi email Anda dulu, lalu tekan “Lupa kata sandi”.');
    try {
      await auth.resetPassword(email.trim());
      setInfo('Jika email terdaftar, tautan atur ulang kata sandi sudah dikirim.');
    } catch (x) {
      setError((x as Error).message);
    }
  };

  return (
    <main className="welcome">
      <section className="window welcome__card" aria-labelledby="auth-title">
        <div className="window__bar window__bar--sage">
          <span className="window__dots" aria-hidden="true"><span /><span /></span>
          <span className="window__title">masuk.exe</span>
        </div>
        <div className="window__body stack">
          <div className="hero-strip">
            <Illustration name="mascot" size={84} />
            <div>
              <h1 id="auth-title" style={{ fontSize: '1.5rem' }}>{tab === 'in' ? 'Masuk ke Kantong' : 'Buat akun Kantong'}</h1>
              <p className="muted small">Akun diperlukan agar catatan pribadi di database hanya bisa dibaca oleh Anda.</p>
            </div>
          </div>
          <div className="segmented" role="tablist" aria-label="Masuk atau daftar">
            <button role="tab" type="button" aria-selected={tab === 'in'} onClick={() => { setTab('in'); setError(null); }}>Masuk</button>
            <button role="tab" type="button" aria-selected={tab === 'up'} onClick={() => { setTab('up'); setError(null); }}>Daftar</button>
          </div>
          {error && <div className="error-summary" role="alert">{error}</div>}
          {info && <div className="callout" role="status">{info}</div>}
          <form onSubmit={submit} className="stack" noValidate>
            {tab === 'up' && (
              <Field label="Nama panggilan (opsional)" htmlFor="au-name">
                <input id="au-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
              </Field>
            )}
            <Field label="Email" htmlFor="au-email">
              <input id="au-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" data-autofocus autoFocus />
            </Field>
            <Field label="Kata sandi" htmlFor="au-pass" hint={tab === 'up' ? 'Minimal 9 karakter.' : undefined}>
              <input id="au-pass" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'in' ? 'current-password' : 'new-password'} />
            </Field>
            <button className="btn btn--primary btn--block" disabled={busy}>{busy ? 'Memproses…' : tab === 'in' ? 'Masuk' : 'Daftar'}</button>
          </form>
          <div className="spread small">
            <button className="link-btn" onClick={onBack}>← Kembali</button>
            {tab === 'in' && <button className="link-btn" onClick={reset}>Lupa kata sandi?</button>}
          </div>
        </div>
      </section>
    </main>
  );
}
