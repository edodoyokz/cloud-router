# Wireframe — NusaNexus Router MVP

## 1. Landing Page (`/`)

### Goal
Bikin user paham value dalam 5 detik.

### Layout
- Top nav: logo, login, signup
- Hero:
  - headline: "Login akun AI kamu, langsung pakai tanpa setup"
  - subheadline: hosted AI router untuk coding tools
  - CTA 1: Start Free
  - CTA 2: See Demo
- Social proof / trust strip
- Section: how it works (3 langkah)
- Section: supported tools
- Section: supported providers
- Section: feature highlights
- Footer

### Wireframe
```text
[Logo]                               [Login] [Signup]
------------------------------------------------------
| Hero headline                                      |
| Subheadline                                        |
| [Start Free]  [See Demo]                           |
------------------------------------------------------
| Trust / logos / metrics                            |
------------------------------------------------------
| How it works: 1 Login -> 2 Connect -> 3 Use        |
------------------------------------------------------
| Supported tools / providers                        |
------------------------------------------------------
| Feature highlights                                 |
------------------------------------------------------
| Footer                                             |
```

---

## 2. Auth Pages (`/login`, `/signup`)

### Goal
Masuk cepat, tanpa distraksi.

### Layout
- centered card
- email
- password / SSO
- primary CTA
- secondary link to opposite page

---

## 3. Onboarding (`/onboarding`)

### Goal
Bawa user ke endpoint aktif secepat mungkin.

### Steps
1. Create workspace
2. Connect provider pertama
3. Choose preset
4. Generate API key
5. Copy config

### Wireframe
```text
[Progress bar: Step 1 of 5]
------------------------------------------------------
| Step content                                        |
| fields / connect button / helper text               |
| [Back]                               [Next]          |
------------------------------------------------------
```

---

## 4. Dashboard Home (`/dashboard`)

### Goal
Overview cepat + aksi utama.

### Top Cards
- Active Providers
- Active Preset
- Usage Today
- Success Rate
- Fallback Count

### Main actions
- Add provider
- Create preset
- Copy endpoint
- View usage

### Wireframe
```text
[Sidebar] [Topbar with workspace + profile]
------------------------------------------------------
| Summary cards: 5 cards                             |
------------------------------------------------------
| Quick actions | Recent requests | Provider status   |
------------------------------------------------------
```

---

## 5. Providers Page (`/dashboard/providers`)

### Goal
Lihat dan kelola semua koneksi provider.

### Wireframe
```text
[Add Provider]
------------------------------------------------------
| Provider list                                       |
| - name | type | status | quota | reconnect         |
| - name | type | status | quota | reconnect         |
------------------------------------------------------
| Empty state when none connected                    |
```

### Actions per row
- test
- reconnect
- disconnect
- delete

---

## 6. Provider Detail (`/dashboard/providers/:id`)

### Goal
Status dan health detail.

### Sections
- provider metadata
- status card
- quota card
- health history
- actions

---

## 7. Presets Page (`/dashboard/presets`)

### Goal
Bikin routing preset yang gampang dipakai.

### Wireframe
```text
[Create Preset]   [Choose Primary Provider]
------------------------------------------------------
| Preset cards: Hemat / Stabil / Kualitas / Fallback |
------------------------------------------------------
| Each card: default badge, provider count, edit      |
```

---

## 8. Preset Detail (`/dashboard/presets/:id`)

### Goal
Atur urutan provider/model.

### Sections
- preset name
- description
- default toggle
- primary provider selector
- ordered step editor
- fallback mode
- test preset

### Ordered step editor
- provider dropdown
- model alias
- fallback type
- move up/down

---

## 9. Endpoint Page (`/dashboard/endpoint`)

### Goal
Kasih semua yang user butuh untuk mulai pakai.

### Sections
- base URL
- API key card
- model/preset selector
- copy snippets
- test connection

### Code snippets
- Claude Code
- Codex
- OpenClaw
- Cursor
- Cline

---

## 10. Usage Page (`/dashboard/usage`)

### Goal
Monitoring dasar.

### Layout
- top metrics
- chart requests over time
- provider usage table
- recent requests table

---

## 11. Settings Page (`/dashboard/settings`)

### Goal
Workspace + security control.

### Sections
- workspace profile
- API key management
- notification settings
- security settings
- danger zone

---

## 12. Error States

### Must-have states
- no provider connected
- provider expired
- quota exhausted
- invalid API key
- preset not found
- fallback exhausted

### Error card pattern
- title
- short explanation
- action button
- optional retry/reconnect
