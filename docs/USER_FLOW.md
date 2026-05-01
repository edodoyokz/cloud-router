# User Flow — 9router Cloud MVP

## Flow 1: First Time User
1. Buka landing page
2. Sign up / login
3. Masuk onboarding
4. Connect provider akun sendiri
5. Pilih preset routing
6. System generate endpoint + API key
7. Copy config ke tool coding
8. Selesai

## Flow 2: Add Another Provider
1. Buka dashboard
2. Klik Add Provider
3. Login / authorize provider baru
4. Simpan
5. Update preset atau biarkan fallback otomatis

## Flow 3: Use in Coding Tool
1. User buka Claude Code / Codex / OpenClaw / Cursor / Cline
2. Set base URL ke endpoint platform
3. Set API key dari dashboard
4. Pilih model alias / preset
5. Mulai chat / coding task

## Flow 4: Provider Down / Limit
1. Request primary gagal atau limit habis
2. Router cek preset fallback
3. Pindah ke provider berikutnya
4. User tetap bisa lanjut kerja
5. Dashboard menandai provider bermasalah / exhausted

## UX Prinsip
- Minim langkah
- Tidak minta user mikir arsitektur
- Gunakan istilah yang familiar
- Ada tombol copy di setiap langkah penting
- Error message harus jelas dan actionable
