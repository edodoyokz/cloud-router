# Provider Roadmap — Indonesia Priority

## Prinsip Urutan
Urutan provider MVP harus mengikuti pasar yang benar-benar dipakai user Indonesia sekarang, bukan sekadar daftar terpanjang.
User harus bebas memilih provider mana yang dijadikan primary per workspace.

## Tier 1 — Paling Prioritas
### 1. Codex OAuth / ChatGPT Plus subscription
Kenapa:
- sudah familiar di user coding
- value tinggi untuk power user
- cocok jadi primary subscription source

### 2. Kimi
Kenapa:
- populer untuk cost/performance
- cocok sebagai backup stabil
- mudah diposisikan dalam preset hemat/stabil

### 3. MiniMax
Kenapa:
- efisien buat fallback murah
- menarik untuk pengguna yang sensitif biaya
- bagus untuk routing berlapis

### 4. ZAI
Kenapa:
- sering muncul di stack provider China
- relevan untuk market yang suka opsi alternatif murah

### 5. Alibaba
Kenapa:
- kuat untuk coverage provider China
- penting untuk kombinasi provider yang biasa dipakai user lokal

---

## Tier 2 — Setelah MVP Stabil
- Claude / Anthropic sources
- OpenAI direct if needed
- provider tambahan untuk redundansi
- provider free/cheap lain yang benar-benar dipakai

---

## Routing Preset yang Disarankan
### Hemat
1. MiniMax
2. Kimi
3. ZAI
4. Alibaba
5. Codex OAuth sebagai fallback premium

### Stabil
1. Codex OAuth
2. Kimi
3. MiniMax
4. Alibaba
5. ZAI

### Kualitas
1. Codex OAuth
2. Alibaba
3. ZAI
4. Kimi
5. MiniMax

### Fallback Aman
1. primary account
2. secondary subscription
3. Kimi
4. MiniMax
5. China provider alternatif

---

## What This Means For MVP
- Connect flow harus mengutamakan provider yang paling sering dipakai dulu
- UI should explain "primary / backup / fallback" in simple terms
- Jangan taruh provider yang jarang dipakai di onboarding awal
- Preset default harus langsung cocok untuk market Indonesia
- User dapat mengubah primary provider kapan saja

## Product Implication
Kalau roadmap provider mengikuti urutan ini, user akan merasa:
- familiar
- relevan
- cepat dapat value
- tidak dipaksa setup sesuatu yang tidak mereka pakai
