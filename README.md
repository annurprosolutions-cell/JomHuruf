# JomHuruf

JomHuruf ialah versi dalam talian permainan "Nama, Benda, Binatang". Semua pemain main serentak dari telefon masing-masing, dengan karakter 3D (enjin karakter dan rangkaian yang sama dengan [Karooot](https://github.com/annurprosolutions-cell/Karoot)) dan papan markah langsung.

## Cara main

1. Seorang pemain tekan **Buka bilik baru**, pilih bahasa jawapan (Bahasa Melayu atau English), pilih **5 kolum** daripada 14 kategori, panjang permainan (10 / 15 / 26 huruf) dan masa menjawab (60 / 90 / 120 saat).
2. Hos reka karakter dahulu, kemudian kongsi PIN, QR atau pautan. Kawan-kawan masuk dan reka karakter masing-masing.
3. Hos tekan **Mula**.
4. Setiap pusingan, seorang pemain (ikut giliran masuk) pilih satu huruf. Huruf yang sudah dipilih jadi kelabu dan tidak boleh dipilih lagi. Kalau tak pilih dalam 15 saat, sistem pilih secara rawak.
5. Semua pemain isi kelima-lima kolum bermula dengan huruf itu, kemudian tekan **Hantar**. Bila orang pertama hantar, yang lain hanya ada 15 saat lagi (boleh dimatikan dalam tetapan).
6. Jawapan disemak automatik dan markah dipaparkan. Selepas huruf terakhir: podium 3D, ranking penuh dan sorotan (paling laju, paling banyak betul, rentetan terpanjang).

Hos juga bermain. Peranti hos menjadi "pelayan" bilik, jadi **jangan tutup tab atau kunci skrin hos** sehingga permainan tamat. Kalau tab hos ter-refresh, buka semula **Buka bilik baru** dan tekan **Sambung**: PIN dan markah dipulihkan, telefon pemain bersambung semula sendiri, dan pusingan yang tergendala diulang.

## Markah

Untuk setiap pusingan:

| Komponen | Mata |
| --- | --- |
| Setiap kolum betul | 100 |
| Bonus kelajuan (setiap kolum betul) | sehingga 100, ikut berapa cepat baris dihantar |
| Semua kolum aktif betul (sempurna) | +200 |
| Rentetan pusingan sempurna berturut-turut | +100 (ke-2), +200 (ke-3) ... maksimum +500 |

Jawapan sama dengan pemain lain tidak ditolak. Jika masa tamat, apa yang sudah ditaip dihantar automatik tanpa bonus kelajuan.

## Kategori dan semakan jawapan

| Jenis | Kategori | Cara semak |
| --- | --- | --- |
| Bebas | Nama, Benda | Huruf pertama betul, panjang minimum, bukan merapu (contoh "Bbbbb"), bukan kata kesat, tidak sama dengan kolum lain dalam baris yang sama |
| Senarai | Binatang, Buah/Sayur, Negara, Makanan & Minuman, Pekerjaan, Bandar/Negeri, Warna, Sukan, Kenderaan, Anggota Badan, Pakaian, Bunga & Pokok | Mesti ada dalam senarai perkataan bahasa yang dipilih |

Semakan senarai bertolak ansur:

- Huruf besar/kecil, sempang dan ruang diabaikan (`rama-rama` = `rama rama`).
- Salah eja kecil diterima (1 huruf untuk perkataan 4-6 huruf, 2 huruf untuk 7 huruf ke atas). Contoh: "Kuching" diterima sebagai "kucing".
- Jamak English diterima (`grapes` = `grape`).
- Perkataan "kepala" boleh diikuti apa-apa jenis, contoh `ikan bilis`, `nasi kerabu`, `tukang sapu`.

Bila host pilih kolum, sistem kira berapa kolum ada jawapan untuk setiap huruf. Di grid pilih huruf, angka kecil (contoh `2/5` untuk X) tunjuk berapa kolum aktif. Kolum tanpa sebarang perkataan untuk huruf itu dilumpuhkan automatik untuk pusingan tersebut.

### Tambah perkataan

Senarai ada dalam `js/words/`:

- `ms.js`: Bahasa Melayu
- `en.js`: English
- `shared.js`: bandar dan negeri (ejaan sama dalam kedua-dua bahasa)

Tambah perkataan dipisahkan koma dalam kategori yang betul. Senarai ini dibina daripada pengetahuan umum, jadi sila semak dan tambah perkataan yang selalu ditolak semasa bermain. Fail CSV keputusan (butang **Muat turun CSV** di hujung permainan) mengandungi semua jawapan setiap pusingan, berguna untuk cari perkataan yang patut ditambah.

## Statistik penggunaan

Laman utama papar tiga kaunter: paparan, orang dah main, dan permainan dimainkan. Caranya sama dengan Karooot: setiap kejadian ialah satu "+1" ke servis kaunter awam percuma **Abacus** (`abacus.jasoncameron.dev`), namespace `jomhuruf-ruzprompt`. Tiada nama, PIN atau jawapan dihantar. Jika servis gagal, kaunter disembunyikan dan permainan tidak terjejas.

- Lihat nombor mentah: `https://abacus.jasoncameron.dev/get/jomhuruf-ruzprompt/views` (ganti `views` dengan `users` atau `games`).
- Elak kiraan sendiri: buka sekali `?nocount=1` pada pelayar anda (`?nocount=0` untuk hidupkan semula). Localhost tidak dikira.

## Di mana data disimpan

Tiada pangkalan data dan tiada akaun.

| Data | Lokasi |
| --- | --- |
| Permainan semasa (pemain, markah, jawapan) | Memori tab hos |
| Salinan untuk sambung semula | `localStorage` hos (`jh.hostSession`), dipadam bila permainan tamat |
| Tetapan bilik terakhir | `localStorage` hos (`jh.hostSettings`) |
| Sejarah 20 permainan terakhir | `localStorage` hos (`jh.history`) |
| Nama & karakter pemain | `localStorage` telefon pemain (`jh.profile`) |

Telefon pemain bersambung terus ke peranti hos melalui **WebRTC (peer-to-peer)** menggunakan PeerJS. Pelayan awam percuma **PeerJS Cloud** hanya digunakan untuk memperkenalkan dua pelayar semasa mula bersambung.

## Had & tip

- Maksimum 50 pemain sebilik.
- Perlu internet. WiFi sekolah/pejabat yang ketat kadang-kadang menyekat WebRTC: guna data telefon jika tak dapat masuk.
- Hos yang guna telefon: skrin dijaga supaya tidak tidur (Wake Lock), tetapi jangan tukar ke app lain terlalu lama. Pelayar telefon boleh hentikan tab di latar belakang dan bilik akan terputus untuk semua orang.
- PeerJS Cloud ialah servis percuma tanpa jaminan. Untuk kegunaan serius, jalankan pelayan PeerJS sendiri dan tambah `?peer=host:port` pada pautan.
- Grafik 3D perlukan WebGL2. Peranti lama tetap boleh main; karakter dipaparkan sebagai ikon huruf.

## Deploy

Laman statik, tiada langkah build. Boleh hos di Netlify (seret folder repo) atau GitHub Pages (**Settings → Pages → Deploy from a branch → main / root**).

## Struktur fail

```
index.html            semua skrin
css/base.css          gaya asas (butang, kad, pencipta karakter) diwarisi daripada Karooot
css/game.css          gaya JomHuruf (telefon dahulu)
js/app.js             titik masuk & penghala
js/host.js            tetapan bilik & enjin permainan (giliran, huruf, markah, sambung semula)
js/player.js          aliran pemain (lobi, pilih huruf, jawab, keputusan, akhir), termasuk hos
js/validate.js        semakan jawapan automatik
js/categories.js      bank 14 kategori
js/words/             senarai perkataan (ms, en, shared)
js/net.js             PeerJS (hos & klien) + LocalLink untuk pemain di peranti hos
js/avatar3d.js        karakter 3D (Three.js) - daripada Karooot
js/stage3d.js         pentas lobi, podium, potret - daripada Karooot
js/avatar-config.js   pilihan karakter - daripada Karooot
js/creator.js         panel reka karakter - daripada Karooot
js/ui.js              pembantu DOM, bunyi, konfeti, QR
js/stats.js           kaunter paparan / pemain / permainan (Abacus)
vendor/               Three.js, PeerJS, qrcode-generator (lesen MIT)
```

## Ujian tempatan

```
python3 -m http.server 8080        # dari folder repo
npx peer --port 9000               # pelayan PeerJS tempatan (pilihan)
# buka http://localhost:8080/?hos=1&peer=localhost:9000
```

By RuzPrompt Copyright 2026
