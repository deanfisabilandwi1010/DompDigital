import { useCallback, useEffect, useState } from 'react';
import { buildDemoDataset } from '../domain/demo';
import { nowIso, todayIn } from '../domain/dates';
import type { Dataset } from '../domain/types';
import { auth } from '../data/auth';
import { NHOST } from '../data/config';
import type { LocalRepository } from '../data/localRepository';
import { NhostRepository } from '../data/nhostRepository';
import type { Repository } from '../data/repository';
import { AuthScreen } from '../features/onboarding/AuthScreen';
import { Onboarding } from '../features/onboarding/Onboarding';
import { Welcome } from '../features/onboarding/Welcome';
import { TxUiProvider } from '../features/transactions/TxUi';
import { SessionCtx, type SessionApi } from './session';
import { Shell } from './Shell';
import { DataProvider, errorMessage, useStore, type Mode } from './store';
import { UiProvider } from './ui';

const MODE_KEY = 'kantong.mode';
const readMode = (): Mode | null => {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === 'demo' || m === 'personal' ? m : null;
  } catch {
    return null;
  }
};
const writeMode = (m: Mode | null) => {
  try {
    if (m) localStorage.setItem(MODE_KEY, m);
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* preferensi ringan; abaikan */
  }
};

type Phase =
  | { kind: 'choose' }
  | { kind: 'auth' }
  | { kind: 'loading'; mode: Mode }
  | { kind: 'ready'; mode: Mode; repo: Repository; ds: Dataset; userId: string }
  | { kind: 'error'; mode: Mode; message: string };

// Dexie hanya dimuat saat mode demo dipakai.
let demoRepo: LocalRepository | null = null;
const getDemoRepo = async () => (demoRepo ??= new (await import('../data/localRepository')).LocalRepository('kantong-demo'));

async function seededDemo(repo: LocalRepository, force = false): Promise<Dataset> {
  const ds = await repo.load();
  if (ds.settings.onboardedAt && !force) return ds;
  const seed = buildDemoDataset({ today: todayIn('Asia/Jakarta'), now: nowIso() });
  await repo.replaceAll(seed);
  return repo.load();
}

function Gate() {
  const { ds } = useStore();
  return ds.settings.onboardedAt ? <Shell /> : <Onboarding />;
}

export function App() {
  const [phase, setPhase] = useState<Phase>(() => {
    const m = readMode();
    return m ? { kind: 'loading', mode: m } : { kind: 'choose' };
  });

  const start = useCallback(async (mode: Mode) => {
    writeMode(mode);
    setPhase({ kind: 'loading', mode });
    try {
      if (mode === 'demo') {
        const repo = await getDemoRepo();
        setPhase({ kind: 'ready', mode, repo, ds: await seededDemo(repo), userId: 'demo' });
        return;
      }
      if (!NHOST.configured) throw new Error('Konfigurasi Nhost belum diisi. Lihat README.');
      const user = await auth.init();
      if (!user) return setPhase({ kind: 'auth' });
      const repo = new NhostRepository();
      setPhase({ kind: 'ready', mode, repo, ds: await repo.load(), userId: user.id });
    } catch (e) {
      setPhase({ kind: 'error', mode, message: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    if (phase.kind === 'loading') void start(phase.mode);
    // Hanya saat awal dimuat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Masuk/keluar akun (termasuk dari tab lain).
  useEffect(
    () =>
      auth.onChange((user) => {
        if (readMode() !== 'personal') return;
        if (user) void start('personal');
        else setPhase({ kind: 'auth' });
      }),
    [start],
  );

  const leave = useCallback(() => {
    writeMode(null);
    setPhase({ kind: 'choose' });
  }, []);

  const session: SessionApi | null =
    phase.kind === 'ready'
      ? {
          mode: phase.mode,
          email: auth.user?.email ?? null,
          signOut: async () => {
            await auth.signOut();
            setPhase({ kind: 'auth' });
          },
          leave,
          switchMode: (m) => void start(m),
          resetDemo: async () => {
            const repo = await getDemoRepo();
            const ds = await seededDemo(repo, true);
            setPhase({ kind: 'ready', mode: 'demo', repo, ds, userId: `demo-${Date.now()}` });
          },
        }
      : null;

  let body;
  switch (phase.kind) {
    case 'choose':
      body = <Welcome onPersonal={() => void start('personal')} onDemo={() => void start('demo')} />;
      break;
    case 'auth':
      body = <AuthScreen onBack={leave} />;
      break;
    case 'loading':
      body = (
        <div className="center-screen" role="status">
          <div className="spinner" aria-hidden="true" />
          <p className="mono">Memuat {phase.mode === 'demo' ? 'data demo' : 'catatan'}…</p>
        </div>
      );
      break;
    case 'error':
      body = (
        <main className="welcome">
          <section className="window welcome__card">
            <div className="window__bar window__bar--coral"><span className="window__title">galat.exe</span></div>
            <div className="window__body stack">
              <h1 style={{ fontSize: '1.4rem' }}>Data belum bisa dimuat</h1>
              <p role="alert">{phase.message}</p>
              <div className="row">
                <button className="btn btn--primary" onClick={() => void start(phase.mode)}>Coba lagi</button>
                <button className="btn" onClick={leave}>Kembali</button>
              </div>
            </div>
          </section>
        </main>
      );
      break;
    case 'ready':
      body = (
        <SessionCtx.Provider value={session}>
          <DataProvider key={`${phase.mode}:${phase.userId}`} mode={phase.mode} repo={phase.repo} initial={phase.ds} channelName={`kantong-sync-${phase.mode}-${phase.userId}`}>
            <TxUiProvider>
              <Gate />
            </TxUiProvider>
          </DataProvider>
        </SessionCtx.Provider>
      );
      break;
  }
  return <UiProvider>{body}</UiProvider>;
}
