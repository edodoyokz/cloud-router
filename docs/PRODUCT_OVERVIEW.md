# NusaNexus Router MVP

Hosted AI router untuk coding tools, dengan tujuan utama:

> user login akun AI mereka sendiri, pilih preset, lalu langsung pakai tanpa setup server yang ribet.

## Inti Produk

- Satu dashboard untuk semua koneksi provider
- Satu endpoint OpenAI-compatible untuk dipakai di tools coding
- Preset routing supaya user tidak perlu ngoprek combo manual
- Multi-account per provider
- Fallback otomatis saat limit / error / provider lambat

## Target User

- Power user coding AI di Indonesia
- User yang punya beberapa akun/provider sendiri
- User yang mau pakai Claude Code / Codex / OpenClaw / Cursor / Cline tanpa setup DevOps
- Tim kecil yang butuh endpoint stabil dan hemat

## Problem yang Diselesaikan

- Setup self-hosted router/cliproxyapi terlalu teknis
- Login/provider config tersebar
- Routing dan fallback harus diatur manual
- User ingin satu tempat yang tinggal pakai

## MVP Output

- Login platform
- Connect provider
- Pilih preset
- Copy endpoint/API key
- Pakai di tool favorit
- Monitor usage dasar
- Halaman MVP utama tersedia

## Batasan MVP

- Fokus ke 3–5 provider dulu
- Fokus ke routing coding tools dulu
- Belum enterprise
- Belum billing kompleks
- Belum semua provider / semua mode

## Dokumen Turunan

### Product
- `MVP_SPEC.md` — spesifikasi MVP
- `USER_FLOW.md` — alur pengguna
- `PAGES.md` — daftar halaman MVP
- `WIREFRAME.md` — wireframe kasar per halaman
- `LANDING_COPY.md` — copy landing page awal
- `SITEMAP.md` — sitemap final MVP
- `PROVIDER_ROADMAP.md` — prioritas provider market Indonesia
- `BACKLOG.md` — daftar kerja v0.1
- `BUILD_ORDER.md` — urutan build
- `NOTES.md` — catatan arah produk dan eksekusi

### Engineering
- `FINAL_ARCHITECTURE.md` — arsitektur lengkap (consolidated)
- `DB_SCHEMA.md` — schema database
- `schema.sql` — SQL migration
- `API_CONTRACT.md` — API contract control plane + data plane
- `REQUEST_FLOW.md` — aliran request control/data plane
- `ERROR_CODES.md` — registry error codes
- `AUTH_FLOW.md` — authentication flow (user auth + API key)
- `ENCRYPTION.md` — credential encryption/decryption
- `STREAMING.md` — SSE streaming proxy flow
- `SETUP.md` — developer setup guide
- `ENV_CONFIG.md` — environment variables
