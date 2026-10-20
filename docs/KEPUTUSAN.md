# Keputusan & interpretasi

Catatan singkat tentang cara spesifikasi ditafsirkan, beserta bagian yang sengaja menyimpang.

## Penyimpanan: Nhost untuk data pribadi (menyimpang dari §12)

Spesifikasi meminta Dexie/IndexedDB sebagai sumber data. Pemilik proyek meminta database di Nhost, jadi:

- **Catatan pribadi → Nhost Postgres via Hasura GraphQL.** Karena database ada di internet, login (Nhost Auth email/kata sandi) **wajib**. Tanpa login, siapa pun yang tahu endpoint bisa membaca data. Permission Hasura membatasi setiap baris ke `user_id` pemiliknya. FK komposit `(user_id, id)` mencegah relasi menunjuk ke data pengguna lain.
- **Mode demo → Dexie/IndexedDB** (`kantong-demo`), sesuai spesifikasi. Database ini terpisah dari data pribadi dan diberi banner "DATA DEMO".
- Abstraksi `Repository` membuat UI dan domain tidak tahu lokasi data. Mengganti atau menambah penyimpanan tidak mengubah rumus.

Hal yang dijaga sesuai spesifikasi:

- **Atomik.** Satu mutation Hasura berisi banyak root field berjalan dalam satu transaksi Postgres. FK dibuat `DEFERRABLE INITIALLY DEFERRED`, sehingga restore (hapus semua + sisip ulang) bisa berjalan dalam satu commit.
- **Race dua tab.** Alokasi baru diperiksa trigger `kantong_check_allocation`. Trigger ini mengambil `pg_advisory_xact_lock` per pengguna, lalu menghitung dana tersedia dari record sumber. Di Dexie, planner dijalankan ulang di dalam transaksi `rw`.
- **Edit basi.** Setiap record yang bisa diubah punya `version`. Trigger menolak update yang tidak bernilai `version lama + 1`. Klien lalu memuat ulang data dan meminta pengguna mencoba lagi.

## Model uang

- Rekening adalah tempat uang dicatat. Kantong adalah amplop virtual **di atas** saldo total. Rumusnya: `belum dialokasikan = total − Σ kantong`. Kantong arsip tetap ikut dihitung.
- Saldo pembukaan dan penyesuaian rekonsiliasi **bukan** pemasukan. Keduanya tampil terpisah di laporan.
- Transfer adalah satu transaksi dengan dua efek. Biaya transfer dicatat sebagai transaksi expense terpisah dengan `groupId` yang sama, kategori "Biaya administrasi", dan tanpa kantong.
- Refund mewarisi kategori, kantong, prioritas, dan sifat dari transaksi asal, lalu dihitung pada **tanggal refund**.
- Bila biaya transfer dihapus saat edit, transaksi biaya itu dibatalkan dan **dilepas dari grup**. Dengan begitu, memulihkan transfer tidak ikut menghidupkan biaya yang sudah dihapus.
- Defisit boleh terjadi untuk pengeluaran aktual setelah konfirmasi, dan angkanya tidak pernah dipaksa nol. Alokasi baru tetap ditolak bila dana tidak cukup.

## Definisi yang dipilih

- **Bulan tersisa pada tujuan** = jumlah bulan kalender dari bulan ini sampai bulan tenggat, termasuk keduanya. Hasil pembagiannya dibulatkan ke atas.
- **Pembanding insight:**
  - "Bulan ini" dibandingkan dengan tanggal setara di bulan sebelumnya.
  - "Bulan lalu" dibandingkan dengan bulan penuh sebelumnya.
  - Rentang lain dibandingkan dengan rentang sama panjang tepat sebelumnya.
- **Granularitas grafik:** harian sampai 31 hari, mingguan sampai 26 minggu, bulanan di atas itu. Granularitas bisa diganti manual di Laporan.
- **Pengingat terlewat:** dicari dalam jendela 90 hari ke belakang.

## Visual

- Distribusi kategori memakai **batang horizontal**, bukan donut. Batang tetap terbaca di kolom 1/3, dan nilai negatif dari refund lintas periode tergambar alami ke kiri sumbu nol (batang divergen). Donut tidak dipakai sama sekali, jadi nilai negatif tidak pernah masuk donut.
- Warna seri grafik divalidasi agar terbedakan untuk buta warna dan kontrasnya cukup di atas latar krem: pemasukan `#156B40`, pengeluaran `#D87863`. Warna `#365B47` dari palet terlalu pucat (kroma rendah) untuk mark data, jadi tetap dipakai hanya untuk tombol dan navigasi.
- Ilustrasi dipetakan ke nama tujuan di `public/assets/retro/` (PNG 512 px + WebP). File sumber di `Assets/` tidak diubah.

## Asumsi yang belum diketahui

- Pengaturan Auth Nhost (verifikasi email, panjang minimal kata sandi, redirect URL) mengikuti default proyek. Pesan error dari server ditampilkan apa adanya bila kodenya tidak dikenal.
- Rekening baru dibatasi saldo pembukaan ≥ 0 (kas/bank/e-wallet). Rekening overdraft belum didukung.
