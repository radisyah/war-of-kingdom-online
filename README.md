# War of Kingdoms — Online (2 pemain) untuk Vercel

Versi online dari *Positive vs Negative: War of Kingdoms*. Dua pemain di dua perangkat berbeda
bermain 30 ronde lewat kode ruangan. Server yang menghitung hasil, jadi pilihan kartu lawan
**tidak pernah dikirim ke perangkatmu** sebelum kedua pemain mengunci.

## Cara kerja

```
Browser A ─┐                         ┌─ Upstash Redis (state room, tanda hadir, kunci)
           ├─ polling ~1 dtk ─ /api/room (Vercel Function) ─┤
Browser B ─┘                         └─ public/game-core.js (aturan, dipakai server & klien)
```

- **Vercel Functions tidak punya koneksi WebSocket tahan lama**, jadi klien melakukan *polling* ringan
  (`GET /api/room?v=<versi>`; bila tidak ada perubahan server membalas sangat kecil). Latensi sekitar 1 detik.
- State room disimpan di **Upstash Redis** (wajib di produksi: tiap request bisa dijalankan instance berbeda).
- Pembuat ruangan = Kerajaan Positif (Pemain 1), yang gabung dengan kode = Kerajaan Negatif (Pemain 2).
- Pembuat ruangan menentukan: peluang buff, pasukan awal, dan timer.

## Deploy ke Vercel

1. Taruh folder ini di repositori GitHub/GitLab/Bitbucket, lalu **Add New → Project** di Vercel dan impor repositorinya
   (preset "Other", tanpa build command). Atau dari terminal: `npm i -g vercel && vercel`.
2. Di dashboard proyek buka **Storage** (atau **Marketplace**) → tambahkan **Upstash Redis** → hubungkan ke proyek ini.
   Integrasi otomatis mengisi `KV_REST_API_URL` + `KV_REST_API_TOKEN` (atau `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`).
   Kode mendukung kedua pasang nama itu.
3. **Deploy ulang** (Deployments → ⋯ → Redeploy). Variabel lingkungan baru hanya berlaku untuk deployment baru.
4. Buka URL proyek, buat ruangan, kirim kode (atau tombol *Salin Tautan*) ke lawanmu.

Bila Redis belum terhubung, API membalas pesan jelas: *"Database belum dikonfigurasi…"*.

## Menjalankan lokal

```bash
node dev-server.js        # http://localhost:3000  (penyimpanan memori, hanya untuk pengembangan)
```

Untuk mencoba dengan dua pemain, buka dua jendela (atau satu jendela biasa dan satu jendela samaran).

## Tes

```bash
npm test                  # 16 tes API (aturan, kebocoran pilihan, balapan kunci serentak, timer, rematch, dst.)
                          # dijalankan lewat memori DAN lewat jalur Redis REST (server tiruan format Upstash)
python3 test/e2e.py       # 2 browser Chromium memainkan 30 ronde penuh (butuh: pip install playwright && playwright install chromium)
python3 test/e2e-timer.py # tes timer: kartu dipilihkan otomatis setelah batas waktu
```

## Perilaku yang berbeda dari versi satu perangkat

| Hal | Versi online |
|---|---|
| Timer | Bila diaktifkan, kartu yang belum dikunci **dipilihkan acak oleh server** setelah batas + 6 detik (versi offline hanya menambah tekanan). Timer 0 = tanpa batas. |
| Ronde berikutnya | Butuh kedua pemain menekan *Ronde Berikutnya*; lanjut otomatis 30 detik setelah satu pemain siap. |
| Rematch | Butuh persetujuan kedua pemain. Sisi tidak ditukar. |
| Terputus | Muat ulang halaman: sesi (token di `localStorage`) otomatis kembali ke ruangan. Lawan melihat indikator *terputus*. |
| Keluar | Lawan diberi tahu dan ruangan ditutup. Bila keluar di layar hasil akhir, lawan tetap bisa melihat hasilnya. |

## Catatan biaya & batasan

- Satu pertandingan ±20 menit memakai kira-kira **8.000–9.000 perintah Redis** (±4 perintah per polling, 2 pemain, tab tersembunyi
  melambat ke 4 detik). Cocokkan dengan batas paket Upstash-mu.
- Tidak ada akun/login. Siapa pun yang tahu kode 5 karakter dan ruangan belum penuh bisa bergabung; token pemain disimpan di
  perangkat masing-masing. Untuk trafik publik yang besar, tambahkan pembatasan laju (mis. Vercel Firewall).
- Ruangan kedaluwarsa 6 jam setelah aktivitas terakhir.
- Bila ingin respons instan (tanpa jeda polling), tahap berikutnya adalah layanan realtime (Ably, Pusher, PartyKit, Supabase Realtime)
  sebagai pengganti polling; logika server di `api/room.js` bisa dipertahankan.
