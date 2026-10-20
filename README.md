# Kantong — Retro Money Club

> Uang tertata, hidup lebih lega.

Kantong adalah aplikasi web untuk mencatat keuangan pribadi, bergaya desktop retro. Isinya: rekening, transaksi, kantong virtual, anggaran, tujuan tabungan, pengingat, laporan, ekspor CSV, backup/restore JSON, dan mode demo.

- **Catatan pribadi** disimpan di **Nhost** (Postgres + Hasura GraphQL), dengan login email/kata sandi. Setiap pengguna hanya dapat membaca datanya sendiri.
- **Mode demo** memakai **IndexedDB (Dexie)** di browser. Database-nya terpisah total dari catatan pribadi.

Spesifikasi lengkap ada di [Prompt/Kantong_Digital_Retro_Master_Prompt.md](Prompt/Kantong_Digital_Retro_Master_Prompt.md). Keputusan desain dan penyimpangan dari spesifikasi dicatat di [docs/KEPUTUSAN.md](docs/KEPUTUSAN.md).

## Menjalankan

Prasyarat: Node 20.19+ atau 22.12+ (diuji dengan Node 26).

```bash
npm install
npm run dev          # http://localhost:3000
```

Mode demo langsung bisa dipakai. Catatan pribadi baru bisa dipakai setelah **setup Nhost** di bawah selesai.

| Script | Fungsi |
|---|---|
| `npm run dev` | Server pengembangan (port 3000, sesuai Client URL bawaan Nhost) |
| `npm run build` | Typecheck + build produksi ke `dist/` |
| `npm run typecheck` | Hanya typecheck |
| `npm test` | Tes domain + integrasi repository (Vitest) |
| `npm run setup:nhost` | Bootstrap manual schema, trigger, dan permission ke Nhost (cadangan jalur Git) |
| `npm run assets` | Membuat ulang ilustrasi PNG/WebP dari `Assets/` |

## Alur deploy: satu pintu lewat GitHub

```text
push ke master (GitHub: deanfisabilandwi1010/DompDigital)
 ├─► Vercel  → build Vite → https://dompetqu-personal.vercel.app
 └─► Nhost   → nhost/migrations + nhost/metadata + nhost/nhost.toml → database, Hasura, Auth
```

### Vercel (frontend)

- Setiap push ke `master` otomatis di-deploy.
- [vercel.json](vercel.json) mengatur build Vite (`dist/`), cache aset, dan header keamanan. CSP hanya mengizinkan koneksi ke endpoint Auth & GraphQL Nhost proyek ini.
- Tidak perlu env var di Vercel. Subdomain & region Nhost adalah identitas publik dan punya nilai bawaan di [src/data/config.ts](src/data/config.ts). `VITE_NHOST_*` tetap bisa dipakai untuk menimpanya.

### Nhost (backend)

Folder [nhost/](nhost/) berformat Nhost CLI:

| Path | Isi |
|---|---|
| `nhost/nhost.toml` | Konfigurasi proyek: Auth, Hasura, Postgres. Termasuk Allowed Redirect URLs Vercel + localhost. |
| `nhost/migrations/default/…_kantong_init/up.sql` | Schema Kantong: tabel, constraint, trigger versi, trigger dana alokasi |
| `nhost/metadata/` | Metadata Hasura **lengkap**: tabel auth/storage bawaan Nhost + 12 tabel Kantong beserta permission role `user` |
| `nhost/config.yaml` | Konfigurasi Hasura CLI (tanpa rahasia) |

Setelah repo disambungkan ke Nhost (**Settings → Git → Connect repository**, branch `master`, base directory kosong/root), setiap push menerapkan migrasi, metadata, dan konfigurasi tersebut.

- **Mengubah schema:** tambahkan folder migrasi baru (`nhost/migrations/default/<timestamp>_<nama>/up.sql` + `down.sql`). Jangan mengedit migrasi yang sudah diterapkan.
- **Mengubah tracking/permission:** edit `nhost/metadata/`. Metadata diterapkan sebagai *pengganti penuh*, jadi jangan menghapus file tabel auth/storage.
- **Pengaturan di dashboard** (mis. redirect URL) akan ditimpa `nhost.toml` pada deploy berikutnya. Ubahlah lewat file ini.

### Bootstrap manual (cadangan)

`npm run setup:nhost` menerapkan migrasi & permission langsung ke proyek tanpa lewat Git. Script membutuhkan `NHOST_ADMIN_SECRET` di `.env.local`. File itu masuk `.gitignore`, dan secret tidak pernah dikirim ke browser. Script ini idempoten. Proyek saat ini **sudah** di-bootstrap: migrasi `kantong_init` tercatat sebagai terapan, sehingga deploy Git tidak menjalankannya ulang.

**Disarankan:** matikan `enablePublicAccess` (Postgres) di `nhost.toml`. Aplikasi tidak memakainya, karena semua akses lewat GraphQL + JWT.

## Struktur

```text
src/
  domain/    model, uang (integer), tanggal, ledger (aggregator tunggal), planner perintah,
             pengingat, insight, CSV, backup/validasi, fixture demo — tanpa React
  data/      auth Nhost, repository Nhost (GraphQL) & lokal (Dexie)
  app/       App/sesi, store (run → commit atomik), router hash, UI (toast/konfirmasi), Shell
  features/  dashboard, transaksi, rekening, kantong, anggaran, tujuan, laporan, pengingat,
             pengaturan, onboarding
  components/ RetroWindow, MoneyCard, AmountInput, Dialog, grafik SVG + tabel alternatif, dll.
  styles/    token & komponen (global.css), print A4 (print.css)
  tests/     fixture acceptance, domain, integrasi IndexedDB
nhost/             proyek Nhost: nhost.toml, migrasi, metadata Hasura
public/assets/retro ilustrasi (PNG + WebP, dari Assets/)
```

Alur tulis: halaman memanggil **planner** murni (`domain/commands.ts`). Planner memvalidasi input lalu menghasilkan *change set*. Store memeriksa defisit dan meminta konfirmasi bila perlu. Lalu **repository** menulis seluruh change set secara atomik:

- **Nhost**: satu request mutation GraphQL = satu transaksi Postgres.
- **Dexie**: satu transaksi `rw`. Planner dijalankan ulang terhadap data segar di dalam transaksi itu.

Saldo tidak pernah disimpan. Semua angka dihitung dari record sumber oleh `domain/ledger.ts`.

## Verifikasi yang sudah dijalankan

- `npm run typecheck` dan `npm run build`: lolos.
- `npm test`: **36 tes lolos**. Cakupannya:
  - 8 langkah fixture acceptance (§17) dengan angka persis;
  - transfer + biaya atomik, edit/void/pulihkan;
  - refund berlebih ditolak, refund lintas bulan;
  - tanggal sebelum pembukaan/masa depan ditolak;
  - akhir bulan dan tahun kabisat;
  - pengingat tanggal 31, tanpa pencatatan ganda;
  - anggaran nol/lebih/negatif tanpa NaN/Infinity;
  - populasi filter = total = baris CSV;
  - sanitasi formula CSV;
  - backup → restore dengan saldo sama;
  - JSON rusak / schema lebih baru / referensi yatim ditolak;
  - kegagalan di tengah commit tidak menulis apa pun;
  - dua tab mengalokasikan dana bersamaan: hanya satu yang berhasil;
  - reset demo tidak menyentuh database lain.
- Uji browser nyata (Edge headless, mode demo):
  - Lebar 390, 768, dan 1440 px: tanpa scroll horizontal dan tanpa error konsol.
  - Alur yang dicoba:
    - catat transaksi (toast hanya setelah commit, saldo ter-update);
    - klik ganda Simpan hanya menghasilkan 1 transaksi;
    - konfirmasi defisit, lalu defisit tampil apa adanya;
    - pembatalan via drawer;
    - "Catat sekarang" dari pengingat;
    - Escape menutup dialog dan fokus kembali ke pemicu;
    - privasi menyamarkan semua nominal;
    - refresh mempertahankan data.

- Uji end-to-end terhadap **Nhost asli** dengan pengguna uji sementara, yang sudah dihapus setelah selesai:
  - login, onboarding, dan catat transaksi; data bertahan setelah reload;
  - dua sesi mengalokasikan dana bersamaan: trigger server menolak satu dengan pesan "Dana tersedia hanya …";
  - edit basi dari sesi lain ditolak (konflik versi) lalu data dimuat ulang;
  - backup → ubah data → restore: saldo & alokasi historis pulih;
  - hapus seluruh data kembali ke onboarding.

## Keterbatasan nyata (versi awal)

- Catatan pribadi memerlukan internet. Belum ada mode offline, PWA, atau service worker.
- Belum ada: impor CSV, lampiran struk, kartu kredit/utang/piutang, split kategori, push notification. Semua ini ditunda sesuai tahap lanjutan di spesifikasi.
- Pengingat dihitung saat aplikasi dibuka. Tidak ada notifikasi saat aplikasi tertutup.
- "Sembunyikan nominal" hanya privasi visual, bukan enkripsi. File backup JSON tidak terenkripsi.
- PDF dibuat lewat dialog cetak browser (stylesheet A4), bukan engine PDF terpisah.
- Deteksi edit basi lintas perangkat (kolom `version` + trigger) menolak penulisan yang bertabrakan dan memuat ulang data. Tidak ada penggabungan otomatis.
