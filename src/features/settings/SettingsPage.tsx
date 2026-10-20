import { useRef, useState, type FormEvent } from 'react';
import { downloadText } from '../../app/download';
import { useSession } from '../../app/session';
import { errorMessage, useCommit, useStore } from '../../app/store';
import { useUi } from '../../app/ui';
import { Dialog } from '../../components/Dialog';
import { Field, RetroWindow } from '../../components/ui';
import { makeBackup, parseBackup, type BackupPreview } from '../../domain/backup';
import { planArchiveCategory, planSaveCategory, planSettings } from '../../domain/commands';
import { formatDate } from '../../domain/dates';
import { BEHAVIOR_LABEL, CATEGORY_GROUPS, PALETTE, PRIORITY_LABEL } from '../../domain/defaults';
import type { Behavior, Category, CategoryKind, Dataset, Priority } from '../../domain/types';
import { ColorPicker } from '../pockets/PocketsPage';

const ZONES = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'];

export function SettingsPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pengaturan</h1>
          <p className="muted">Profil, kategori, cadangan data, dan privasi.</p>
        </div>
      </div>
      <ProfilePanel />
      <CategoriesPanel />
      <BackupPanel />
      <StoragePanel />
      <DangerPanel />
    </>
  );
}

function ProfilePanel() {
  const { ds } = useStore();
  const { commit, busy } = useCommit();
  const { toast } = useUi();
  const [name, setName] = useState(ds.settings.displayName);
  const [tz, setTz] = useState(ds.settings.timezone);
  const [warn, setWarn] = useState(String(ds.settings.budgetWarnPct));
  const [motion, setMotion] = useState(ds.settings.reducedMotion);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = [...new Set([...ZONES, browserTz, ds.settings.timezone])];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await commit((d) => planSettings(d, { displayName: name, timezone: tz, budgetWarnPct: Number(warn), reducedMotion: motion }), 'Pengaturan disimpan.');
    } catch (x) {
      toast(errorMessage(x), 'error');
    }
  };
  return (
    <RetroWindow title="Profil & tampilan" icon="🙂" tone="sage">
      <form onSubmit={submit} className="stack">
        <div className="form-grid">
          <Field label="Nama panggilan (opsional)" htmlFor="s-name">
            <input id="s-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Zona waktu" htmlFor="s-tz" hint="Menentukan “hari ini” dan periode bulan berjalan.">
            <select id="s-tz" className="select" value={tz} onChange={(e) => setTz(e.target.value)}>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Field>
          <Field label="Peringatan anggaran mulai (%)" htmlFor="s-warn" hint="Label “Mendekati batas” muncul pada persentase ini (50–100).">
            <input id="s-warn" className="input" type="number" min={50} max={100} step={1} value={warn} onChange={(e) => setWarn(e.target.value)} />
          </Field>
          <div className="field">
            <span className="field__label">Gerak</span>
            <label className="checkbox"><input type="checkbox" checked={motion} onChange={(e) => setMotion(e.target.checked)} /> Kurangi animasi (tanpa bounce & confetti)</label>
          </div>
        </div>
        <div className="form-actions"><button className="btn btn--primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></div>
      </form>
    </RetroWindow>
  );
}

function CategoriesPanel() {
  const { ds } = useStore();
  const { act } = useCommit();
  const [form, setForm] = useState<Category | CategoryKind | null>(null);
  const [kind, setKind] = useState<CategoryKind>('expense');
  const list = ds.categories.filter((c) => c.kind === kind);
  const groups = [...new Set(list.map((c) => c.grp))];
  return (
    <RetroWindow title="Kategori" icon="🏷️" tone="butter" actions={<button className="btn" onClick={() => setForm(kind)}>＋ Tambah</button>}>
      <div className="stack">
        <div className="segmented" role="tablist" aria-label="Jenis kategori" style={{ maxWidth: 360 }}>
          <button role="tab" type="button" aria-selected={kind === 'expense'} onClick={() => setKind('expense')}>Pengeluaran</button>
          <button role="tab" type="button" aria-selected={kind === 'income'} onClick={() => setKind('income')}>Pemasukan</button>
        </div>
        <p className="small muted">Kategori yang sudah dipakai hanya bisa diarsipkan agar riwayat tidak hilang.</p>
        {groups.map((g) => (
          <div key={g}>
            <h3 className="mono" style={{ fontSize: '0.85rem', margin: '8px 0' }}>{g}</h3>
            <ul className="list">
              {list.filter((c) => c.grp === g).map((c) => (
                <li key={c.id} className="spread" style={{ padding: '8px 0', opacity: c.archivedAt ? 0.6 : 1 }}>
                  <span>
                    <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, border: '1.5px solid var(--ink)', background: c.color, marginRight: 8 }} />
                    {c.icon} {c.name} {c.archivedAt && <span className="badge">Arsip</span>}
                    {c.kind === 'expense' && (c.defaultPriority || c.defaultBehavior) && (
                      <span className="small muted"> · {[c.defaultPriority && PRIORITY_LABEL[c.defaultPriority], c.defaultBehavior && BEHAVIOR_LABEL[c.defaultBehavior]].filter(Boolean).join(', ')}</span>
                    )}
                  </span>
                  <span className="row">
                    <button className="btn btn--sm" onClick={() => setForm(c)}>Edit</button>
                    <button className="btn btn--sm btn--ghost" onClick={() => act((d, x) => planArchiveCategory(d, c.id, !c.archivedAt, x), c.archivedAt ? 'Kategori aktif kembali.' : 'Kategori diarsipkan.')}>
                      {c.archivedAt ? 'Aktifkan' : 'Arsipkan'}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {form && <CategoryForm initial={typeof form === 'string' ? undefined : form} kind={typeof form === 'string' ? form : form.kind} onClose={() => setForm(null)} />}
    </RetroWindow>
  );
}

function CategoryForm({ initial, kind, onClose }: { initial?: Category; kind: CategoryKind; onClose: () => void }) {
  const { commit, busy } = useCommit();
  const [name, setName] = useState(initial?.name ?? '');
  const [grp, setGrp] = useState(initial?.grp ?? (kind === 'income' ? 'Pemasukan' : 'Kebutuhan'));
  const [icon, setIcon] = useState(initial?.icon ?? '🏷️');
  const [color, setColor] = useState(initial?.color ?? PALETTE.sage);
  const [prio, setPrio] = useState<Priority | ''>(initial?.defaultPriority ?? '');
  const [beh, setBeh] = useState<Behavior | ''>(initial?.defaultBehavior ?? '');
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const ok = await commit((d, c) => planSaveCategory(d, { name, kind, grp, icon, color, defaultPriority: prio || null, defaultBehavior: beh || null }, c, initial?.id), 'Kategori disimpan.');
      if (ok) onClose();
    } catch (x) {
      setErr(errorMessage(x));
    }
  };
  return (
    <Dialog title={initial ? 'Edit kategori' : 'Kategori baru'} icon="🏷️" tone="butter" onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="stack" noValidate>
        {err && <div className="error-summary" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Nama" htmlFor="c-name"><input id="c-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-autofocus /></Field>
          <Field label="Ikon (emoji)" htmlFor="c-icon"><input id="c-icon" className="input" value={icon} maxLength={8} onChange={(e) => setIcon(e.target.value)} /></Field>
          <Field label="Kelompok" htmlFor="c-grp">
            <input id="c-grp" className="input" list="grp-list" value={grp} maxLength={30} onChange={(e) => setGrp(e.target.value)} />
            <datalist id="grp-list">{CATEGORY_GROUPS.map((g) => <option key={g} value={g} />)}</datalist>
          </Field>
          {kind === 'expense' && (
            <>
              <Field label="Prioritas bawaan" htmlFor="c-prio">
                <select id="c-prio" className="select" value={prio} onChange={(e) => setPrio(e.target.value as Priority | '')}>
                  <option value="">Belum ditandai</option><option value="need">Kebutuhan</option><option value="want">Keinginan</option>
                </select>
              </Field>
              <Field label="Sifat bawaan" htmlFor="c-beh">
                <select id="c-beh" className="select" value={beh} onChange={(e) => setBeh(e.target.value as Behavior | '')}>
                  <option value="">Belum ditandai</option><option value="fixed">Tetap</option><option value="variable">Variabel</option>
                </select>
              </Field>
            </>
          )}
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <p className="small muted">Prioritas dan sifat adalah dua hal berbeda: langganan hiburan bisa “tetap” sekaligus “keinginan”. Nilai bawaan dapat diubah per transaksi.</p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function stamp() {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

function BackupPanel() {
  const { ds, mode, run, replaceAll } = useStore();
  const { toast, confirm } = useUi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [restore, setRestore] = useState<{ ds: Dataset; preview: BackupPreview; name: string } | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [working, setWorking] = useState(false);

  const exportJson = async () => {
    downloadText(`kantong-cadangan-${mode === 'demo' ? 'demo-' : ''}${stamp()}.json`, JSON.stringify(makeBackup(ds, mode), null, 2), 'application/json');
    try {
      await run((d, c) => planSettings(d, { lastBackupAt: c.now }), { allowDeficit: true });
    } catch {
      /* cadangan tetap terunduh walau penanda gagal disimpan */
    }
    toast('Cadangan JSON diunduh. Simpan di tempat aman — berisi data sensitif tanpa enkripsi.', 'success');
  };

  const onFile = async (f: File | undefined) => {
    setErrors(null);
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) return setErrors(['Berkas terlalu besar (maks 50 MB).']);
    const r = parseBackup(await f.text());
    if (!r.ok) return setErrors(r.errors);
    setRestore({ ds: r.ds, preview: r.preview, name: f.name });
  };

  const doRestore = async () => {
    if (!restore) return;
    if (restore.preview.mode !== mode) {
      const ok = await confirm({
        title: 'Sumber cadangan berbeda',
        danger: true,
        confirmLabel: 'Ya, tetap pulihkan',
        body: restore.preview.mode === 'demo'
          ? 'Berkas ini adalah cadangan DATA DEMO. Memulihkannya akan MENGGANTI catatan pribadi Anda dengan data demo fiktif.'
          : 'Berkas ini adalah cadangan data pribadi, sedangkan Anda sedang di mode demo.',
      });
      if (!ok) return;
    }
    setWorking(true);
    try {
      // Cadangan kondisi lama dibuat otomatis sebelum penggantian.
      downloadText(`kantong-sebelum-restore-${stamp()}.json`, JSON.stringify(makeBackup(ds, mode), null, 2), 'application/json');
      await replaceAll(restore.ds);
      toast('Data berhasil dipulihkan. Cadangan kondisi sebelumnya sudah diunduh.', 'success');
      setRestore(null);
    } catch (x) {
      toast(`Restore gagal; data lama tidak diubah. ${errorMessage(x)}`, 'error');
    } finally {
      setWorking(false);
    }
  };

  return (
    <RetroWindow title="Cadangan & pemulihan" icon="💾" tone="blue">
      <div className="stack">
        <p>
          Cadangan terakhir: <strong>{ds.settings.lastBackupAt ? formatDate(ds.settings.lastBackupAt.slice(0, 10)) : 'belum pernah'}</strong>.
          Cadangan JSON berisi seluruh tabel, record yang dibatalkan, dan riwayat audit.
        </p>
        <p className="callout callout--warn small">⚠ Berkas cadangan adalah <strong>data sensitif tanpa enkripsi</strong>. Jangan bagikan atau unggah ke tempat publik.</p>
        <div className="row">
          <button className="btn btn--primary" onClick={exportJson}>⬇ Unduh cadangan JSON</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Pulihkan dari berkas…</button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Pilih berkas cadangan" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {errors && (
          <div className="error-summary" role="alert">
            Berkas tidak dapat dipulihkan. Data saat ini tidak diubah.
            <ul>{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        )}
      </div>
      {restore && (
        <Dialog title="Pratinjau pemulihan" icon="⬆" tone="coral" onClose={() => setRestore(null)} busy={working} description="Pemulihan MENGGANTI seluruh data aktif (bukan menggabungkan). Cadangan kondisi saat ini akan diunduh otomatis lebih dulu.">
          <div className="stack">
            <dl className="kv">
              <dt>Berkas</dt><dd>{restore.name}</dd>
              <dt>Diekspor</dt><dd>{restore.preview.exportedAt ? new Date(restore.preview.exportedAt).toLocaleString('id-ID') : '—'}</dd>
              <dt>Sumber</dt><dd>{restore.preview.mode === 'demo' ? 'DATA DEMO' : 'Data pribadi'} · schema v{restore.preview.schemaVersion}</dd>
              <dt>Rentang transaksi</dt><dd>{restore.preview.firstDate ? `${formatDate(restore.preview.firstDate)} – ${formatDate(restore.preview.lastDate!)}` : 'tidak ada transaksi'}</dd>
              <dt>Rekening / kategori / kantong</dt><dd>{restore.preview.counts.accounts} / {restore.preview.counts.categories} / {restore.preview.counts.pockets}</dd>
              <dt>Transaksi / alokasi</dt><dd>{restore.preview.counts.transactions} / {restore.preview.counts.allocations}</dd>
              <dt>Anggaran / tujuan / pengingat</dt><dd>{restore.preview.counts.budgets} / {restore.preview.counts.goals} / {restore.preview.counts.reminders}</dd>
              <dt>Riwayat audit</dt><dd>{restore.preview.counts.auditEvents}</dd>
            </dl>
            <div className="form-actions">
              <button className="btn" onClick={() => setRestore(null)} disabled={working}>Batal</button>
              <button className="btn btn--danger" onClick={doRestore} disabled={working}>{working ? 'Memulihkan…' : 'Ganti data dengan cadangan ini'}</button>
            </div>
          </div>
        </Dialog>
      )}
    </RetroWindow>
  );
}

function StoragePanel() {
  const { mode } = useStore();
  const session = useSession();
  const { toast } = useUi();
  const [persist, setPersist] = useState<string | null>(null);
  const requestPersist = async () => {
    if (!navigator.storage?.persist) return setPersist('Browser ini tidak mendukung permintaan penyimpanan persisten.');
    const granted = await navigator.storage.persist();
    setPersist(granted ? 'Diizinkan: browser akan berusaha tidak menghapus data demo otomatis (bukan jaminan mutlak).' : 'Ditolak browser. Data demo tetap tersimpan, tetapi dapat dibersihkan saat ruang penyimpanan menipis.');
  };
  return (
    <RetroWindow title="Penyimpanan & privasi" icon="🔐" tone="paper">
      <div className="stack small">
        {mode === 'personal' ? (
          <>
            <p>Catatan pribadi disimpan di database Postgres proyek Nhost Anda dan hanya dapat dibaca akun yang masuk ({session.email}). Akses dibatasi per pengguna oleh aturan permission di server.</p>
            <p>Aplikasi memerlukan koneksi internet untuk membaca & menyimpan. Belum ada mode offline.</p>
            <div className="row"><button className="btn" onClick={() => void session.signOut().then(() => toast('Anda sudah keluar.', 'info'))}>Keluar dari akun</button></div>
          </>
        ) : (
          <>
            <p>Data demo hanya ada di IndexedDB browser ini, terpisah dari catatan pribadi. Membersihkan data browser, mode incognito, atau ganti perangkat membuat data demo hilang.</p>
            <div className="row"><button className="btn" onClick={requestPersist}>Minta penyimpanan persisten</button></div>
            {persist && <p role="status">{persist}</p>}
          </>
        )}
        <p>“Sembunyikan nominal” (ikon mata) adalah privasi visual saja — bukan enkripsi. Tidak ada analytics atau pelacak pihak ketiga.</p>
      </div>
    </RetroWindow>
  );
}

function DangerPanel() {
  const { mode, clearAll } = useStore();
  const session = useSession();
  const { toast } = useUi();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const word = 'HAPUS';
  return (
    <RetroWindow title="Zona berbahaya" icon="⚠️" tone="coral">
      <div className="stack">
        {mode === 'demo' ? (
          <>
            <p className="small">Reset hanya menyentuh database demo di browser ini. Catatan pribadi tidak terpengaruh.</p>
            <div><button className="btn" onClick={() => void session.resetDemo()}>↺ Reset data demo</button></div>
          </>
        ) : (
          <>
            <p className="small">Menghapus <strong>seluruh</strong> catatan pribadi di server: rekening, transaksi, kantong, anggaran, tujuan, pengingat, dan riwayat audit. Tindakan ini tidak dapat dibatalkan. Unduh cadangan dulu.</p>
            <div><button className="btn btn--danger" onClick={() => setOpen(true)}>Hapus seluruh data pribadi…</button></div>
          </>
        )}
      </div>
      {open && (
        <Dialog title="Hapus seluruh data pribadi" icon="⚠️" tone="coral" role="alertdialog" onClose={() => setOpen(false)} busy={working}>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (typed !== word) return;
              setWorking(true);
              try {
                await clearAll();
                toast('Seluruh data pribadi dihapus.', 'info');
                setOpen(false);
              } catch (x) {
                toast(errorMessage(x), 'error');
              } finally {
                setWorking(false);
              }
            }}
          >
            <p>Semua data akan dihapus permanen dari database. Ketik <strong className="mono">{word}</strong> untuk mengonfirmasi.</p>
            <Field label={`Ketik ${word}`} htmlFor="del-confirm">
              <input id="del-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-autofocus />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setOpen(false)} disabled={working}>Batal</button>
              <button className="btn btn--danger" disabled={typed !== word || working}>{working ? 'Menghapus…' : 'Hapus permanen'}</button>
            </div>
          </form>
        </Dialog>
      )}
    </RetroWindow>
  );
}
