<p align="center"><a href="../README.md">
  <img src="../docs/assets/logo.svg" alt="tokenharbor-bulk-creator" width="150">
</a></p>

<p align="center"><img src="../docs/assets/banner.svg" alt="tokenharbor-bulk-creator banner"></p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node"></a>
  <a href="https://playwright.dev/"><img src="https://img.shields.io/badge/playwright-%E2%9C%94-2EAD33?style=for-the-badge&logo=playwright&logoColor=white" alt="Playwright"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-22e6a5?style=for-the-badge" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/tests-9%20passed-39d0ff?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Tests">
</p>

# Token Harbor Bulk Account Creator

> Membuat banyak akun Token Harbor secara massal dengan inbox sekali pakai dan otomatis menghasilkan API key dengan nama acak.

<p><a href="../README.md">English</a> · <strong>Indonesia</strong> · <a href="README.zh.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a></p>

---

`tokenharbor-bulk-creator` menyatukan tiga hal dalam satu alur yang dapat direproduksi:
penyedia email sekali pakai ([temp-email.dev](https://www.temp-email.dev)), browser asli yang
menjalankan pendaftaran dan verifikasi email Token Harbor seperti manusia, serta alur
pembuatan API key di dasbor Token Harbor. Beri jumlah, dan alat ini mengembalikan tabel
JSON berisi key `thk_live_…` yang siap pakai.

> Alat ini ditujukan untuk otomasi yang sah, pengujian internal, dan riset pada akun
> milik Anda sendiri. Anda bertanggung jawab mematuhi ketentuan layanan Token Harbor
> dan hukum yang berlaku.

---

## Mengapa memakai browser?

Token Harbor ([tokenharbor.ai](https://tokenharbor.ai)) adalah aplikasi Next.js yang
pendaftarannya berjalan lewat API HTTPS-nya sendiri (`/api/auth/signup-precheck`) lalu
menyimpan cookie sesi. Verifikasi email berupa **tautan yang diklik**, dan API key dibuat
dari dasbor yang sudah terautentikasi. Tidak ada REST API publik resmi untuk mendaftar
atau membuat key, jadi pendekatan yang andal adalah menggerakkan UI asli dengan
[Playwright](https://playwright.dev).

## Fitur

- **Inbox sekali pakai** – membuat inbox temp-email.dev unik per akun.
- **Onboarding lengkap** – daftar → verifikasi email → API key, ujung ke ujung.
- **Identitas acak** – email, kata sandi (12+ karakter), dan label key acak.
- **API key otomatis** – dinamai seperti `prod-token-7421`, berawalan `thk_live_`.
- **Sadar rate limit** – mendeteksi throttle "take a breath" milik Token Harbor.
- **Output bertahap** – file JSON ditulis ulang setiap akun selesai.
- **Konkurensi** – worker paralel opsional.
- **Retry** – percobaan ulang per akun dengan identitas baru.
- **Inbox yang dapat diganti** – `temp-email-dev` atau REST temp-mail `custom`.
- **Logging terstruktur** – output konsol berwarna dan bertimestamp.

## Arsitektur

```
src/
├── index.mjs             # titik masuk CLI (flag, browser, worker pool)
├── core/provision.mjs    # alur ujung ke ujung, retry, rekaman hasil
├── tokenharbor/client.mjs# daftar, verifikasi, buat API key (Playwright)
├── inbox/index.mjs       # pembaca temp-email.dev + REST + parsing tautan
└── utils/                # config, random, logger
```

## Kebutuhan

- **Node.js 18+**
- Browser Chromium/Firefox/WebKit untuk Playwright
- Jaringan yang dapat mengakses `tokenharbor.ai` dan `www.temp-email.dev`

## Instalasi

```bash
git clone https://github.com/0xgetz/tokenharbor-bulk-creator.git
cd tokenharbor-bulk-creator
npm install
npx playwright install --with-deps chromium
```

## Mulai cepat

```bash
# Satu akun, lihat browser bekerja
node src/index.mjs --headful

# Lima akun, JSON di ./output
node src/index.mjs -n 5 -o output/accounts.json

# Batch sepuluh akun dengan dua worker
node src/index.mjs -n 10 -c 2

# Cek lingkungan dulu
node src/index.mjs --doctor
```

### Referensi CLI

| Flag | Default | Deskripsi |
| --- | --- | --- |
| `-n, --count` | `1` | Jumlah akun |
| `-c, --concurrency` | `1` | Worker paralel |
| `-o, --out` | `tokenharbor-accounts-<ts>.json` | Path JSON hasil |
| `-t, --timeout` | `180000` | Batas ms menunggu email verifikasi |
| `--turnstile-timeout` | `150000` | Batas ms Cloudflare (no-op; untuk paritas) |
| `--retries` | `3` | Percobaan per akun |
| `--inbox-provider` | `temp-email-dev` | `temp-email-dev` \| `custom` |
| `--mail-base-url` | – | Base URL provider `custom` |
| `--mailbox-domain` | otomatis | Pin domain untuk provider `custom` |
| `--password` | acak | Kata sandi tetap (>= 12 karakter) |
| `--key-name` | acak | Label API key tetap |
| `--proxy` | – | URL proxy untuk browser |
| `--headful` | mati | Tampilkan browser |
| `--keep-browser` | mati | Biarkan browser terbuka saat selesai |
| `-q, --quiet` | mati | Hanya cetak ringkasan akhir |
| `--doctor` | – | Periksa lingkungan lalu keluar |

## Penyedia inbox

| Penyedia | Nilai flag | Cara kerja |
| --- | --- | --- |
| temp-email.dev *(default)* | `temp-email-dev` | Menggerakkan UI di browser; situs membuat alamatnya. |
| REST kustom | `custom` | API temp-mail JSON klasik (`/domains`, `/accounts`, `/messages`). |

## Rate limit

Token Harbor menerapkan throttle lunak. Bila pendaftaran menjawab *"You're doing that a
bit fast — take a breath and try again."*, proses mundur 45 detik lalu mencoba sekali lagi;
bila masih gagal, akun ditandai gagal dengan jenis `rate-limit`. Untuk batch besar, pakai
`--concurrency` rendah (1–2).

## Output

```json
{
  "ok": true,
  "email": "swiftfox482913@swiftemail.dev",
  "api_key": "thk_live_…",
  "key_name": "prod-token-7421",
  "api_base": "https://api.tokenharbor.ai/v1",
  "email_provider": "temp-email.dev"
}
```

## Lisensi

Dirilis di bawah [Lisensi MIT](../LICENSE).
