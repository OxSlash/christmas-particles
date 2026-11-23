# Merry Christmas — Interactive Particle Art

Partikel 3D yang berubah bentuk mengikuti jumlah jari tangan di depan webcam.
Terinspirasi dari reel interaktif `@2_lazzzy`, dibangun ulang dari nol dengan
React + TypeScript + Three.js + MediaPipe.

## Gestur → bentuk

Jumlah jari menentukan bentuknya — tidak ada pola jari khusus yang perlu dihafal.

| Gestur | Bentuk |
| --- | --- |
| ✊ mengepal (0 jari) | Sinterklas + kereta + tulisan "Merry Christmas" |
| ☝️ 1 jari | Manusia salju (topi, syal, hidung wortel, tangan ranting) |
| ✌️ 2 jari | Pohon Natal (bintang emas, ornamen, batang) |
| 🤟 3 jari | Rusa kutub |
| 🖖 4 jari | Kado berpita emas |
| 🖐️ 5 jari | Kepingan salju enam cabang |

Jari apa pun yang diangkat dihitung: satu jari telunjuk, satu jari tengah, atau
jempol semuanya menghasilkan "1". Ini membuat pemakaiannya terasa alami — cukup
menahan sejumlah jari, bukan membentuk gestur tertentu.

Tampilannya sengaja tanpa panel: hanya partikel di atas latar gelap. Kamera
menyala otomatis saat halaman dibuka. Tanpa kamera tetap bisa dipakai lewat
tombol `0`–`5`, dan `Spasi` memicu efek ledakan.

**Latensi.** Gestur tampil dalam **~5–15 ms** setelah terdeteksi (terukur di
aplikasi). Ini mungkin karena jalurnya bebas timer dan bebas React: mesin gestur
dipanggil langsung di dalam frame deteksi, menulis ke satu ref, dan render loop
membacanya di frame berikutnya. Versi sebelumnya memakai interval 25 ms + hold
110 ms + state React, sehingga terasa ~130 ms.

**Waktu tuntas.** Bentuk menjadi **tajam penuh dalam ~0.8 detik**, bukan blur
berkepanjangan. Versi sebelumnya memakai lerp eksponensial yang secara matematis
tidak pernah sampai — pada 99% masih ada sisa jarak yang terlihat sebagai blur,
jadi bentuk "hampir jadi" selama lebih dari 1,5 detik. Sekarang transisinya
berbasis waktu dengan easing, sehingga setiap partikel mendarat **tepat** di
targetnya pada waktu yang pasti.

**Selalu hidup.** Setelah bentuk selesai, setiap formasi punya animasi idle
sendiri yang sesuai karakternya, jadi menahan satu gestur lama tidak pernah
terasa seperti gambar statis:

| Formasi | Animasi saat diam |
| --- | --- |
| Snowman | Bergoyang pelan dan mengangguk, seperti punya berat |
| Pohon Natal | Berputar pelan, jadi lapisan kerucutnya terbaca sebagai 3D |
| Rusa | Berjingkrak di tempat seperti berlari, badan naik-turun |
| Kado | Terangkat dan miring, seperti disodorkan |
| Kepingan salju | Berputar dan miring keluar bidang, jadi terlihat "dikelilingi" |
| Sinterklas | Kereta berkeliling layar dengan jalur elips dan banking |

Animasi ini memudar masuk hanya setelah morph selesai, dan memudar keluar saat
gestur berikutnya datang — jadi tidak pernah bertabrakan dengan transisi.

## Menjalankan

```bash
npm install
npm run dev      # http://localhost:5173
```

`predev` otomatis menyalin wasm MediaPipe ke `public/` dan mengunduh model
`hand_landmarker.task` (~7.5 MB) bila belum ada.

```bash
npm run build    # tsc + vite build → dist/
npm run preview  # cek hasil build
```

Kamera butuh `localhost` atau HTTPS (batasan browser). Kalau izin ditolak,
aplikasi tetap jalan dengan kontrol keyboard.

## Deploy (Vercel)

Aplikasi ini statis sepenuhnya — tidak ada server, API, atau database — jadi
cukup impor repo ke Vercel dan selesai.

| Setelan | Nilai |
| --- | --- |
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variable | tidak ada yang dibutuhkan |

`vercel.json` sudah mengunci ketiganya, jadi tidak perlu diisi manual. Biarkan
install command default (`npm install`) — jangan pakai `--omit=dev`, karena
`typescript` dan `vite` ada di `devDependencies` dan dibutuhkan saat build.

**Aset MediaPipe tidak di-commit.** `public/mediapipe` (wasm ~28 MB + model
~7.5 MB) ada di `.gitignore`. `prebuild` membuatnya ulang di mesin build: wasm
disalin dari `node_modules`, model diunduh dari Google Storage. Kalau unduhan
gagal, build **gagal** — bukan lolos diam-diam — sehingga tidak mungkin
men-deploy aplikasi yang kamera-nya mati. Tambahan waktu build sekitar 5 detik.

**Kamera.** Vercel menyajikan lewat HTTPS, syarat browser untuk `getUserMedia`,
jadi kamera langsung aktif tanpa konfigurasi tambahan.

**Cache.** `vercel.json` memberi header `immutable` untuk `/mediapipe/*`, jadi
22 MB aset itu tidak divalidasi ulang di setiap kunjungan.

## Cara kerjanya

```
webcam ─► MediaPipe HandLandmarker (21 titik)
        └► hitung jari ─► smoother 3 frame ─► konfirmasi 2 deteksi ─► ref
                                                                       │
                    generator bentuk ─► targetPositions ───────────────┤
                                                                       ▼
                    setiap frame: posisi = origin + (target − origin) × ease(t/durasi)
                                                                       ▼
                          shader: noise + depth-of-field + kilau + bloom
```

- **110.000 partikel**, semua digerakkan di GPU untuk gambar, tapi posisinya
  dihitung di CPU setiap frame. Tiap partikel menyimpan empat hal: posisi
  sekarang, target, titik asal, dan durasi tween-nya sendiri.
- **Tween berbasis waktu, bukan lerp eksponensial.** Posisi adalah fungsi murni
  dari progress, jadi setiap partikel mendarat **tepat** di targetnya. Lerp
  eksponensial tidak pernah sampai, sehingga bentuk tetap blur. Karena posisi
  sekarang tidak pernah di-reset, gestur yang berubah di tengah transisi cukup
  memulai tween baru dari titik mana pun — tanpa lompatan.
- **Durasi per partikel berbeda** (jitter dari seed), jadi awan larut dan
  menyusun diri, bukan bergeser sebagai satu blok kaku.
- **Turbulensi mengikuti sisa jarak.** `uSwell` dihitung dari rata-rata jarak
  yang masih harus ditempuh, jadi pusaran noise kuat saat transisi dan tenang
  setelah bentuk mendarat.
- **Gerak idle.** Setelah tween selesai (`uIdle = 1`), shader menambahkan
  gelombang naik-turun, denyut, dan goyangan lembut. Di atas itu, tiap formasi
  punya animasi transform sendiri (lihat tabel di atas) yang dihitung di
  `idleMotion.ts` dan diterapkan ke grup partikel.
- **Tiga lapisan suasana** yang bergerak mandiri, supaya layar tidak pernah
  kosong: `Aurora` (gradasi teal/plum/emas yang melayang pelan di latar),
  `Snowfall` (salju turun), dan `Embers` (percikan hangat naik seperti bara).
- **Material dibuat eksplisit** (`new THREE.ShaderMaterial`), bukan lewat
  `<shaderMaterial uniforms={...}>`. R3F menyalin objek uniforms di JSX, jadi
  semua nilai yang ditulis dari `useFrame` tidak pernah sampai ke shader. Ini
  dijaga oleh `check-transition.mjs`.
- **Klasifikasi jari = hitung jari.** Setiap jari yang terangkat dihitung, lalu
  totalnya dipetakan ke bentuk. Tidak ada pola gestur yang perlu dihafal. Jari
  panjang memakai perbandingan jarak ujung jari vs sendi PIP terhadap pergelangan
  tangan (tahan rotasi & skala); jempol memakai tiga sinyal yang divoting
  (lipatan, jarak ke knuckle telunjuk, kelurusan sendi IP) karena satu rasio saja
  tidak cukup membedakan jempol terbuka dari jempol yang dilipat di telapak.
- **Debounce tanpa timer.** Mesin gestur dipanggil sekali per frame deteksi dan
  butuh 2 pembacaan berturut-turut untuk commit. Satu frame nyasar tidak pernah
  commit (butuh pengulangan), tapi perubahan nyata langsung terasa.
- **Toleransi tracking drop.** MediaPipe kehilangan tangan selama 1–2 frame
  setiap kali tangan berubah bentuk cepat (membuka kepal, merentangkan jari).
  Gestur yang belum commit diberi tenggang 220 ms sebelum dibuang, jadi dropout
  sesaat tidak memaksa hitungan konfirmasi mulai dari nol — ini yang membuat
  0/4/5 jari sempat terasa "tidak terdeteksi". Ambang confidence MediaPipe juga
  diturunkan ke 0.4 untuk alasan yang sama. Tidak ada
  `setInterval`, tidak ada hold berbasis waktu.
- **Gestur melewati React.** Formasi hasil gestur ditulis ke ref dan dibaca
  render loop tiap frame, jadi tidak ada render ulang React di jalur respons.
  Keyboard menulis ke ref yang sama, sehingga gestur dan tombol tidak bisa
  saling menimpa.
- **Semua formasi punya jumlah partikel identik** (110.000, dijamin `padTo`),
  sehingga tidak ada partikel yang hilang atau menumpuk di titik asal saat
  berpindah bentuk.
- **Bentuk di-fit otomatis** ke tinggi layar yang konsisten, jadi tiap formasi
  tampil dengan skala yang seragam. Debu di sekitar bentuk tidak ikut dihitung
  saat fitting, supaya skala tidak mengecil karena partikel yang berserakan.
- **Ukuran mengikuti viewport.** Skala dihitung per frame dari frustum kamera,
  jadi layar potret (HP) tidak memotong bentuk seperti di layar lebar.

## Struktur

```
src/
  App.tsx                     komposisi scene + HUD + input
  particles/
    ParticleField.tsx         tween per partikel, cache formasi, gerak idle
    idleMotion.ts             animasi idle per formasi
    Aurora.tsx                gradasi warna melayang di latar
    Snowfall.tsx              salju atmosfer di belakang bentuk
    Embers.tsx                percikan hangat yang naik
    shaders.ts                vertex (noise, DOF, idle, kilau) + fragment (glow)
  hands/
    gestures.ts               landmark → status jari → jumlah jari
    gestureMachine.ts         debounce tanpa timer + peta gestur→formasi
    useHandTracker.ts         kamera + loop MediaPipe + commit gestur
    connections.ts            garis kerangka tangan
  formations/
    index.ts                  daftar formasi + ukuran fit
    snowman.ts tree.ts reindeer.ts gift.ts snowflake.ts santa.ts
    common.ts                 palet, padding, debu
  lib/
    formations/shapes.ts      primitif (bola, kerucut, torus, kotak, bintang)
    formations/text.ts        sampling teks via canvas
    color.ts rng.ts
scripts/
  setup-assets.mjs            salin wasm + unduh model
  check-formations.ts         validasi 6 bentuk (jumlah, NaN, bounds)
  check-gestures.ts           hitung jari (termasuk rotasi & skala)
  check-gesture-robustness.ts 120 percobaan noise + rotasi per gestur
  check-real-gestures.ts      tangan realistis: jempol bersandar, kelingking
                              setengah terlipat, dropout tracking
  check-state.ts              mesin gestur (konfirmasi, mapping, recovery)
  check-latency.ts            latensi commit (unit, dalam jumlah frame)
  check-app-latency.mjs       latensi end-to-end di aplikasi nyata
  check-input.mjs             gestur vs keyboard tidak saling menimpa
  check-regressions.ts        regresi bug hasil review
  check-transition.mjs        transisi gradual, tanpa reset, turbulence mereda
  check-settle.mjs            waktu tuntas ke bentuk tajam + idle aktif
  check-idle-motion.mjs       gerak & kecerahan saat idle (diukur dari piksel)
  check-idle-animations.mjs   tiap formasi punya animasi idle yang berbeda
  check-morph.mjs             uji morph di browser sungguhan
  check-camera.mjs            kamera auto-start (fake device)
  check-camera-lifecycle.mjs  start/stop/restart/release kamera
  check-camera-stress.mjs     stop saat loading + siklus start/stop cepat
  check-lifecycle.mjs         boot overlay + tidak ada UI + kamera auto-start
  check-prod.mjs              hasil build produksi
  check-responsive.mjs        mobile / tablet / desktop + resize
  shoot.mjs                   screenshot semua formasi
```

## Pemeriksaan

```bash
# tanpa browser
npx tsx scripts/check-formations.ts
npx tsx scripts/check-gestures.ts
npx tsx scripts/check-gesture-robustness.ts
npx tsx scripts/check-real-gestures.ts
npx tsx scripts/check-state.ts
npx tsx scripts/check-latency.ts
npx tsx scripts/check-regressions.ts

# butuh `npm run dev` (port 5173)
node scripts/check-transition.mjs
node scripts/check-morph.mjs
node scripts/check-app-latency.mjs
node scripts/check-settle.mjs
node scripts/check-idle-motion.mjs
node scripts/check-idle-animations.mjs
node scripts/check-input.mjs
node scripts/check-camera.mjs
node scripts/check-camera-lifecycle.mjs
node scripts/check-camera-stress.mjs
node scripts/shoot.mjs

# beri jeda ~5 detik antar skrip kamera: dua tes yang berjalan berurutan
# berebut device webcam yang sama dan bisa gagal karena itu, bukan karena bug

# butuh `npm run build` + `npm run preview` (port 4173)
node scripts/check-prod.mjs
node scripts/check-lifecycle.mjs
node scripts/check-responsive.mjs
```
