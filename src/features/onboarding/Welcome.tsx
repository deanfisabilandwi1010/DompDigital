import { Illustration } from '../../components/ui';
import { NHOST } from '../../data/config';

export function Welcome({ onPersonal, onDemo }: { onPersonal: () => void; onDemo: () => void }) {
  return (
    <main className="welcome">
      <section className="window welcome__card" aria-labelledby="welcome-title">
        <div className="window__bar window__bar--butter">
          <span className="window__dots" aria-hidden="true"><span /><span /></span>
          <span className="window__title">kantong.exe</span>
        </div>
        <div className="window__body stack" style={{ gap: 18, textAlign: 'center', padding: '22px 22px 26px' }}>
          <Illustration name="mascot" size={150} className="welcome__mascot wave" />
          <div className="stack" style={{ gap: 6 }}>
            <h1 id="welcome-title">Selamat datang di Kantong</h1>
            <p className="muted">Uang tertata, hidup lebih lega.</p>
          </div>
          <div className="stack">
            <button className="btn btn--primary btn--block" onClick={onPersonal} disabled={!NHOST.configured} data-autofocus>
              Mulai catatan pribadi
            </button>
            <button className="btn btn--butter btn--block" onClick={onDemo}>Coba data demo</button>
          </div>
          <div className="callout small" style={{ textAlign: 'left' }}>
            <p><strong>Catatan pribadi</strong> disimpan di akun Anda (database Nhost) dan memerlukan login. Buat cadangan JSON secara berkala dari Pengaturan.</p>
            <p style={{ marginTop: 6 }}><strong>Data demo</strong> sepenuhnya fiktif, disimpan di browser ini saja, dan terpisah dari catatan pribadi.</p>
            {!NHOST.configured && <p className="neg" style={{ marginTop: 6 }}>Konfigurasi Nhost belum diisi (VITE_NHOST_SUBDOMAIN/REGION). Lihat README.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}
