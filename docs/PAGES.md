# MVP Pages — NusaNexus Router

## 1. Landing Page
**Purpose:** menjelaskan value utama dan mengarahkan user signup.

### Sections
- Hero: "Login akun AI kamu, langsung pakai tanpa setup"
- Benefit list
- Supported tools list
- How it works
- Social proof / trust hints
- CTA: Start Free / Login

### CTA
- Create account
- See demo

---

## 2. Auth Pages
### `/login`
- email + password atau SSO
- link ke signup
- forgot password

### `/signup`
- email
- password
- consent / terms

---

## 3. Onboarding Wizard
### `/onboarding`
**Step 1:** buat workspace
**Step 2:** connect provider pertama
**Step 3:** pilih preset
**Step 4:** generate endpoint + API key
**Step 5:** copy config

### UX principles
- satu step per layar
- tombol next/back jelas
- progress indicator
- copy-to-clipboard di akhir

---

## 4. Dashboard Home
### `/dashboard`
**Purpose:** overview cepat.

### Cards
- active providers
- active preset
- usage today
- request success rate
- fallback count

### Quick actions
- add provider
- create preset
- copy endpoint
- view usage

---

## 5. Providers Page
### `/dashboard/providers`
**Purpose:** lihat semua koneksi akun/provider.

### UI blocks
- list provider connections
- status badge
- quota state
- reconnect button
- add provider button

### Empty state
- "Connect your first provider"

---

## 6. Provider Detail Page
### `/dashboard/providers/:id`
**Purpose:** detail koneksi dan health.

### Info
- provider type
- display name
- auth method
- status
- quota info
- last checked

### Actions
- reconnect
- disconnect
- test connection
- delete connection

---

## 7. Presets Page
### `/dashboard/presets`
**Purpose:** bikin dan atur routing preset.

### Features
- create preset
- rename preset
- reorder provider steps
- set default preset
- choose fallback mode
- choose primary provider per workspace

### Preset templates
- Hemat
- Stabil
- Kualitas
- Fallback Aman

---

## 8. Preset Detail Page
### `/dashboard/presets/:id`
**Purpose:** edit urutan provider/model.

### Blocks
- list ordered steps
- provider selector
- model alias input
- fallback rule per step
- test preset button

---

## 9. Endpoint Page
### `/dashboard/endpoint`
**Purpose:** kasih user semua data untuk mulai pakai.

### Show
- base URL
- API key
- sample config snippets
- model/preset name
- copy buttons

### Snippets
- Claude Code
- Codex
- OpenClaw
- Cursor
- Cline

---

## 10. Usage Page
### `/dashboard/usage`
**Purpose:** monitoring dasar.

### Charts / tables
- requests per day
- success vs fail
- provider usage
- fallback events
- recent requests

### Table columns
- time
- provider
- preset
- model
- tokens
- status

---

## 11. Settings Page
### `/dashboard/settings`
**Purpose:** workspace and security settings.

### Sections
- workspace info
- API key management
- security preferences
- notification settings
- danger zone

---

## 12. Error / Fallback States
### Important states to design
- provider expired
- quota exhausted
- invalid API key
- no preset active
- no provider connected
- request failed after fallback

### UX rule
Error harus bilang:
- apa yang gagal
- kenapa
- apa yang bisa user lakukan
- tombol action yang jelas

---

## Suggested MVP Route Map
- `/`
- `/login`
- `/signup`
- `/onboarding`
- `/dashboard`
- `/dashboard/providers`
- `/dashboard/providers/:id`
- `/dashboard/presets`
- `/dashboard/presets/:id`
- `/dashboard/endpoint`
- `/dashboard/usage`
- `/dashboard/settings`
