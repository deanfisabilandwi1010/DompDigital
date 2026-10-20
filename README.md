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
| `npm run setup:nhost` | Memasang schema, trigger, dan permission ke proyek Nhost |
| `npm run assets` | Membuat ulang ilustrasi PNG/WebP dari `Assets/` |

## Setup Nhost (sekali saja)

1. Salin `.env.example` menjadi `.env.local` (sudah dibuat). Isi `NHOST_ADMIN_SECRET` dengan nilai dari dashboard Nhost: **Project Settings → Secrets** (Hasura admin secret).
   `.env.local` sudah masuk `.gitignore`. Admin secret hanya dipakai script di mesin Anda dan tidak pernah dikirim ke browser.
2. Jalankan:
   ```bash
   npm run setup:nhost
   ```
   Script ini idempoten (aman dijalankan ulang). Isinya:
   - membuat tabel, constraint, dan trigger dari [database/schema.sql](database/schema.sql);
   - men-track tabel di Hasura;
   - memberi role `user` permission select/insert/update/delete yang dibatasi `user_id = X-Hasura-User-Id`.
3. Di dashboard Nhost, buka **Authentication** lalu periksa:
   - **Client URL / Allowed redirect URLs** memuat `http://localhost:3000`, juga URL produksi bila sudah di-deploy.
   - **Email verification**: bila diaktifkan, pengguna baru harus mengklik tautan verifikasi sebelum bisa masuk.
4. **Disarankan:** matikan **Public access** Postgres di Database Settings. Aplikasi tidak memakainya, karena semua akses lewat GraphQL dengan JWT. Akses publik langsung ke port 5432 hanya menambah permukaan serangan. Nyalakan lagi sementara bila Anda perlu klien SQL.

## Deploy (GitHub → Vercel)

- Produksi: https://dompetqu-personal.vercel.app. Setiap push ke `master` di GitHub otomatis di-deploy oleh Vercel.
- [vercel.json](vercel.json) mengatur build Vite (`dist/`), cache aset, dan header keamanan. CSP membatasi koneksi hanya ke endpoint Auth & GraphQL Nhost proyek ini.
- Tidak perlu env var di Vercel. Subdomain & region Nhost adalah identitas publik dan punya nilai bawaan di [src/data/config.ts](src/data/config.ts). `VITE_NHOST_*` tetap bisa dipakai untuk menimpanya.
- Tautan verifikasi email & atur ulang kata sandi kembali ke domain tempat pengguna mendaftar (`redirectTo`). Domain itu harus diizinkan di Nhost: **Authentication → Allowed Redirect URLs** memuat `https://dompetqu-personal.vercel.app` dan `http://localhost:3000`.

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
database/schema.sql   schema Postgres + trigger
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

**Belum diverifikasi:** alur catatan pribadi end-to-end terhadap Nhost (login, simpan, trigger alokasi, restore). Pengujian ini menunggu `npm run setup:nhost` dengan admin secret Anda.

## Keterbatasan nyata (versi awal)

- Catatan pribadi memerlukan internet. Belum ada mode offline, PWA, atau service worker.
- Belum ada: impor CSV, lampiran struk, kartu kredit/utang/piutang, split kategori, push notification. Semua ini ditunda sesuai tahap lanjutan di spesifikasi.
- Pengingat dihitung saat aplikasi dibuka. Tidak ada notifikasi saat aplikasi tertutup.
- "Sembunyikan nominal" hanya privasi visual, bukan enkripsi. File backup JSON tidak terenkripsi.
- PDF dibuat lewat dialog cetak browser (stylesheet A4), bukan engine PDF terpisah.
- Deteksi edit basi lintas perangkat (kolom `version` + trigger) menolak penulisan yang bertabrakan dan memuat ulang data. Tidak ada penggabungan otomatis.
