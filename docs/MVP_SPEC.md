# MVP Spec — 9router Cloud

## 1. Tujuan
Membuat hosted AI router yang membuat user cukup login akun mereka, memilih preset routing, lalu langsung memakai satu endpoint yang siap dipakai di tool coding.

## 2. Value Proposition
- Tanpa setup server
- Tanpa konfigurasi manual yang ribet
- Bisa gabungkan beberapa akun/provider milik user
- Fallback otomatis agar kerja tidak berhenti
- UI yang jauh lebih sederhana daripada engine mentah

## 3. Scope MVP
### In scope
- Sign up / login platform
- Connect provider akun user
- Simpan credential secara aman
- Buat preset routing
- Sediakan OpenAI-compatible endpoint
- Dashboard usage sederhana
- Status koneksi provider
- Basic reconnect / disconnect flow
- Multi-page MVP dashboard

### Out of scope
- Billing kompleks
- Enterprise org / RBAC lengkap
- Semua provider sekaligus
- Analitik advanced
- Cloud sync lintas perangkat yang rumit
- Marketplace combo publik

## 4. Provider Awal
Mulai dari provider yang paling relevan untuk coding stack.
Contoh kategori awal:
- subscription provider
- provider murah
- provider fallback / free

Catatan: daftar final disesuaikan dengan validasi legal, teknis, dan demand.
User memilih provider mana yang jadi primary di workspace mereka.

## 5. Preset Routing
Preset MVP:
- **Hemat**: prioritaskan provider murah / efisien
- **Stabil**: prioritaskan provider paling reliable
- **Kualitas**: prioritaskan model terbaik user
- **Fallback Aman**: primary → secondary → backup

## 6. User Story Utama
1. User daftar / login
2. User connect akun provider
3. User memilih preset routing
4. Sistem menghasilkan endpoint dan API key
5. User copy config ke tool coding
6. Request masuk ke router
7. Router memilih provider sesuai preset dan kondisi quota
8. User melihat usage dasar dan status provider

## 7. Acceptance Criteria
MVP dianggap siap jika:
- user bisa login
- user bisa connect minimal satu provider
- user bisa memilih preset
- user mendapat endpoint yang valid
- request dasar bisa lewat endpoint
- fallback dasar bekerja
- dashboard status provider dan usage tampil
- halaman inti MVP tersedia

## 8. Risks
- Compliance / ToS provider
- Security credential storage
- Reliability saat traffic naik
- User trust terhadap hosted platform
- Scope melebar karena terlalu banyak provider
